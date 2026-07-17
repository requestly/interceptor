import { useEffect } from "react";
import { useSelector } from "react-redux";
import { getUserBrowserstackGroupId } from "store/features/billing/selectors";

declare global {
  interface Window {
    currentlyActiveBrowserstackGroupId: string | null | undefined;
  }
}

/**
 * Exposes the signed-in user's BrowserStack group id on `window`, mirroring
 * the existing `window.currentlyActiveWorkspace*` global pattern. The analytics
 * enrichment choke-point (`modules/analytics/index.js` → `trackEvent`) is a
 * plain function, not a hook, so it reads attribution off `window` globals;
 * this hook keeps the group id in sync from the billing store.
 *
 * Group is a property of the USER (not the workspace) — sourced from the user's
 * BS-linked billing team (`browserstackGroupId`). Feeds BrowserStack Usage
 * Reports group attribution. See RQ-4675 and the track design doc.
 */
export const useBrowserstackGroupId = () => {
  const browserstackGroupId = useSelector(getUserBrowserstackGroupId);

  useEffect(() => {
    window.currentlyActiveBrowserstackGroupId = browserstackGroupId ?? null;
  }, [browserstackGroupId]);
};
