import React, { useCallback, useEffect, useRef } from "react";
import { Icon } from "./icons";

export const UNDO_WINDOW_MS = 10_000;

interface UndoBannerProps {
  children: React.ReactNode;
  onUndo: () => void;
  onClose: () => void;
  hidden?: boolean;
  durationMs?: number;
}

// Lasts 10 s, and the clock stops while the banner is hovered or holds focus. The panel gives each
// operation its own `key`, so the next move or delete replaces this banner and restarts the clock.
const UndoBanner: React.FC<UndoBannerProps> = ({ children, onUndo, onClose, hidden, durationMs = UNDO_WINDOW_MS }) => {
  const remainingRef = useRef(durationMs);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const holdsRef = useRef(0);

  const start = useCallback(() => {
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(onClose, remainingRef.current);
  }, [onClose]);

  const stop = useCallback(() => {
    if (timerRef.current === undefined) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
  }, []);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  const hold = () => {
    holdsRef.current += 1;
    stop();
  };
  const release = () => {
    holdsRef.current = Math.max(0, holdsRef.current - 1);
    if (holdsRef.current === 0 && timerRef.current === undefined) start();
  };

  return (
    <div
      className="gp-banner gp-banner--info"
      role="status"
      hidden={hidden}
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={release}
    >
      <Icon name="check" size={14} className="gp-banner-icon" />
      <span className="gp-banner-text">{children}</span>
      <button type="button" className="gp-link-btn gp-banner-action" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="gp-icon-btn gp-banner-close" aria-label="Dismiss" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
};

export default UndoBanner;
