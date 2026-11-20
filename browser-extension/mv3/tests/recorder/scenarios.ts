import type { ScenarioInput } from "./scenarioRunner";

const S = 1_000_000;

// Inputs for the golden transcripts. Regenerate the expected output with:
//   UPDATE_GOLDEN=1 npm run test:recorder
export const scenarios: ScenarioInput[] = [
  {
    name: "flat-default-only",
    description: "Opted in, the tester never adds a group: one Default group, then stop.",
    optIn: true,
    sidePanel: true,
    startTime: S,
    steps: [
      { op: "subscribe", t: S },
      { op: "file", t: S + 100, id: "r1" },
      { op: "file", t: S + 200, id: "r2" },
      { op: "stop", t: S + 300 },
    ],
  },
  {
    name: "several-groups-with-rename-and-move",
    description:
      "A new group, a rename, a slow request filed by its start time, then a move. The manifest lists groups in creation order and requestIds in final order.",
    optIn: true,
    sidePanel: true,
    startTime: S,
    steps: [
      { op: "subscribe", t: S },
      { op: "file", t: S + 100, id: "r1" },
      { op: "file", t: S + 150, id: "r2" },
      { op: "newGroup", t: S + 200 },
      { op: "rename", t: S + 250, group: 1, name: "Checkout" },
      { op: "file", t: S + 320, id: "r3", startedAt: S + 190 },
      { op: "file", t: S + 400, id: "r4" },
      { op: "move", t: S + 450, ids: ["r2"], to: 1 },
      { op: "stop", t: S + 500 },
    ],
  },
  {
    name: "pause-with-state",
    description:
      "A request that started during the pause is never delivered. One that started before the pause and finished during it is kept.",
    optIn: true,
    sidePanel: true,
    startTime: S,
    steps: [
      { op: "subscribe", t: S },
      { op: "file", t: S + 100, id: "r1" },
      { op: "pause", t: S + 200 },
      { op: "file", t: S + 260, id: "dropped", startedAt: S + 250 },
      { op: "file", t: S + 280, id: "r2", startedAt: S + 150 },
      { op: "resume", t: S + 300 },
      { op: "file", t: S + 350, id: "r3" },
      { op: "stop", t: S + 400 },
    ],
  },
  {
    name: "delete-then-undo",
    description:
      "Delete one request and undo it, then delete two and keep them deleted. State follows each delete and undo; the manifest lists what stayed deleted.",
    optIn: true,
    sidePanel: true,
    startTime: S,
    steps: [
      { op: "subscribe", t: S },
      { op: "file", t: S + 100, id: "r1" },
      { op: "file", t: S + 150, id: "r2" },
      { op: "file", t: S + 200, id: "r3" },
      { op: "delete", t: S + 300, ids: ["r2"] },
      { op: "undo", t: S + 350, which: "last" },
      { op: "delete", t: S + 400, ids: ["r1", "r3"] },
      { op: "stop", t: S + 500 },
    ],
  },
  {
    name: "reconnect-with-analytics-replay",
    description:
      "The port drops and reconnects. The new subscribe replays every entry, then state, then the whole analytics backlog; the FE de-duplicates by id.",
    optIn: true,
    sidePanel: true,
    startTime: S,
    steps: [
      { op: "subscribe", t: S },
      { op: "file", t: S + 100, id: "r1" },
      { op: "newGroup", t: S + 200 },
      { op: "disconnect", t: S + 300 },
      { op: "pause", t: S + 310 },
      { op: "resume", t: S + 320 },
      { op: "file", t: S + 330, id: "r2" },
      { op: "subscribe", t: S + 400 },
      { op: "file", t: S + 450, id: "r3" },
      { op: "stop", t: S + 500 },
    ],
  },
  {
    name: "stop-during-reconnect",
    description:
      "Stop lands while the port is down, so nothing reaches it. The FE recovers the manifest from getNetworkRecordingSummary: summary.manifest equals the one built at stop.",
    optIn: true,
    sidePanel: true,
    startTime: S,
    steps: [
      { op: "subscribe", t: S },
      { op: "file", t: S + 100, id: "r1" },
      { op: "newGroup", t: S + 200 },
      { op: "file", t: S + 300, id: "r2" },
      { op: "disconnect", t: S + 350 },
      { op: "stop", t: S + 400 },
    ],
  },
  {
    name: "start-without-opt-in",
    description:
      "The START config has no groups key: the reply has no groups field and the stream is exactly today's (subscribed, entries, complete).",
    optIn: false,
    sidePanel: true,
    startTime: S,
    steps: [
      { op: "subscribe", t: S },
      { op: "file", t: S + 100, id: "r1" },
      { op: "file", t: S + 200, id: "r2" },
      { op: "stop", t: S + 300 },
    ],
  },
  {
    name: "old-extension-without-echo",
    description:
      "The FE opts in but the extension does not acknowledge it (an older build, Firefox, Safari): the reply has no groups field and the stream stays flat. The FE must treat the recording as flat.",
    optIn: true,
    sidePanel: false,
    startTime: S,
    steps: [
      { op: "subscribe", t: S },
      { op: "file", t: S + 100, id: "r1" },
      { op: "stop", t: S + 200 },
    ],
  },
];
