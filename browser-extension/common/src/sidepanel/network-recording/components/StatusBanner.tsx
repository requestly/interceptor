import React from "react";

export type BannerVariant = "error" | "warning" | "info";

interface StatusBannerProps {
  variant: BannerVariant;
  icon: string;
  text: string;
  onClose?: () => void;
}

// One banner. The panel stacks several (stop reason, paused, empty-group reuse); the undo banner is
// its own component because it owns a timer.
const StatusBanner: React.FC<StatusBannerProps> = ({ variant, icon, text, onClose }) => (
  <div className={`end-banner end-banner--${variant}`} role={variant === "error" ? "alert" : "status"}>
    <span className="end-banner-icon">{icon}</span>
    <span className="end-banner-text">{text}</span>
    {onClose && (
      <button type="button" className="banner-close" aria-label="Dismiss" onClick={onClose}>
        ✕
      </button>
    )}
  </div>
);

export default StatusBanner;
