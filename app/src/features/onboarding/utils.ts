import * as Sentry from "@sentry/react";
import PATHS from "config/constants/sub/paths";
import STORAGE from "config/constants/sub/storage";
import { isEnvAutomation } from "utils/EnvUtils";

const EXCLUDED_PATHS = [
  PATHS.AUTH.SIGN_IN.RELATIVE,
  PATHS.AUTH.SIGN_UP.RELATIVE,
  PATHS.AUTH.DEKSTOP_SIGN_IN.RELATIVE,
  "/invite",
  PATHS.AUTH.EMAIL_ACTION.RELATIVE,
  PATHS.AUTH.EMAIL_LINK_SIGNIN.RELATIVE,
  PATHS.SESSIONS.SAVED.RELATIVE,
  PATHS.APPSUMO.RELATIVE,
  PATHS.PRICING.RELATIVE,
  PATHS.AUTH.START.RELATIVE,
  PATHS.AUTH.LOGIN.RELATIVE,
  PATHS._INSTALLED_EXTENSION.RELATIVE,
];

export const shouldShowOnboarding = () => {
  if (isEnvAutomation()) return false;

  const currentPath = window.location.href;
  return !EXCLUDED_PATHS.some((path) => currentPath.includes(path));
};

// Routes that only exist to run the auth flow, so they can never be a post auth destination.
// Sending a user back to one of them drops them on the form they just completed.
const AUTH_FLOW_PATHS = [
  PATHS.AUTH.SIGN_IN.RELATIVE,
  PATHS.AUTH.SIGN_UP.RELATIVE,
  PATHS.AUTH.LOGIN.RELATIVE,
  PATHS.AUTH.START.RELATIVE,
  PATHS.AUTH.FORGOT_PASSWORD.RELATIVE,
  PATHS.AUTH.RESET_PASSWORD.RELATIVE,
];

export const isAuthFlowPath = (url?: string): boolean => {
  if (!url) return false;

  let pathname: string;
  try {
    pathname = new URL(url, window.location.origin).pathname;
  } catch {
    // not a URL we can reason about, leave it to the caller
    return false;
  }

  const currentPath = pathname.replace(/\/+$/, "").toLowerCase() || "/";
  return AUTH_FLOW_PATHS.some((path) => {
    const authPath = path.toLowerCase();
    return currentPath === authPath || currentPath.startsWith(`${authPath}/`);
  });
};

type RedirectMetadata = {
  source: string;
  redirectURL: string;
};

export const setRedirectMetadata = ({ source, redirectURL }: RedirectMetadata): void => {
  const metadata: RedirectMetadata = {
    source,
    // the auth pages capture their own location as the redirect target, which would loop the user back to them
    redirectURL: isAuthFlowPath(redirectURL) ? "" : redirectURL,
  };

  try {
    window.localStorage.setItem(STORAGE.LOCAL_STORAGE.AUTH_REDIRECT_METADATA_KEY, JSON.stringify(metadata));
  } catch (error) {
    Sentry.captureException(error, {
      extra: { metadata },
    });
  }
};

export const getRedirectMetadata = () => {
  let metadata = null;

  try {
    metadata = window.localStorage.getItem(STORAGE.LOCAL_STORAGE.AUTH_REDIRECT_METADATA_KEY);
    return JSON.parse(metadata) as RedirectMetadata;
  } catch (error) {
    Sentry.captureException(error, {
      extra: { metadata },
    });
  }
};

export const clearRedirectMetadata = () => {
  window.localStorage.removeItem(STORAGE.LOCAL_STORAGE.AUTH_REDIRECT_METADATA_KEY);
};
