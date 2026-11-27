import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RecordingGroups } from "../../src/service-worker/services/networkRecording/recordingGroups";
import { resolveSdkStartAge, SdkNetworkPayload } from "../../src/service-worker/services/networkRecording/harBuilder";
import { validateGroupName } from "common/networkRecordingProtocol";

const T0 = 1_000_000;

const make = () => {
  let clock = T0;
  let counter = 0;
  const groups = new RecordingGroups({ startTime: T0, now: () => clock, newId: () => `id-${++counter}` });
  return {
    groups,
    at: (t: number) => {
      clock = t;
    },
  };
};

// A wall clock that can step back, and a monotonic clock that only moves when time really passes.
const makeWithClocks = () => {
  let wall = T0;
  let monotonic = 0;
  let counter = 0;
  const groups = new RecordingGroups({
    startTime: T0,
    now: () => wall,
    monotonicNow: () => monotonic,
    newId: () => `id-${++counter}`,
  });
  return {
    groups,
    wall: () => wall,
    pass: (ms: number) => {
      wall += ms;
      monotonic += ms;
    },
    stepBack: (ms: number) => {
      wall -= ms;
    },
    monotonic: () => monotonic,
  };
};

const manifestIds = (groups: RecordingGroups) => groups.buildManifest().groups.map((g) => g.requestIds);

describe("validateGroupName", () => {
  const cases: [string, string[], string][] = [
    ["", [], "empty"],
    ["   ", [], "empty"],
    ["a\nb", [], "line-break"],
    ["Login\n", [], "line-break"],
    ["a\u2028b", [], "line-break"],
    ["a\u2029b", [], "line-break"],
    ["a\rb", [], "line-break"],
    ["a::b", [], "reserved-chars"],
    ["::", [], "reserved-chars"],
    [":Login", [], "edge-colon"],
    ["Login:", [], "edge-colon"],
    ["x".repeat(61), [], "too-long"],
    ["Login", ["Login"], "duplicate"],
    ["  Login  ", ["Login"], "duplicate"],
  ];

  for (const [name, others, reason] of cases) {
    it(`rejects ${JSON.stringify(name.slice(0, 12))} as ${reason}`, () => {
      assert.deepEqual(validateGroupName(name, others), { ok: false, reason });
    });
  }

  it("accepts 60 characters, counting an emoji as one", () => {
    assert.equal(validateGroupName("x".repeat(60), []).ok, true);
    assert.equal(validateGroupName("😀".repeat(60), []).ok, true);
    assert.equal(validateGroupName("😀".repeat(61), []).ok, false);
  });

  it("treats names that differ in case or inner spaces as different", () => {
    assert.equal(validateGroupName("login", ["Login"]).ok, true);
    assert.equal(validateGroupName("Log in", ["Login"]).ok, true);
  });

  it("accepts a single colon inside a name and trims the result", () => {
    assert.deepEqual(validateGroupName("  Step 1: Login ", []), { ok: true, name: "Step 1: Login" });
  });
});

describe("filing by start time", () => {
  it("starts with a renameable Default group", () => {
    const { groups } = make();
    const view = groups.buildView();
    assert.equal(view.groups.length, 1);
    assert.equal(view.groups[0].name, "Default group");
    assert.equal(view.groups[0].isDefault, true);
    assert.equal(groups.rename(view.groups[0].id, "Landing").ok, true);
    assert.equal(groups.buildView().groups[0].name, "Landing");
  });

  it("keeps a request in the group active when it STARTED, even if it finishes after a new group", () => {
    const { groups, at } = make();
    groups.file("a1", T0 + 100);
    at(T0 + 1000);
    groups.newGroup();
    // Started at +900 (before the new group), reported at +1500.
    assert.equal(groups.file("slow", T0 + 900), groups.buildView().groups[0].id);
    // Started at +1000, the boundary instant: belongs to the new group.
    assert.equal(groups.file("edge", T0 + 1000), groups.buildView().groups[1].id);
    assert.deepEqual(manifestIds(groups), [["a1", "slow"], ["edge"]]);
  });

  it("files by completion order within a group", () => {
    const { groups } = make();
    groups.file("second-started-first-done", T0 + 50);
    groups.file("first-started-last-done", T0 + 10);
    assert.deepEqual(manifestIds(groups), [["second-started-first-done", "first-started-last-done"]]);
  });

  it("files a time before the recording started into the first group", () => {
    const { groups } = make();
    assert.equal(groups.file("early", T0 - 5000), groups.buildView().groups[0].id);
  });

  it("is idempotent for a repeated request id", () => {
    const { groups } = make();
    groups.file("a", T0 + 1);
    groups.file("a", T0 + 2);
    assert.deepEqual(manifestIds(groups), [["a"]]);
  });
});

describe("pause", () => {
  it("drops a request that started during the pause, whenever it finishes", () => {
    const { groups, at } = make();
    at(T0 + 100);
    assert.equal(groups.pause(), true);
    at(T0 + 500);
    assert.equal(groups.resume(), true);
    assert.equal(groups.file("during", T0 + 300), null);
    assert.deepEqual(manifestIds(groups), []);
  });

  it("keeps a request that started before the pause and finished during it", () => {
    const { groups, at } = make();
    groups.file("before", T0 + 50);
    at(T0 + 100);
    groups.pause();
    assert.notEqual(groups.file("before-2", T0 + 80), null);
    assert.deepEqual(manifestIds(groups), [["before", "before-2"]]);
  });

  it("treats the pause start as paused and the resume instant as recording", () => {
    const { groups, at } = make();
    at(T0 + 100);
    groups.pause();
    at(T0 + 200);
    groups.resume();
    assert.equal(groups.file("at-pause", T0 + 100), null);
    assert.equal(groups.file("at-resume", T0 + 200) === null, false);
  });

  it("drops starts inside an open pause", () => {
    const { groups, at } = make();
    at(T0 + 100);
    groups.pause();
    assert.equal(groups.file("x", T0 + 5000), null);
  });

  it("counts time paused, including a pause still open, and closes it at stop", () => {
    const { groups, at } = make();
    at(T0 + 1000);
    groups.pause();
    at(T0 + 3000);
    groups.resume();
    at(T0 + 4000);
    groups.pause();
    assert.equal(groups.pausedMs(T0 + 4500), 2500);
    at(T0 + 6000);
    groups.stop();
    const manifest = groups.buildManifest();
    assert.equal(manifest.stats.pausedMs, 4000);
    assert.equal(manifest.stats.pauses, 2);
  });

  it("refuses a second pause and a resume while not paused", () => {
    const { groups } = make();
    assert.equal(groups.resume(), false);
    assert.equal(groups.pause(), true);
    assert.equal(groups.pause(), false);
  });
});

describe("when the wall clock steps back", () => {
  it("files by real order after a New group, for webRequest stamps and SDK ages alike", () => {
    const { groups, wall, pass, stepBack } = makeWithClocks();
    pass(900);
    const slow = groups.fromWallClock(wall()); // starts before the New group, finishes after the step
    pass(100);
    groups.newGroup(); // +1000
    stepBack(600);
    pass(100); // really +1100, the wall clock reads +500
    const fresh = groups.fromWallClock(wall());
    pass(200);
    const [first, second] = groups.buildView().groups.map((g) => g.id);
    assert.equal(groups.file("fresh", fresh), second);
    assert.equal(groups.file("slow", slow), first);
    assert.equal(groups.file("sdk-after", groups.msAgo(250)), second); // started at +1050
    assert.equal(groups.file("sdk-before", groups.msAgo(400)), first); // started at +900
    assert.deepEqual(manifestIds(groups), [
      ["slow", "sdk-before"],
      ["fresh", "sdk-after"],
    ]);
  });

  it("files an SDK capture by its start even when it reaches the worker late, across a pause", () => {
    const { groups, wall, pass } = makeWithClocks();
    pass(1000); // the request starts at +1000
    pass(100);
    const capture = { startedMsAgo: 100, postedAt: wall() }; // posted at +1100
    pass(50);
    groups.pause(); // +1150
    pass(250); // delivered at +1400, during the pause
    const age = (extra: Partial<SdkNetworkPayload>) =>
      resolveSdkStartAge(
        { method: "GET", url: "https://a.test/x", status: 200, responseTime: 50, ...extra },
        wall() - 400,
        wall()
      );
    assert.equal(groups.file("late", groups.msAgo(age(capture))), groups.buildView().groups[0].id);
    assert.equal(groups.file("late-no-relay", groups.msAgo(age({ startedMsAgo: 100 }))), null);
  });

  it("files a late SDK capture by its start when the wall clock steps back during the relay", () => {
    const { groups, wall, pass, stepBack, monotonic } = makeWithClocks();
    pass(1000); // the request starts at +1000
    pass(100);
    const capture = { startedMsAgo: 100, postedAt: wall(), postedAtHr: monotonic() }; // posted at +1100
    pass(50);
    groups.pause(); // +1150
    stepBack(600); // during the relay
    pass(250); // delivered at +1400, the wall clock reads +800
    const age = (extra: Partial<SdkNetworkPayload>) =>
      resolveSdkStartAge(
        { method: "GET", url: "https://a.test/x", status: 200, responseTime: 50, ...extra },
        wall() - 400,
        wall(),
        monotonic()
      );
    assert.equal(groups.file("late", groups.msAgo(age(capture))), groups.buildView().groups[0].id);
    assert.equal(
      groups.file("late-wall-only", groups.msAgo(age({ startedMsAgo: 100, postedAt: capture.postedAt }))),
      null
    );
  });

  it("files a late SDK capture into the group that was active when it started", () => {
    const { groups, wall, pass } = makeWithClocks();
    groups.file("r0", groups.fromWallClock(wall()));
    pass(1000); // the request starts at +1000, in Default group
    pass(100);
    const capture = { startedMsAgo: 100, postedAt: wall() }; // posted at +1100
    pass(50);
    groups.newGroup(); // +1150
    pass(250); // delivered at +1400
    const [first, second] = groups.buildView().groups.map((g) => g.id);
    const age = (extra: Partial<SdkNetworkPayload>) =>
      resolveSdkStartAge(
        { method: "GET", url: "https://a.test/x", status: 200, responseTime: 50, ...extra },
        wall() - 400,
        wall()
      );
    assert.equal(groups.file("late", groups.msAgo(age(capture))), first);
    assert.equal(groups.file("late-no-relay", groups.msAgo(age({ startedMsAgo: 100 }))), second);
  });

  it("drops a request that starts during a pause taken after the step, and keeps the rest", () => {
    const { groups, wall, pass, stepBack } = makeWithClocks();
    pass(1000);
    groups.newGroup(); // +1000
    pass(200);
    const beforePause = groups.fromWallClock(wall()); // +1200
    stepBack(600);
    pass(100);
    groups.pause(); // really +1300, the wall clock reads +700
    pass(100);
    const duringPause = groups.fromWallClock(wall()); // really +1400, stamped +800
    const spansPause = groups.msAgo(250); // started at +1150, finishes during the pause
    pass(100);
    groups.resume(); // +1500
    pass(50);
    const afterResume = groups.fromWallClock(wall());
    const second = groups.buildView().groups[1].id;
    assert.equal(groups.file("during", duringPause), null);
    assert.equal(groups.file("before", beforePause), second);
    assert.equal(groups.file("spans", spansPause), second);
    assert.equal(groups.file("after", afterResume), second);
    assert.equal(groups.pausedMs(), 200);
  });

  it("does not drop a request that starts after Resume when the clock steps back behind the pause", () => {
    const { groups, wall, pass, stepBack } = makeWithClocks();
    pass(100);
    groups.pause();
    pass(400);
    groups.resume(); // +500
    stepBack(300);
    pass(50); // really +550, the wall clock reads +250, inside the pause
    assert.notEqual(groups.file("after-resume", groups.fromWallClock(wall())), null);
    assert.equal(groups.buildView().pausedMsClosed, 400);
  });

  it("counts the time that really passed in a pause the step happened during", () => {
    const { groups, pass, stepBack } = makeWithClocks();
    pass(1000);
    groups.pause();
    pass(100);
    stepBack(600);
    pass(300);
    groups.resume();
    assert.equal(groups.buildView().pausedMsClosed, 400);
  });

  it("stays on the wall clock while the wall clock runs forward", () => {
    const { groups, wall, pass } = makeWithClocks();
    pass(100);
    groups.pause();
    pass(400);
    groups.resume();
    pass(500);
    groups.newGroup();
    pass(100);
    assert.equal(groups.fromWallClock(wall() - 30), wall() - 30);
    assert.equal(groups.msAgo(30), wall() - 30);
    const [first, second] = groups.buildView().groups.map((g) => g.id);
    assert.equal(groups.file("before-pause", T0 + 50), first);
    assert.equal(groups.file("in-pause", T0 + 300), null);
    assert.equal(groups.file("after-resume", T0 + 600), first);
    assert.equal(groups.file("new-group", T0 + 1000), second);
    assert.equal(groups.buildView().pausedMsClosed, 400);
  });
});

describe("new group and rename", () => {
  it("numbers new groups Group N after the groups already there", () => {
    const { groups, at } = make();
    groups.file("r0", T0 + 1);
    at(T0 + 10);
    groups.newGroup();
    groups.file("r1", T0 + 11);
    at(T0 + 20);
    groups.newGroup();
    groups.file("r2", T0 + 21);
    assert.deepEqual(
      groups.buildView().groups.map((g) => g.name),
      ["Default group", "Group 1", "Group 2"]
    );
  });

  it("skips a number that was taken by a rename", () => {
    const { groups, at } = make();
    groups.file("r0", T0 + 1);
    at(T0 + 10);
    const first = groups.newGroup();
    groups.file("r1", T0 + 11);
    groups.rename((first as { groupId: string }).groupId, "Group 2");
    at(T0 + 20);
    groups.newGroup();
    assert.equal(groups.buildView().groups[2].name, "Group 3");
  });

  it("adds another group even when the newest one is empty", () => {
    const { groups, at } = make();
    groups.file("r0", T0 + 1);
    at(T0 + 10);
    const first = groups.newGroup();
    const revision = groups.revision;
    at(T0 + 20);
    const second = groups.newGroup();
    assert.notEqual(second.ok && second.groupId, first.ok && first.groupId);
    assert.equal(groups.buildView().groups.length, 3);
    assert.ok(groups.revision > revision);
    assert.equal(groups.buildView().activeGroupId, second.ok && second.groupId);
  });

  it("adds a group while the Default group is still empty", () => {
    const { groups } = make();
    const result = groups.newGroup();
    assert.equal(result.ok, true);
    assert.equal(groups.buildView().groups.length, 2);
  });

  it("leaves empty groups out of the manifest", () => {
    const { groups, at } = make();
    at(T0 + 10);
    groups.newGroup();
    at(T0 + 20);
    groups.newGroup();
    groups.file("r1", T0 + 21);
    assert.equal(groups.buildView().groups.length, 3);
    assert.deepEqual(manifestIds(groups), [["r1"]]);
  });

  it("keeps the previous name when a rename is rejected", () => {
    const { groups } = make();
    const id = groups.buildView().groups[0].id;
    assert.deepEqual(groups.rename(id, "a::b"), { ok: false, reason: "reserved-chars" });
    assert.equal(groups.buildView().groups[0].name, "Default group");
  });

  it("rejects a duplicate but allows renaming a group to its own name", () => {
    const { groups, at } = make();
    groups.file("r0", T0 + 1);
    at(T0 + 10);
    const second = groups.newGroup();
    const id = second.ok ? second.groupId : "";
    assert.deepEqual(groups.rename(id, " Default group "), { ok: false, reason: "duplicate" });
    assert.deepEqual(groups.rename(id, "Group 1"), { ok: true });
  });

  it("rejects an unknown group", () => {
    const { groups } = make();
    assert.deepEqual(groups.rename("nope", "x"), { ok: false, reason: "unknown-group" });
  });
});

describe("move", () => {
  const seeded = () => {
    const ctx = make();
    ["a", "b", "c"].forEach((id, i) => ctx.groups.file(id, T0 + 10 + i));
    ctx.at(T0 + 100);
    ctx.groups.newGroup();
    ["d", "e"].forEach((id, i) => ctx.groups.file(id, T0 + 110 + i));
    const [g1, g2] = ctx.groups.buildView().groups.map((g) => g.id);
    return { ...ctx, g1, g2 };
  };

  it("appends to the end of the target in the requests' original relative order", () => {
    const { groups, g2 } = seeded();
    const result = groups.move(["c", "a"], g2);
    assert.equal(result.ok && result.count, 2);
    assert.deepEqual(manifestIds(groups), [["b"], ["d", "e", "a", "c"]]);
  });

  it("skips requests already in the target, unknown ids and deleted ids", () => {
    const { groups, g2 } = seeded();
    groups.delete(["b"]);
    const result = groups.move(["d", "b", "ghost", "a"], g2);
    assert.equal(result.ok && result.count, 1);
    assert.deepEqual(manifestIds(groups), [["c"], ["d", "e", "a"]]);
  });

  it("reports nothing to do and an unknown target", () => {
    const { groups, g2 } = seeded();
    assert.deepEqual(groups.move(["d"], g2), { ok: false, reason: "nothing-to-do" });
    assert.deepEqual(groups.move(["a"], "nope"), { ok: false, reason: "unknown-group" });
  });

  it("drops an emptied group from the manifest but keeps it in the panel view", () => {
    const { groups, g1, g2 } = seeded();
    groups.move(["a", "b", "c"], g2);
    assert.deepEqual(manifestIds(groups), [["d", "e", "a", "b", "c"]]);
    assert.equal(groups.buildView().groups.length, 2);
    assert.equal(groups.buildView().groups[0].id, g1);
  });
});

describe("delete and undo", () => {
  const seeded = () => {
    const ctx = make();
    ["a", "b", "c", "d"].forEach((id, i) => ctx.groups.file(id, T0 + 10 + i));
    ctx.at(T0 + 100);
    ctx.groups.newGroup();
    ctx.groups.file("e", T0 + 110);
    return { ...ctx, g2: ctx.groups.buildView().groups[1].id };
  };

  it("soft-deletes: removed from groups, listed in deletedRequestIds, counted", () => {
    const { groups } = seeded();
    const result = groups.delete(["b", "c"]);
    assert.equal(result.ok && result.count, 2);
    const manifest = groups.buildManifest();
    assert.deepEqual(manifest.groups[0].requestIds, ["a", "d"]);
    assert.deepEqual(manifest.deletedRequestIds, ["b", "c"]);
    assert.equal(groups.deletedCount, 2);
  });

  it("undo of a delete restores the original positions, including a bulk delete", () => {
    const { groups } = seeded();
    const op = groups.delete(["a", "c"]);
    assert.deepEqual(groups.undo(op.ok ? op.opId : ""), { ok: true, kind: "delete", count: 2 });
    assert.deepEqual(manifestIds(groups), [["a", "b", "c", "d"], ["e"]]);
    assert.equal(groups.deletedCount, 0);
  });

  it("undo of a move returns each request to its original group and index", () => {
    const { groups, g2 } = seeded();
    const op = groups.move(["b", "d"], g2);
    assert.deepEqual(manifestIds(groups), [
      ["a", "c"],
      ["e", "b", "d"],
    ]);
    assert.equal(groups.undo(op.ok ? op.opId : "").ok, true);
    assert.deepEqual(manifestIds(groups), [["a", "b", "c", "d"], ["e"]]);
  });

  it("keeps requests that arrived after the operation when it is undone", () => {
    const { groups, at } = seeded();
    const op = groups.delete(["b"]);
    at(T0 + 200);
    groups.file("late", T0 + 150);
    groups.undo(op.ok ? op.opId : "");
    assert.deepEqual(manifestIds(groups), [
      ["a", "b", "c", "d"],
      ["e", "late"],
    ]);
  });

  it("keeps ONE undo record: the next operation replaces it and a stale opId is rejected", () => {
    const { groups, g2 } = seeded();
    const first = groups.delete(["a"]);
    const second = groups.move(["b"], g2);
    assert.deepEqual(groups.undo(first.ok ? first.opId : ""), { ok: false, reason: "stale" });
    assert.equal(groups.undo(second.ok ? second.opId : "").ok, true);
    assert.deepEqual(groups.undo(second.ok ? second.opId : ""), { ok: false, reason: "stale" });
  });

  it("makes undo invalid after Stop", () => {
    const { groups } = seeded();
    const op = groups.delete(["a"]);
    groups.stop();
    assert.deepEqual(groups.undo(op.ok ? op.opId : ""), { ok: false, reason: "stale" });
  });

  it("ignores ids that do not exist or are already deleted", () => {
    const { groups } = seeded();
    groups.delete(["a"]);
    assert.deepEqual(groups.delete(["a", "ghost"]), { ok: false, reason: "nothing-to-do" });
  });
});

describe("manifest, state and analytics", () => {
  it("lists groups in creation order, marks the first as Default even if renamed", () => {
    const { groups, at } = make();
    groups.file("a", T0 + 1);
    at(T0 + 10);
    groups.newGroup();
    groups.file("b", T0 + 11);
    groups.rename(groups.buildView().groups[0].id, "Landing");
    const manifest = groups.buildManifest();
    assert.deepEqual(
      manifest.groups.map((g) => [g.name, g.isDefault]),
      [
        ["Landing", true],
        ["Group 1", false],
      ]
    );
    assert.equal(manifest.version, 1);
  });

  it("raises the revision on every change and starts at 1", () => {
    const { groups, at } = make();
    const seen = [groups.revision];
    groups.file("a", T0 + 1);
    seen.push(groups.revision);
    at(T0 + 5);
    groups.pause();
    seen.push(groups.revision);
    groups.resume();
    seen.push(groups.revision);
    assert.equal(seen[0], 1);
    assert.deepEqual(
      seen,
      [...seen].sort((x, y) => x - y)
    );
    assert.equal(new Set(seen).size, seen.length);
  });

  it("builds the port state message", () => {
    const { groups, at } = make();
    at(T0 + 100);
    groups.pause();
    at(T0 + 400);
    const state = groups.buildState(42);
    assert.equal(state.type, "state");
    assert.equal(state.targetTabId, 42);
    assert.equal(state.paused, true);
    assert.equal(state.pausedMs, 300);
    assert.equal(state.activeGroupId, groups.buildView().groups[0].id);
    assert.equal(state.deletedCount, 0);
  });

  it("emits one analytics event per action with counts and booleans only", () => {
    const seen: unknown[] = [];
    const g = new RecordingGroups({
      startTime: T0,
      now: () => T0 + 1,
      newId: (() => {
        let n = 0;
        return () => `e-${++n}`;
      })(),
      onEvent: (e) => seen.push(e),
    });
    g.file("a", T0 + 1);
    g.file("b", T0 + 2);
    g.rename(g.buildView().groups[0].id, "Secret name");
    g.newGroup();
    g.move(["a", "b"], g.buildView().groups[1].id);
    g.pause();
    g.resume();
    assert.deepEqual(
      (seen as { event: string }[]).map((e) => e.event),
      ["group_renamed", "group_created", "requests_moved", "recording_paused", "recording_resumed"]
    );
    assert.deepEqual((seen as { props: unknown }[])[2].props, { count: 2, bulk: true });
    assert.equal(JSON.stringify(seen).includes("Secret name"), false, "group names never travel in analytics");
    assert.equal(new Set((seen as { id: string }[]).map((e) => e.id)).size, seen.length);
  });

  it("keeps at most 500 events in the backlog, dropping the oldest", () => {
    const { groups } = make();
    for (let i = 0; i < 520; i += 1) {
      groups.pause();
      groups.resume();
    }
    const backlog = groups.analyticsBacklog();
    assert.equal(backlog.length, 500);
    assert.equal(groups.buildManifest().stats.pauses, 520);
  });

  it("counts operations in stats", () => {
    const { groups, at } = make();
    groups.file("a", T0 + 1);
    groups.file("b", T0 + 2);
    at(T0 + 10);
    groups.newGroup();
    groups.rename(groups.buildView().groups[1].id, "Checkout");
    const move = groups.move(["a", "b"], groups.buildView().groups[1].id);
    groups.undo(move.ok ? move.opId : "");
    groups.delete(["a"]);
    const { stats } = groups.buildManifest();
    assert.deepEqual(
      { ...stats, pausedMs: 0 },
      { groupsCreated: 1, renames: 1, moves: 1, deletes: 1, undos: 1, pauses: 0, pausedMs: 0 }
    );
  });
});
