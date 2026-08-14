import { useMemo } from "react";
import { BANNER_ACTIONS, BannerActionConfig } from "../banner.types";
import { useDispatch, useSelector } from "react-redux";
import { globalActions } from "store/slices/global/slice";
import { redirectToUrl } from "utils/RedirectionUtils";
import { getUserAuthDetails } from "store/slices/global/user/selectors";
import LINKS from "config/constants/sub/links";
import { httpsCallable, getFunctions } from "firebase/functions";
import { toast } from "utils/Toast";
import { trackCheckoutFailedEvent, trackCheckoutInitiated } from "modules/analytics/events/misc/business/checkout";
import STORAGE from "config/constants/sub/storage";
import { CONSTANTS as GLOBAL_CONSTANTS } from "@requestly/requestly-core";
import { getAppMode } from "store/selectors";
import { setRedirectMetadata } from "features/onboarding/utils";
import { SOURCE } from "modules/analytics/events/common/constants";

export const useBannerAction = (
  actions: BANNER_ACTIONS[],
  setIsRequestAccessModalOpen?: (value: boolean) => void
): BannerActionConfig[] => {
  const dispatch = useDispatch();
  const user = useSelector(getUserAuthDetails);
  const appMode = useSelector(getAppMode);
  const firebaseFunction = getFunctions();

  const actionMap: Record<BANNER_ACTIONS, BannerActionConfig> = useMemo(
    () => ({
      [BANNER_ACTIONS.UPGRADE]: {
        label: "upgrade",
        type: "primary",
        onClick: () => {
          dispatch(globalActions.toggleActiveModal({ modalName: "pricingModal", newValue: true }));
        },
      },
      [BANNER_ACTIONS.CLAIM_NOW]: {
        label: "Claim now!",
        type: "primary",
        onClick: () => {
          dispatch(globalActions.toggleActiveModal({ modalName: "pricingModal", newValue: true }));
        },
      },
      [BANNER_ACTIONS.CONTACT_US]: {
        label: "contact us",
        type: "default",
        onClick: () => {
          redirectToUrl(LINKS.BOOK_A_DEMO, true);
        },
      },
      [BANNER_ACTIONS.REQUEST_ACCESS]: {
        label: "Request access",
        type: "primary",
        onClick: () => {
          setIsRequestAccessModalOpen(true);
        },
      },
      [BANNER_ACTIONS.REDIRECT_TO_ACCELERATOR_FORM]: {
        label: "Get access",
        type: "primary",
        onClick: () => {
          redirectToUrl(LINKS.ACCELERATOR_PROGRAM_FORM_LINK, true);
        },
      },
      [BANNER_ACTIONS.SEE_PLANS]: {
        label: "See plans",
        type: "primary",
        onClick: () => {
          dispatch(globalActions.toggleActiveModal({ modalName: "pricingModal", newValue: true }));
        },
      },
      [BANNER_ACTIONS.REDIRECT_TO_NOTION_PAGE]: {
        label: "Share Now",
        type: "primary",
        onClick: () => {
          redirectToUrl(LINKS.NOTION_PAGE_FOR_PROMOTION, true);
        },
      },
      [BANNER_ACTIONS.MERGE_BSTACK_ACCOUNT]: {
        label: "Sign in",
        type: "primary",
        onClick: () => {
          // Brings a web user back to the page they started from. LoginHandler reads and clears
          // this after the token exchange. Harmless on desktop, where the OAuth flow runs in a
          // different browser and nothing reads it back.
          setRedirectMetadata({
            source: SOURCE.AUTH_MIGRATION_BANNER,
            redirectURL: window.location.href,
          });

          if (appMode === GLOBAL_CONSTANTS.APP_MODES.DESKTOP) {
            // redirectToUrl is window.open(url, "_self"), which would navigate the whole Electron
            // window away from the app. Hand the URL to the system browser instead.
            window.RQ?.DESKTOP?.SERVICES?.IPC?.invokeEventInBG("open-external-link", {
              link: LINKS.OAUTH_REDIRECT_URL,
            });
            return;
          }

          redirectToUrl(LINKS.OAUTH_REDIRECT_URL);
        },
      },
      [BANNER_ACTIONS.REDIRECT_TO_LINKEDIN_FORM]: {
        label: "Share Now",
        type: "primary",
        onClick: () => {
          redirectToUrl(LINKS.SHARE_ON_LINKEDIN_FORM, true);
        },
      },
      [BANNER_ACTIONS.REDIRECT_TO_CHROME_STORE_REVIEWS]: {
        label: "Review Now",
        type: "primary",
        onClick: () => {
          localStorage.setItem(STORAGE.LOCAL_STORAGE.REDIRECT_TO_CHROME_STORE_REVIEW, "true");
          redirectToUrl(LINKS.CHROME_STORE_REVIEW_FORM, true);
        },
      },
      [BANNER_ACTIONS.CONVERT_TO_ANNUAL_PLAN]: {
        label: "See details",
        type: "primary",
        onClick: () => {
          const manageSubscription = httpsCallable(firebaseFunction, "subscription-manageSubscription");

          manageSubscription({
            planName: user?.details?.planDetails?.planName,
            duration: "annually",
            portalFlowType: "update_subscription",
            monthlyConversionToAnnual: true,
          })
            .then((res: any) => {
              if (res?.data?.success) {
                window.location.href = res.data.data.portalUrl;

                trackCheckoutInitiated({
                  plan_name: user?.details?.planDetails?.planName,
                  duration: "annually",
                  currency: "usd",
                  quantity: user?.details?.planDetails?.subscription?.quantity,
                  source: "monthly_to_annual_conversion",
                });
              }
            })
            .catch(() => {
              toast.error("Error in converting to annual plan. Contact support at contact@requestly.io");
              trackCheckoutFailedEvent(
                user?.details?.planDetails?.subscription?.quantity,
                "monthly_to_annual_conversion",
                "requestly"
              );
            });
        },
      },
    }),
    [dispatch, firebaseFunction, user?.details?.planDetails, setIsRequestAccessModalOpen, appMode]
  );

  return actions.map((action) => actionMap[action]).filter(Boolean);
};
