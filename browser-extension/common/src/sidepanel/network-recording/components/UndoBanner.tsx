import React, { useCallback, useEffect, useRef } from "react";

export const UNDO_WINDOW_MS = 10_000;

interface UndoBannerProps {
  message: string;
  onUndo: () => void;
  onClose: () => void;
  durationMs?: number;
}

// Lasts 10 s, and the clock stops while the banner is hovered or holds focus. The panel gives each
// operation its own `key`, so the next move or delete replaces this banner and restarts the clock.
const UndoBanner: React.FC<UndoBannerProps> = ({ message, onUndo, onClose, durationMs = UNDO_WINDOW_MS }) => {
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
      className="undo-banner"
      role="status"
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={release}
    >
      <span className="undo-banner-text">{message}</span>
      <button type="button" className="undo-banner-btn" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="banner-close" aria-label="Dismiss" onClick={onClose}>
        ✕
      </button>
    </div>
  );
};

export default UndoBanner;
