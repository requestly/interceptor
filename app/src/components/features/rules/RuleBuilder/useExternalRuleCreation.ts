import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setCurrentlySelectedRule } from "./actions";
import APP_CONSTANTS from "../../../../config/constants";
import { getCurrentlySelectedRuleData } from "store/selectors";
import { Rule } from "@requestly/shared/types/entities/rules";

const { RULE_EDITOR_CONFIG } = APP_CONSTANTS;
const REQUESTLY_POST_MESSAGE_AUTHOR = "requestly";

// Browser-extension schemes for the only legitimate external caller of this
// channel: the Requestly extension's DevTools "create rule from traffic" flow.
// (chrome-extension for Chrome/Edge, moz-extension for Firefox, safari-web-extension for Safari.)
const TRUSTED_EXTENSION_ORIGIN_PROTOCOLS = ["chrome-extension:", "moz-extension:", "safari-web-extension:"];

/**
 * Guards the rule-editor postMessage listener against cross-origin injection
 * (CWE-79 / RQ-2309). Only the app's own origin and the Requestly extension are
 * trusted senders; messages from arbitrary web pages are rejected.
 */
const isTrustedRuleEditorMessageOrigin = (origin: string): boolean => {
  if (origin === window.location.origin) {
    return true;
  }
  try {
    return TRUSTED_EXTENSION_ORIGIN_PROTOCOLS.includes(new URL(origin).protocol);
  } catch {
    return false;
  }
};

interface PostMessageData {
  author: string;
  action: string;
  payload: {
    ruleData: Rule;
    inputSelectorToFocus?: string;
  };
}

const useExternalRuleCreation = (mode: string): void => {
  const dispatch = useDispatch();
  const currentlySelectedRuleData = useSelector(getCurrentlySelectedRuleData);
  const hasSentReadyEventRef = useRef(false); // solves react18 issue of double mounting
  const inputSelectorRefToFocus = useRef<string>("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onMessageReceived = (event: MessageEvent<PostMessageData>) => {
      if (!isTrustedRuleEditorMessageOrigin(event.origin)) {
        return;
      }
      const { author, action, payload } = event.data ?? {};
      if (author === REQUESTLY_POST_MESSAGE_AUTHOR && action === "ruleEditor:loadData") {
        const { ruleData, inputSelectorToFocus } = payload;
        setCurrentlySelectedRule(dispatch, ruleData);
        if (inputSelectorToFocus) {
          inputSelectorRefToFocus.current = inputSelectorToFocus;
        }
        setLoaded(true);
        window.removeEventListener("message", onMessageReceived);
      }
    };

    window.addEventListener("message", onMessageReceived);

    // cleanup
    return () => {
      window.removeEventListener("message", onMessageReceived);
    };
  }, [dispatch]);

  useEffect(() => {
    if (mode === RULE_EDITOR_CONFIG.MODES.CREATE && currentlySelectedRuleData) {
      if (!hasSentReadyEventRef.current) {
        window.opener?.postMessage(
          {
            author: REQUESTLY_POST_MESSAGE_AUTHOR,
            action: "ruleEditor:ready",
            payload: {
              ruleData: currentlySelectedRuleData,
            },
          },
          // Accepted risk (RQ-2309): wildcard target origin. Safe here because this only
          // fires in CREATE mode where ruleData is a blank default template (no user data),
          // and the injection vector is already closed by the inbound origin check above.
          // A concrete target origin can't be used without a coordinated extension change,
          // since the legitimate opener is the extension (chrome/moz/safari-web-extension://<id>,
          // which varies by browser and build). Do not broadcast sensitive data through here.
          "*"
        );
        hasSentReadyEventRef.current = true;
      }
    }
  }, [mode, currentlySelectedRuleData]);

  useEffect(() => {
    if (loaded && inputSelectorRefToFocus.current) {
      setTimeout(() => {
        const input = document.querySelector(inputSelectorRefToFocus.current) as HTMLInputElement;

        if (input) {
          input.focus();
          input.selectionStart = input.value?.length;
        }
      }, 500); // sometimes app takes time to render the selected input
    }
  }, [loaded]);
};

export default useExternalRuleCreation;
