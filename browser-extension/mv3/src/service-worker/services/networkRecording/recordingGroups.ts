import {
  ANALYTICS_BACKLOG_LIMIT,
  DEFAULT_GROUP_NAME,
  MANIFEST_VERSION,
  NEW_GROUP_BASE_NAME,
  validateGroupName,
} from "common/networkRecordingProtocol";
import type {
  GroupCommandFailure,
  GroupsManifest,
  NewGroupResult,
  PanelGroupsView,
  PortStateMessage,
  RecorderAnalyticsEvent,
  RecorderAnalyticsEventName,
  RecorderAnalyticsProps,
  RecordingStats,
  RenameGroupResult,
} from "common/networkRecordingProtocol";

// Pure model of one grouped recording (no chrome.* calls, no timers). The service worker owns the
// only instance per recording; the side panel and LTS get snapshots of it.

interface Group {
  id: string;
  name: string;
}

interface UndoItem {
  id: string;
  fromGroupId: string;
  fromIndex: number;
}

interface UndoRecord {
  opId: string;
  kind: "move" | "delete";
  items: UndoItem[];
}

interface PauseInterval {
  from: number;
  to: number | null;
}

export interface RecordingGroupsOptions {
  startTime: number;
  now?: () => number;
  newId?: () => string;
  onEvent?: (event: RecorderAnalyticsEvent) => void;
}

export class RecordingGroups {
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly onEvent?: (event: RecorderAnalyticsEvent) => void;

  private readonly groups: Group[];
  private readonly requestIds = new Map<string, string[]>();
  private readonly groupOf = new Map<string, string>();
  private readonly arrival = new Map<string, number>();
  private readonly deleted = new Set<string>();
  private readonly timeline: { at: number; groupId: string }[];
  private readonly pauses: PauseInterval[] = [];
  private readonly events: RecorderAnalyticsEvent[] = [];
  private readonly counters = { groupsCreated: 0, renames: 0, moves: 0, deletes: 0, undos: 0, pauses: 0 };

  private undoRecord: UndoRecord | null = null;
  private nextArrival = 0;
  private lastTick: number;
  private currentRevision = 1;

  constructor(options: RecordingGroupsOptions) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.onEvent = options.onEvent;
    this.lastTick = options.startTime;

    const first: Group = { id: this.newId(), name: DEFAULT_GROUP_NAME };
    this.groups = [first];
    this.requestIds.set(first.id, []);
    this.timeline = [{ at: options.startTime, groupId: first.id }];
  }

  get revision(): number {
    return this.currentRevision;
  }

  get activeGroupId(): string {
    return this.timeline[this.timeline.length - 1].groupId;
  }

  get paused(): boolean {
    const last = this.pauses[this.pauses.length - 1];
    return !!last && last.to === null;
  }

  get deletedCount(): number {
    return this.deleted.size;
  }

  // --- Filing ---------------------------------------------------------------------------------

  /** Group active at `t`. Times before the recording started land in the first group. */
  groupIdAt(t: number): string {
    let lo = 0;
    let hi = this.timeline.length - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.timeline[mid].at <= t) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return this.timeline[found].groupId;
  }

  isPausedAt(t: number): boolean {
    return this.pauses.some((p) => t >= p.from && (p.to === null || t < p.to));
  }

  /**
   * Files a request by the time it STARTED. Returns its group id, or null when it started during a
   * pause (the caller then drops it, so it is never stored, delivered or counted).
   */
  file(requestId: string, startedAt: number): string | null {
    const existing = this.groupOf.get(requestId);
    if (existing !== undefined) return existing;
    if (this.isPausedAt(startedAt)) return null;

    const groupId = this.groupIdAt(startedAt);
    this.requestIds.get(groupId)!.push(requestId);
    this.groupOf.set(requestId, groupId);
    this.arrival.set(requestId, this.nextArrival++);
    this.bump();
    return groupId;
  }

  // --- Pause ----------------------------------------------------------------------------------

  pause(): boolean {
    if (this.paused) return false;
    this.pauses.push({ from: this.tick(), to: null });
    this.counters.pauses += 1;
    this.emit("recording_paused", {});
    this.bump();
    return true;
  }

  resume(): boolean {
    const last = this.pauses[this.pauses.length - 1];
    if (!last || last.to !== null) return false;
    last.to = Math.max(this.tick(), last.from);
    this.emit("recording_resumed", {});
    this.bump();
    return true;
  }

  timeLimitReached(): void {
    this.emit("recording_auto_stopped_time_limit", {});
  }

  /** Time spent paused so far, including a pause that is still open. */
  pausedMs(at: number = this.now()): number {
    return this.pauses.reduce((sum, p) => sum + Math.max(0, (p.to ?? at) - p.from), 0);
  }

  // --- Groups ---------------------------------------------------------------------------------

  /** An empty newest group is reused instead of stacking another empty one. */
  newGroup(): NewGroupResult {
    const newest = this.groups[this.groups.length - 1];
    if (this.requestIds.get(newest.id)!.length === 0) {
      return { ok: true, groupId: newest.id, reused: true };
    }

    const group: Group = { id: this.newId(), name: this.nextNewGroupName() };
    this.groups.push(group);
    this.requestIds.set(group.id, []);
    this.timeline.push({ at: this.tick(), groupId: group.id });
    this.counters.groupsCreated += 1;
    this.emit("group_created", {});
    this.bump();
    return { ok: true, groupId: group.id, reused: false };
  }

  rename(groupId: string, raw: string): RenameGroupResult {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group) return { ok: false, reason: "unknown-group" };

    const others = this.groups.filter((g) => g !== group).map((g) => g.name);
    const checked = validateGroupName(raw, others);
    if (!checked.ok) return checked;
    if (checked.name === group.name) return { ok: true };

    group.name = checked.name;
    this.counters.renames += 1;
    this.emit("group_renamed", {});
    this.bump();
    return { ok: true };
  }

  // --- Move, delete, undo ---------------------------------------------------------------------

  /** Moves go to the end of the target group in the requests' original relative order. */
  move(requestIds: string[], targetGroupId: string): { ok: true; opId: string; count: number } | Failure {
    if (!this.requestIds.has(targetGroupId)) return { ok: false, reason: "unknown-group" };

    const ids = this.sortedByArrival(
      requestIds.filter((id) => this.isLive(id) && this.groupOf.get(id) !== targetGroupId)
    );
    if (ids.length === 0) return { ok: false, reason: "nothing-to-do" };

    const items = this.snapshotItems(ids);
    ids.forEach((id) => this.removeFromGroup(id));
    ids.forEach((id) => {
      this.requestIds.get(targetGroupId)!.push(id);
      this.groupOf.set(id, targetGroupId);
    });

    const opId = this.newId();
    this.undoRecord = { opId, kind: "move", items };
    this.counters.moves += 1;
    this.emit("requests_moved", { count: ids.length, bulk: ids.length > 1 });
    this.bump();
    return { ok: true, opId, count: ids.length };
  }

  /** Soft delete: entries stay buffered (LTS already has them) and are excluded via the manifest. */
  delete(requestIds: string[]): { ok: true; opId: string; count: number } | Failure {
    const ids = this.sortedByArrival(requestIds.filter((id) => this.isLive(id)));
    if (ids.length === 0) return { ok: false, reason: "nothing-to-do" };

    const items = this.snapshotItems(ids);
    ids.forEach((id) => {
      this.removeFromGroup(id);
      this.deleted.add(id);
    });

    const opId = this.newId();
    this.undoRecord = { opId, kind: "delete", items };
    this.counters.deletes += 1;
    this.emit("requests_deleted", { count: ids.length, bulk: ids.length > 1 });
    this.bump();
    return { ok: true, opId, count: ids.length };
  }

  /** Only the latest operation can be undone, and only by its own opId. */
  undo(opId: string): { ok: true; kind: "move" | "delete"; count: number } | Failure {
    const record = this.undoRecord;
    if (!record || record.opId !== opId) return { ok: false, reason: "stale" };
    this.undoRecord = null;

    record.items.forEach((item) => {
      if (!this.deleted.has(item.id)) this.removeFromGroup(item.id);
    });

    const byGroup = new Map<string, UndoItem[]>();
    record.items.forEach((item) => byGroup.set(item.fromGroupId, [...(byGroup.get(item.fromGroupId) ?? []), item]));
    byGroup.forEach((items, groupId) => {
      const list = this.requestIds.get(groupId)!;
      items
        .sort((a, b) => a.fromIndex - b.fromIndex)
        .forEach((item) => {
          list.splice(Math.min(item.fromIndex, list.length), 0, item.id);
          this.groupOf.set(item.id, groupId);
          this.deleted.delete(item.id);
        });
    });

    this.counters.undos += 1;
    this.emit("undo_used", { count: record.items.length, bulk: record.items.length > 1 });
    this.bump();
    return { ok: true, kind: record.kind, count: record.items.length };
  }

  // --- Snapshots ------------------------------------------------------------------------------

  /** Closes a pause still open at Stop, so the final stats count it. */
  stop(): void {
    const last = this.pauses[this.pauses.length - 1];
    if (last && last.to === null) last.to = Math.max(this.tick(), last.from);
    this.undoRecord = null;
    this.bump();
  }

  buildManifest(): GroupsManifest {
    return {
      version: MANIFEST_VERSION,
      revision: this.currentRevision,
      groups: this.groups
        .filter((g) => this.requestIds.get(g.id)!.length > 0)
        .map((g) => ({
          id: g.id,
          name: g.name,
          isDefault: g === this.groups[0],
          requestIds: [...this.requestIds.get(g.id)!],
        })),
      deletedRequestIds: [...this.deleted],
      stats: this.buildStats(),
    };
  }

  buildView(): PanelGroupsView {
    const last = this.pauses[this.pauses.length - 1];
    const open = !!last && last.to === null;
    return {
      revision: this.currentRevision,
      groups: this.groups.map((g, index) => ({
        id: g.id,
        name: g.name,
        isDefault: index === 0,
        requestIds: [...this.requestIds.get(g.id)!],
      })),
      activeGroupId: this.activeGroupId,
      paused: open,
      pausedMsClosed: this.pauses.reduce((sum, p) => sum + (p.to === null ? 0 : p.to - p.from), 0),
      pausedAt: open ? last.from : null,
      deletedCount: this.deleted.size,
    };
  }

  buildState(targetTabId: number): PortStateMessage {
    return {
      type: "state",
      targetTabId,
      revision: this.currentRevision,
      paused: this.paused,
      pausedMs: this.pausedMs(),
      activeGroupId: this.activeGroupId,
      deletedCount: this.deleted.size,
    };
  }

  analyticsBacklog(): RecorderAnalyticsEvent[] {
    return [...this.events];
  }

  // --- Internals ------------------------------------------------------------------------------

  private buildStats(): RecordingStats {
    return { ...this.counters, pausedMs: this.pausedMs() };
  }

  private bump(): void {
    this.currentRevision += 1;
  }

  /** Wall clock that never steps backwards, so boundaries stay sorted if the system clock does. */
  private tick(): number {
    this.lastTick = Math.max(this.lastTick, this.now());
    return this.lastTick;
  }

  private emit(event: RecorderAnalyticsEventName, props: RecorderAnalyticsProps): void {
    const payload: RecorderAnalyticsEvent = { id: this.newId(), event, props, at: this.now() };
    this.events.push(payload);
    if (this.events.length > ANALYTICS_BACKLOG_LIMIT) this.events.shift();
    this.onEvent?.(payload);
  }

  private nextNewGroupName(): string {
    const taken = new Set(this.groups.map((g) => g.name));
    let n = this.groups.length;
    while (taken.has(`${NEW_GROUP_BASE_NAME} ${n}`)) n += 1;
    return `${NEW_GROUP_BASE_NAME} ${n}`;
  }

  private isLive(id: string): boolean {
    return this.groupOf.has(id) && !this.deleted.has(id);
  }

  private sortedByArrival(ids: string[]): string[] {
    return Array.from(new Set(ids)).sort((a, b) => this.arrival.get(a)! - this.arrival.get(b)!);
  }

  private snapshotItems(ids: string[]): UndoItem[] {
    return ids.map((id) => {
      const fromGroupId = this.groupOf.get(id)!;
      return { id, fromGroupId, fromIndex: this.requestIds.get(fromGroupId)!.indexOf(id) };
    });
  }

  private removeFromGroup(id: string): void {
    const list = this.requestIds.get(this.groupOf.get(id)!)!;
    const index = list.indexOf(id);
    if (index >= 0) list.splice(index, 1);
  }
}

type Failure = { ok: false; reason: GroupCommandFailure };
