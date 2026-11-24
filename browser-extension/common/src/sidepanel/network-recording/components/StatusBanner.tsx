import React from "react";
import { Icon, IconName } from "./icons";

export type BannerVariant = "error" | "warning" | "info";

interface StatusBannerProps {
  variant: BannerVariant;
  icon: IconName;
  children: React.ReactNode;
  onClose?: () => void;
}

// One banner in the slot under the header. The panel stacks several (stop reason, paused, move or
// delete with Undo); UndoBanner wraps this one because it owns a timer.
const StatusBanner: React.FC<StatusBannerProps> = ({ variant, icon, children, onClose }) => (
  <div className={`gp-banner gp-banner--${variant}`} role={variant === "error" ? "alert" : "status"}>
    <Icon name={icon} size={15} className="gp-banner-icon" />
    <span className="gp-banner-text">{children}</span>
    {onClose && (
      <button type="button" className="gp-icon-btn gp-banner-close" aria-label="Dismiss" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    )}
  </div>
);

export default StatusBanner;
