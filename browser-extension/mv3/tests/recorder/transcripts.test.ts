import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runScenario, ScenarioInput, ScenarioOutput } from "./scenarioRunner";
import { scenarios } from "./scenarios";

// The golden file is what the FE mock replays, so it cannot drift from the real extension: every
// scenario here is re-run against the recorder modules and compared with it.
const GOLDEN = path.join(process.cwd(), "test/fixtures/groups-port-transcripts.json");

interface GoldenScenario extends ScenarioInput {
  expected: ScenarioOutput;
}

const NOTE =
  "Golden transcripts for the LTAR-528 recorder groups contract. Entries are reduced to {_request_id}. " +
  "Ids are deterministic (id-1, id-2, ...) and the clock is the step's t. Regenerate with UPDATE_GOLDEN=1 npm run test:recorder.";

if (process.env.UPDATE_GOLDEN) {
  const generated = scenarios.map((scenario) => ({ ...scenario, expected: runScenario(scenario) }));
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, `${JSON.stringify({ note: NOTE, scenarios: generated }, null, 2)}\n`);
}

const golden: { scenarios: GoldenScenario[] } = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));

const messagesOf = (scenario: GoldenScenario, type: string) =>
  scenario.expected.messages.filter((m) => m.type === type);

describe("golden port transcripts", () => {
  it("covers the eight contract scenarios", () => {
    assert.deepEqual(
      golden.scenarios.map((s) => s.name),
      scenarios.map((s) => s.name)
    );
    assert.equal(golden.scenarios.length, 8);
  });

  for (const scenario of golden.scenarios) {
    it(`replays ${scenario.name}`, () => {
      assert.deepEqual(runScenario(scenario), scenario.expected);
    });
  }
});

describe("contract invariants", () => {
  const grouped = golden.scenarios.filter((s) => s.optIn && s.sidePanel);
  const flat = golden.scenarios.filter((s) => !s.optIn || !s.sidePanel);

  it("acknowledges the opt-in with groups:true only where it was accepted", () => {
    grouped.forEach((s) =>
      assert.deepEqual(s.expected.startReply, { success: true, targetTabId: 7, openedMode: "window", groups: true })
    );
    flat.forEach((s) =>
      assert.deepEqual(s.expected.startReply, { success: true, targetTabId: 7, openedMode: "window" })
    );
  });

  it("sends the manifest strictly before complete, and nothing after complete", () => {
    grouped
      .filter((s) => s.steps.some((step) => step.op === "stop") && messagesOf(s, "complete").length > 0)
      .forEach((s) => {
        const types = s.expected.messages.map((m) => m.type);
        assert.equal(types[types.length - 1], "complete", s.name);
        assert.equal(types[types.length - 2], "manifest", s.name);
        assert.equal(types.filter((t) => t === "complete").length, 1, s.name);
      });
  });

  it("makes the manifest on the port identical to the one kept for the summary", () => {
    grouped.forEach((s) => {
      const onPort = messagesOf(s, "manifest")[0] as { manifest: unknown } | undefined;
      if (onPort) assert.deepEqual(onPort.manifest, s.expected.summaryManifest, s.name);
    });
  });

  it("sends state after the entry backfill and before analytics on every subscribe", () => {
    grouped.forEach((s) => {
      const types = s.expected.messages.map((m) => m.type);
      let from = 0;
      while ((from = types.indexOf("subscribed", from)) !== -1) {
        let end = types.indexOf("subscribed", from + 1);
        if (end === -1) end = types.length;
        const block = types.slice(from, end);
        const state = block.indexOf("state");
        assert.ok(state > 0, `${s.name}: state follows subscribed`);
        assert.equal(
          block.slice(1, state).every((t) => t === "entry"),
          true,
          `${s.name}: only entries before state`
        );
        from = end;
      }
    });
  });

  it("never sends state, analytics or a manifest on a flat recording", () => {
    flat.forEach((s) => {
      const types = new Set<string>(s.expected.messages.map((m) => m.type));
      ["state", "analytics", "manifest"].forEach((t) => assert.equal(types.has(t), false, `${s.name}: ${t}`));
      assert.equal(s.expected.summaryManifest, null);
    });
  });

  it("delivers no entry for a request that started during a pause", () => {
    const pause = golden.scenarios.find((s) => s.name === "pause-with-state")!;
    const ids = messagesOf(pause, "entry").map(
      (m) => (m as unknown as { entry: { _request_id: string } }).entry._request_id
    );
    assert.deepEqual(ids, ["r1", "r2", "r3"]);
  });

  it("replays the whole analytics backlog on reconnect, with the same ids", () => {
    const reconnect = golden.scenarios.find((s) => s.name === "reconnect-with-analytics-replay")!;
    const analytics = messagesOf(reconnect, "analytics") as unknown as { id: string; event: string }[];
    const firstSeen = analytics.filter((m) => m.event === "group_created");
    assert.equal(firstSeen.length, 2, "group_created is sent live and again in the replay");
    assert.equal(firstSeen[0].id, firstSeen[1].id);
    assert.deepEqual(
      analytics.map((m) => m.event),
      ["group_created", "group_created", "recording_paused", "recording_resumed"]
    );
  });

  it("sends nothing on the port while it is down, and keeps the manifest for the summary", () => {
    const stopped = golden.scenarios.find((s) => s.name === "stop-during-reconnect")!;
    assert.equal(messagesOf(stopped, "complete").length, 0);
    assert.equal(messagesOf(stopped, "manifest").length, 0);
    assert.notEqual(stopped.expected.summaryManifest, null);
  });
});

describe("time-limit stop", () => {
  const TIME_LIMIT_EVENT = "recording_auto_stopped_time_limit";
  const recordAndStop = (reason: "user" | "max-duration", optIn = true): ScenarioOutput =>
    runScenario({
      name: `stop-${reason}`,
      description: "",
      optIn,
      sidePanel: true,
      startTime: 1000,
      steps: [
        { op: "subscribe", t: 1000 },
        { op: "file", t: 1100, id: "r1" },
        ...(optIn ? [{ op: "newGroup" as const, t: 1200 }] : []),
        { op: "file", t: 1300, id: "r2" },
        { op: "stop", t: 2000, reason },
      ],
    });
  const eventsOf = (output: ScenarioOutput) =>
    output.messages.filter((m) => m.type === "analytics").map((m) => (m as unknown as { event: string }).event);

  it("posts the time-limit analytics event before the manifest and complete", () => {
    const types = recordAndStop("max-duration").messages.map((m) =>
      m.type === "analytics" ? (m as unknown as { event: string }).event : m.type
    );
    assert.deepEqual(types.slice(-3), [TIME_LIMIT_EVENT, "manifest", "complete"]);
  });

  it("posts no time-limit event when the user stops", () => {
    assert.equal(eventsOf(recordAndStop("user")).includes(TIME_LIMIT_EVENT), false);
  });

  it("posts no analytics at all for a flat recording that hits the time limit", () => {
    assert.deepEqual(eventsOf(recordAndStop("max-duration", false)), []);
  });
});
