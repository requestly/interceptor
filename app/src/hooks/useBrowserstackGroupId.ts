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
 * the existing `window.currentlyActiveWorkspace*` global pattern. The BS EDS
 * integration (which ships via the requestly-cloud `webapp` analytics overlay,
 * not this repo's `modules/analytics`) reads this global and stamps it as a
 * top-level `data.group_id` field on every EDS event — flowing the same way as
 * `browserstack_user_id`. This hook keeps the value in sync from the billing
 * store; it is the interceptor-side source, analogous to how the auth handler
 * exposes `browserstackId`.
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
