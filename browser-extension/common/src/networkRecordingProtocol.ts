/**
 * Network recording groups: wire types shared by the service worker, the side panel and the LTS
 * contract. Everything here is opt-in per start (`config.groups === true`) and additive: a recording
 * that did not opt in never produces any of these messages.
 */

export const GROUP_NAME_MAX_LENGTH = 60;
export const DEFAULT_GROUP_NAME = "Default group";
export const NEW_GROUP_BASE_NAME = "Group";
export const ANALYTICS_BACKLOG_LIMIT = 500;
export const MANIFEST_VERSION = 1;

export type GroupNameRejection = "empty" | "duplicate" | "reserved-chars" | "edge-colon" | "too-long" | "line-break";

const LINE_BREAK = /[\n\r\u2028\u2029]/;

/**
 * The names LTS can't use are the names the recorder refuses (REC8). Whitespace is trimmed, and a
 * duplicate is an exact match after trimming ("Login" and "login" are different names).
 */
export const validateGroupName = (
  raw: string,
  otherNames: string[]
): { ok: true; name: string } | { ok: false; reason: GroupNameRejection } => {
  const text = typeof raw === "string" ? raw : "";
  const name = text.trim();
  if (!name) return { ok: false, reason: "empty" };
  if (LINE_BREAK.test(text)) return { ok: false, reason: "line-break" };
  if (name.includes("::")) return { ok: false, reason: "reserved-chars" };
  if (name.startsWith(":") || name.endsWith(":")) return { ok: false, reason: "edge-colon" };
  if (Array.from(name).length > GROUP_NAME_MAX_LENGTH) return { ok: false, reason: "too-long" };
  if (otherNames.includes(name)) return { ok: false, reason: "duplicate" };
  return { ok: true, name };
};

export type RecorderAnalyticsEventName =
  | "group_created"
  | "group_renamed"
  | "requests_moved"
  | "requests_deleted"
  | "undo_used"
  | "recording_paused"
  | "recording_resumed"
  | "recording_auto_stopped_time_limit";

/** Counts and booleans only. Group names never travel in analytics. */
export interface RecorderAnalyticsProps {
  count?: number;
  bulk?: boolean;
}

export interface RecorderAnalyticsEvent {
  id: string;
  event: RecorderAnalyticsEventName;
  props: RecorderAnalyticsProps;
  at: number;
}

export interface GroupsManifestGroup {
  id: string;
  name: string;
  isDefault: boolean;
  requestIds: string[];
}

/** `moves` and `deletes` count operations (one per Move or Delete), not requests. */
export interface RecordingStats {
  groupsCreated: number;
  renames: number;
  moves: number;
  deletes: number;
  undos: number;
  pauses: number;
  pausedMs: number;
}

/** Full snapshot. Applying it twice is harmless and the higher revision wins. */
export interface GroupsManifest {
  version: typeof MANIFEST_VERSION;
  revision: number;
  groups: GroupsManifestGroup[];
  deletedRequestIds: string[];
  stats: RecordingStats;
}

export interface PortStateMessage {
  type: "state";
  targetTabId: number;
  revision: number;
  paused: boolean;
  pausedMs: number;
  activeGroupId: string;
  deletedCount: number;
}

export interface PortAnalyticsMessage extends RecorderAnalyticsEvent {
  type: "analytics";
}

export interface PortManifestMessage {
  type: "manifest";
  manifest: GroupsManifest;
}

/** Messages the extension posts on the `network-recording` port. */
export type NetworkRecordingPortMessage =
  | { type: "subscribed"; targetTabId: number }
  | { type: "entry"; entry: unknown }
  | { type: "complete" }
  | { type: "error"; error: string }
  | PortStateMessage
  | PortAnalyticsMessage
  | PortManifestMessage;

// --- Side panel (internal, not part of the LTS contract) -----------------------------------------

export interface PanelGroup {
  id: string;
  name: string;
  isDefault: boolean;
  requestIds: string[];
}

/** Everything the panel needs to redraw the grouped list, except the entries themselves. */
export interface PanelGroupsView {
  revision: number;
  groups: PanelGroup[];
  activeGroupId: string;
  paused: boolean;
  /** Time spent in pauses that already ended. */
  pausedMsClosed: number;
  /** Start of the pause in progress, or null. */
  pausedAt: number | null;
  deletedCount: number;
}

export type GroupCommandFailure = "not-recording" | "not-grouped" | "unknown-group" | "nothing-to-do" | "stale";

export type NewGroupResult =
  | { ok: true; groupId: string; reused: boolean }
  | { ok: false; reason: GroupCommandFailure };
export type RenameGroupResult = { ok: true } | { ok: false; reason: GroupNameRejection | GroupCommandFailure };
export type OperationResult = { ok: true; opId: string; count: number } | { ok: false; reason: GroupCommandFailure };
export type SimpleResult = { ok: true } | { ok: false; reason: GroupCommandFailure };
