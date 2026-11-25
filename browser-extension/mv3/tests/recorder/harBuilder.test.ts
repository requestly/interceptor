import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSdkEntry,
  resolveSdkStartAge,
  resolveSdkStartedAt,
  SdkNetworkPayload,
} from "../../src/service-worker/services/networkRecording/harBuilder";

const NOW = 2_000_000;
const payload = (extra: Partial<SdkNetworkPayload> = {}): SdkNetworkPayload => ({
  method: "GET",
  url: "https://app.test/api/items",
  status: 200,
  responseTime: 400,
  ...extra,
});

describe("resolveSdkStartedAt", () => {
  it("prefers the page script's stamp", () => {
    assert.equal(resolveSdkStartedAt(payload({ startedAt: NOW - 3000 }), NOW), NOW - 3000);
  });

  it("falls back to now - responseTime when the stamp is missing or not a number", () => {
    assert.equal(resolveSdkStartedAt(payload(), NOW), NOW - 400);
    assert.equal(resolveSdkStartedAt(payload({ startedAt: "x" as unknown as number }), NOW), NOW - 400);
    assert.equal(resolveSdkStartedAt(payload({ startedAt: Number.NaN }), NOW), NOW - 400);
  });

  it("falls back when the stamp is in the future", () => {
    assert.equal(resolveSdkStartedAt(payload({ startedAt: NOW + 1 }), NOW), NOW - 400);
  });

  it("falls back when the stamp is older than responseTime plus 60 s", () => {
    assert.equal(resolveSdkStartedAt(payload({ startedAt: NOW - 400 - 60_000 }), NOW), NOW - 400 - 60_000);
    assert.equal(resolveSdkStartedAt(payload({ startedAt: NOW - 400 - 60_001 }), NOW), NOW - 400);
  });

  it("treats a missing responseTime as zero", () => {
    assert.equal(resolveSdkStartedAt(payload({ responseTime: undefined }), NOW), NOW);
  });
});

describe("resolveSdkStartAge", () => {
  it("prefers the page's monotonic age, even when the wall-clock stamp disagrees", () => {
    assert.equal(resolveSdkStartAge(payload({ startedMsAgo: 900 }), NOW - 300, NOW), 900);
  });

  it("falls back to now - startedAt when the age is missing, not a number or negative", () => {
    assert.equal(resolveSdkStartAge(payload(), NOW - 700, NOW), 700);
    assert.equal(resolveSdkStartAge(payload({ startedMsAgo: Number.NaN }), NOW - 700, NOW), 700);
    assert.equal(resolveSdkStartAge(payload({ startedMsAgo: -1 }), NOW - 700, NOW), 700);
  });

  it("falls back when the age is older than responseTime plus 60 s", () => {
    assert.equal(resolveSdkStartAge(payload({ startedMsAgo: 400 + 60_000 }), NOW - 700, NOW), 400 + 60_000);
    assert.equal(resolveSdkStartAge(payload({ startedMsAgo: 400 + 60_001 }), NOW - 700, NOW), 700);
  });

  it("never returns a negative age", () => {
    assert.equal(resolveSdkStartAge(payload(), NOW + 50, NOW), 0);
  });

  it("adds the time the capture spent in the relay to the page's age", () => {
    assert.equal(resolveSdkStartAge(payload({ startedMsAgo: 900, postedAt: NOW - 250 }), NOW - 300, NOW), 1150);
  });

  it("ignores a relay delay that is negative, missing or implausible", () => {
    assert.equal(resolveSdkStartAge(payload({ startedMsAgo: 900, postedAt: NOW + 40 }), NOW - 300, NOW), 900);
    assert.equal(resolveSdkStartAge(payload({ startedMsAgo: 900, postedAt: Number.NaN }), NOW - 300, NOW), 900);
    assert.equal(resolveSdkStartAge(payload({ startedMsAgo: 900, postedAt: NOW - 60_001 }), NOW - 300, NOW), 900);
  });
});

describe("buildSdkEntry", () => {
  it("dates the entry by the resolved start when one is passed", () => {
    const entry = buildSdkEntry(payload(), "id-1", NOW - 5000);
    assert.equal(entry.startedDateTime, new Date(NOW - 5000).toISOString());
    assert.equal(entry._request_id, "id-1");
  });

  it("derives the start from responseTime when none is passed, as before", () => {
    const before = Date.now();
    const entry = buildSdkEntry(payload(), "id-2");
    const started = new Date(entry.startedDateTime).getTime();
    assert.ok(started >= before - 400 - 5 && started <= Date.now() - 400 + 5);
  });

  it("adds no group field to the HAR entry", () => {
    const entry = buildSdkEntry(payload(), "id-3", NOW);
    assert.equal(
      Object.keys(entry).some((key) => key.toLowerCase().includes("group")),
      false
    );
  });
});
