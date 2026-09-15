import { trackEvent } from "modules/analytics";
import PATHS from "config/constants/sub/paths";
import { PAGE_VIEW } from "./constants";

export const trackPageViewEvent = (path, params = {}) => {
  // Ignore extension-updated page view events for now
  if (path === PATHS.EXTENSION_UPDATED.RELATIVE) return;

  // The install-success screen fires "extension_installed" instead of a page view
  if (path === PATHS._INSTALLED_EXTENSION.RELATIVE) return;

  trackEvent(PAGE_VIEW, { ...params, path });
};
