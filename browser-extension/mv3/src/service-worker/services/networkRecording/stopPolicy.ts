// Why a recording ended — drives the message the side panel shows.
//   user               – the user clicked Stop in the panel (no banner; just "Stopped")
//   max-duration       – config.maxDuration elapsed (amber banner)
//   connection-lost    – the LTS port disconnected and no reconnect within the grace window (red)
//   tab-closed         – the recorded tab was removed (panel is gone with it; informational only)
//   extension-disabled – the Requestly extension was toggled off mid-recording (red banner)
export type StopReason = "user" | "max-duration" | "connection-lost" | "tab-closed" | "extension-disabled";

export type SurfaceActionOnStop = "close" | "refocus" | "none";

/**
 * What a stop does to the recorded tab or window. The time limit ends a recording the way the user's
 * own Stop does; the other reasons are failures, so the surface and focus stay where they are.
 */
export const surfaceActionOnStop = (reason: StopReason, closeOnStop: boolean): SurfaceActionOnStop => {
  if (reason !== "user" && reason !== "max-duration") return "none";
  return closeOnStop ? "close" : "refocus";
};
