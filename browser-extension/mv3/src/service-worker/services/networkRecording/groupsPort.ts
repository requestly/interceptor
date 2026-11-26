import type {
  GroupsManifest,
  NetworkRecordingPortMessage,
  PortAnalyticsMessage,
  RecorderAnalyticsEvent,
} from "common/networkRecordingProtocol";
import type { RecordingGroups } from "./recordingGroups";

// Message order on the `network-recording` port. Kept free of chrome.* so the order LTS depends on
// (state before the port is registered, manifest strictly before complete) can be asserted in tests.

export const toPortAnalytics = (event: RecorderAnalyticsEvent): PortAnalyticsMessage => ({
  type: "analytics",
  ...event,
});

/** Messages sent on a subscribe, in order. The caller posts them synchronously, then registers the port. */
export const buildSubscribeMessages = (input: {
  targetTabId: number;
  entries: unknown[];
  active: boolean;
  groups?: RecordingGroups;
  retainedManifest?: GroupsManifest;
}): NetworkRecordingPortMessage[] => {
  const { targetTabId, entries, active, groups, retainedManifest } = input;
  const messages: NetworkRecordingPortMessage[] = [{ type: "subscribed", targetTabId }];
  entries.forEach((entry) => messages.push({ type: "entry", entry }));

  if (groups) {
    messages.push(groups.buildState(targetTabId));
    groups.analyticsBacklog().forEach((event) => messages.push(toPortAnalytics(event)));
  }
  if (!active) messages.push(...buildCompleteMessages(retainedManifest));
  return messages;
};

/** Manifest first, then complete: the FE closes the port on complete, so nothing may follow it. */
export const buildCompleteMessages = (manifest?: GroupsManifest): NetworkRecordingPortMessage[] =>
  manifest ? [{ type: "manifest", manifest }, { type: "complete" }] : [{ type: "complete" }];

/** Only a literal `true` opts in, and only where the side panel API exists (Chrome and Edge). */
export const acceptsGroupsOptIn = (config: { groups?: unknown }, sidePanelAvailable: boolean): boolean =>
  config.groups === true && sidePanelAvailable;

/** The START reply. `groups: true` appears only when the opt-in was accepted; otherwise it is byte-identical to today's. */
export const buildStartReply = <M extends string>(input: {
  targetTabId: number;
  openedMode: M;
  groupsEnabled: boolean;
}) => ({
  success: true as const,
  targetTabId: input.targetTabId,
  openedMode: input.openedMode,
  ...(input.groupsEnabled ? { groups: true as const } : {}),
});
