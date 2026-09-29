import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Popover } from "antd";
import { CONSTANTS as GLOBAL_CONSTANTS } from "@requestly/requestly-core";
import { getAppMode } from "store/selectors";
import { isFeatureCompatible } from "utils/CompatibilityUtils";
import FEATURES from "config/constants/sub/features";
import { redirectToDesktopSettings } from "utils/RedirectionUtils";
import "./devScriptModeBadge.scss";

const GET_ACTION = "USER_PREFERENCE:GET_DEV_SCRIPT_MODE";

function getDevScriptModePref(): Promise<boolean> | undefined {
  return (window as any)?.RQ?.DESKTOP?.SERVICES?.IPC?.invokeEventInMain("rq-storage:storage-action", {
    type: GET_ACTION,
    payload: {},
  });
}

/**
 * RQ-2426: persistent header indicator shown while Developer Script Mode is ON, so a
 * user can't forget that rule scripts are executing with FULL system access (a
 * shared/imported rule would run unsandboxed silently otherwise).
 *
 * Desktop-only; gated by the same feature flag as the toggle. Polls the preference
 * so the badge reflects a live toggle without a reload. (Simple by design for now —
 * could be made event-driven from the settings toggle later.)
 */
const DevScriptModeBadge: React.FC = () => {
  const appMode = useSelector(getAppMode);
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(false);

  const isDesktop = appMode === GLOBAL_CONSTANTS.APP_MODES.DESKTOP;
  const isCompatible = isFeatureCompatible(FEATURES.DEVELOPER_SCRIPT_MODE);

  useEffect(() => {
    if (!isDesktop || !isCompatible) return;
    let active = true;
    const check = () => {
      getDevScriptModePref()
        ?.then((res: boolean) => {
          if (active) setEnabled(!!res);
        })
        .catch(() => {});
    };
    check();
    const intervalId = setInterval(check, 4000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [isDesktop, isCompatible]);

  if (!isDesktop || !isCompatible || !enabled) {
    return null;
  }

  const popoverContent = (
    <div className="dev-script-mode-badge__popover">
      <div className="dev-script-mode-badge__popover-title">Developer Mode is on</div>
      <div className="dev-script-mode-badge__popover-desc">
        Dynamic (JavaScript) rule scripts run with full system access instead of the secure sandbox. Only keep this on
        for scripts you fully trust.
      </div>
      <a
        className="dev-script-mode-badge__popover-link"
        onClick={() => redirectToDesktopSettings(navigate, window.location.pathname, "dev_mode_badge_popover")}
      >
        Manage in Desktop Settings →
      </a>
    </div>
  );

  return (
    <Popover
      content={popoverContent}
      trigger="hover"
      placement="bottomRight"
      mouseLeaveDelay={0.3}
      overlayClassName="dev-script-mode-badge__popover-overlay"
    >
      <div
        className="dev-script-mode-badge no-drag"
        role="button"
        onClick={() => redirectToDesktopSettings(navigate, window.location.pathname, "dev_mode_badge")}
      >
        <span className="dev-script-mode-badge__dot" />
        Dev Mode
      </div>
    </Popover>
  );
};

export default DevScriptModeBadge;
