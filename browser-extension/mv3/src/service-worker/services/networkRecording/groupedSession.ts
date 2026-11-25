import type {
  GroupsManifest,
  NetworkRecordingPortMessage,
  NewGroupResult,
  OperationResult,
  PanelGroupsView,
  PortStateMessage,
  RenameGroupResult,
  SimpleResult,
} from "common/networkRecordingProtocol";
import { buildSubscribeMessages, toPortAnalytics } from "./groupsPort";
import { RecordingGroups } from "./recordingGroups";

export interface GroupedSessionSinks {
  /** Posts to every port subscribed to this recording. */
  post: (messages: NetworkRecordingPortMessage[]) => void;
  /** Sends the side panel a full groups snapshot. */
  notifyPanel: (view: PanelGroupsView) => void;
}

/**
 * One grouped recording: the model plus what each command tells the side panel and the LTS port.
 * Pause, resume, new group and delete also move the port `state`; analytics events are posted by the
 * model's own event hook. No chrome.* here, so the message order is testable.
 */
export class GroupedRecordingSession {
  readonly groups: RecordingGroups;

  constructor(
    private readonly targetTabId: number,
    startTime: number,
    private readonly sinks: GroupedSessionSinks,
    clock: { now?: () => number; newId?: () => string } = {}
  ) {
    this.groups = new RecordingGroups({
      startTime,
      now: clock.now,
      newId: clock.newId,
      onEvent: (event) => sinks.post([toPortAnalytics(event)]),
    });
  }

  file(requestId: string, startedAt: number): string | null {
    return this.groups.file(requestId, startedAt);
  }

  pause(): SimpleResult {
    if (!this.groups.pause()) return { ok: false, reason: "nothing-to-do" };
    this.publish(true);
    return { ok: true };
  }

  resume(): SimpleResult {
    if (!this.groups.resume()) return { ok: false, reason: "nothing-to-do" };
    this.publish(true);
    return { ok: true };
  }

  newGroup(): NewGroupResult {
    const result = this.groups.newGroup();
    if (result.ok) this.publish(true);
    return result;
  }

  rename(groupId: string, name: string): RenameGroupResult {
    const result = this.groups.rename(groupId, name);
    if (result.ok) this.publish(false);
    return result;
  }

  move(requestIds: string[], targetGroupId: string): OperationResult {
    const result = this.groups.move(requestIds, targetGroupId);
    if (result.ok) this.publish(false);
    return result;
  }

  delete(requestIds: string[]): OperationResult {
    const result = this.groups.delete(requestIds);
    if (result.ok) this.publish(true);
    return result;
  }

  undo(opId: string): SimpleResult {
    const result = this.groups.undo(opId);
    if (!result.ok) return result;
    this.publish(true);
    return { ok: true };
  }

  /** Ack, backfill, state, analytics backlog, in that order. The caller registers the port after. */
  subscribeMessages(entries: unknown[]): NetworkRecordingPortMessage[] {
    return buildSubscribeMessages({ targetTabId: this.targetTabId, entries, active: true, groups: this.groups });
  }

  state(): PortStateMessage {
    return this.groups.buildState(this.targetTabId);
  }

  view(): PanelGroupsView {
    return this.groups.buildView();
  }

  /**
   * Closes the recording and returns the final manifest (the same object goes in the summary). A
   * time-limit stop posts its analytics event here, ahead of the `complete` that ends the port.
   */
  finish({ timeLimitReached = false }: { timeLimitReached?: boolean } = {}): GroupsManifest {
    if (timeLimitReached) this.groups.timeLimitReached();
    this.groups.stop();
    return this.groups.buildManifest();
  }

  private publish(withPortState: boolean): void {
    this.sinks.notifyPanel(this.groups.buildView());
    if (withPortState) this.sinks.post([this.groups.buildState(this.targetTabId)]);
  }
}
