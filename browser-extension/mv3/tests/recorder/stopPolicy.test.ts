import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StopReason, surfaceActionOnStop } from "../../src/service-worker/services/networkRecording/stopPolicy";

describe("surfaceActionOnStop", () => {
  it("closes the surface on a time-limit stop with closeOnStop, as on a user stop", () => {
    assert.equal(surfaceActionOnStop("max-duration", true), "close");
    assert.equal(surfaceActionOnStop("max-duration", true), surfaceActionOnStop("user", true));
  });

  it("refocuses LTS on a time-limit stop without closeOnStop, as on a user stop", () => {
    assert.equal(surfaceActionOnStop("max-duration", false), "refocus");
    assert.equal(surfaceActionOnStop("max-duration", false), surfaceActionOnStop("user", false));
  });

  it("leaves the surface and focus alone when the recording fails", () => {
    const failures: StopReason[] = ["connection-lost", "extension-disabled", "tab-closed"];
    failures.forEach((reason) => {
      assert.equal(surfaceActionOnStop(reason, true), "none", reason);
      assert.equal(surfaceActionOnStop(reason, false), "none", reason);
    });
  });
});
