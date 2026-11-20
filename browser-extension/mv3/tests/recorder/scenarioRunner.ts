import {
  acceptsGroupsOptIn,
  buildCompleteMessages,
  buildStartReply,
  buildSubscribeMessages,
} from "../../src/service-worker/services/networkRecording/groupsPort";
import { GroupedRecordingSession } from "../../src/service-worker/services/networkRecording/groupedSession";
import type { GroupsManifest, NetworkRecordingPortMessage } from "common/networkRecordingProtocol";

// Plays an LTS-side script against the real recorder modules, the way index.ts wires them, and
// records what the extension would put on the `network-recording` port. Entries are reduced to
// {_request_id}: HAR content is not part of the groups contract.

export const TAB_ID = 7;

export interface Step {
  op:
    | "file"
    | "newGroup"
    | "rename"
    | "move"
    | "delete"
    | "undo"
    | "pause"
    | "resume"
    | "subscribe"
    | "disconnect"
    | "stop";
  /** Fake clock, epoch ms, set before the step runs. */
  t: number;
  id?: string;
  /** For `file`: when the request started, if earlier than `t` (a slow request). */
  startedAt?: number;
  /** Group by creation index. */
  group?: number;
  to?: number;
  name?: string;
  ids?: string[];
  /** For `undo`: the latest operation, or the first one (already replaced). */
  which?: "last" | "first";
}

export interface ScenarioInput {
  name: string;
  description: string;
  /** What the FE put in the START config. */
  optIn: boolean;
  /** Whether the browser has the side panel API (Chrome and Edge). */
  sidePanel: boolean;
  startTime: number;
  steps: Step[];
}

export interface ScenarioOutput {
  startReply: unknown;
  messages: NetworkRecordingPortMessage[];
  summaryManifest: GroupsManifest | null;
}

export const runScenario = (input: ScenarioInput): ScenarioOutput => {
  const messages: NetworkRecordingPortMessage[] = [];
  const buffer: { _request_id: string }[] = [];
  let subscribed = false;
  let clock = input.startTime;
  let counter = 0;
  let firstOpId = "";
  let lastOpId = "";
  let summaryManifest: GroupsManifest | null = null;

  const groupsEnabled = acceptsGroupsOptIn({ groups: input.optIn }, input.sidePanel);
  const startReply = buildStartReply({ targetTabId: TAB_ID, openedMode: "window", groupsEnabled });

  const post = (batch: NetworkRecordingPortMessage[]) => {
    if (subscribed) messages.push(...batch);
  };
  const session = groupsEnabled
    ? new GroupedRecordingSession(
        TAB_ID,
        input.startTime,
        { post, notifyPanel: () => {} },
        { now: () => clock, newId: () => `id-${++counter}` }
      )
    : undefined;

  const groupId = (index: number) => session!.view().groups[index].id;
  const noteOp = (result: { ok: boolean; opId?: string }) => {
    if (result.ok && result.opId) {
      firstOpId = firstOpId || result.opId;
      lastOpId = result.opId;
    }
  };

  input.steps.forEach((step) => {
    clock = step.t;
    switch (step.op) {
      case "file": {
        const entry = { _request_id: step.id! };
        if (session && session.file(step.id!, step.startedAt ?? step.t) === null) break;
        buffer.push(entry);
        post([{ type: "entry", entry }]);
        break;
      }
      case "newGroup":
        session!.newGroup();
        break;
      case "rename":
        session!.rename(groupId(step.group!), step.name!);
        break;
      case "move":
        noteOp(session!.move(step.ids!, groupId(step.to!)));
        break;
      case "delete":
        noteOp(session!.delete(step.ids!));
        break;
      case "undo":
        session!.undo(step.which === "first" ? firstOpId : lastOpId);
        break;
      case "pause":
        session!.pause();
        break;
      case "resume":
        session!.resume();
        break;
      case "subscribe": {
        const batch = session
          ? session.subscribeMessages(buffer)
          : buildSubscribeMessages({ targetTabId: TAB_ID, entries: buffer, active: true });
        messages.push(...batch);
        subscribed = true;
        break;
      }
      case "disconnect":
        subscribed = false;
        break;
      case "stop": {
        summaryManifest = session ? session.finish() : null;
        post(buildCompleteMessages(summaryManifest ?? undefined));
        break;
      }
    }
  });

  return { startReply, messages, summaryManifest };
};
