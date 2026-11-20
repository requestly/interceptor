import React, { useEffect, useRef, useState } from "react";
import { PanelGroup } from "../../../networkRecordingProtocol";

interface MenuProps {
  buttonClass: string;
  buttonLabel: React.ReactNode;
  ariaLabel: string;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}

// A button with a popover list. Closes on Escape, on an outside click and after a pick.
const Menu: React.FC<MenuProps> = ({ buttonClass, buttonLabel, ariaLabel, disabled, children }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        type="button"
        className={buttonClass}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {buttonLabel}
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

interface MoveToMenuProps {
  groups: PanelGroup[];
  excludeGroupId?: string;
  count: number;
  disabled?: boolean;
  onPick: (groupId: string) => void;
}

// Toolbar dropdown: "Move N to".
export const MoveToMenu: React.FC<MoveToMenuProps> = ({ groups, excludeGroupId, count, disabled, onPick }) => (
  <Menu
    buttonClass="toolbar-btn"
    buttonLabel={`Move ${count} to ▾`}
    ariaLabel={`Move ${count} selected to a group`}
    disabled={disabled}
  >
    {(close) =>
      groups
        .filter((g) => g.id !== excludeGroupId)
        .map((g) => (
          <button
            key={g.id}
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close();
              onPick(g.id);
            }}
          >
            {g.name}
          </button>
        ))
    }
  </Menu>
);

interface RowMenuProps {
  groups: PanelGroup[];
  ownGroupId: string;
  requestLabel: string;
  disabled?: boolean;
  onMove: (groupId: string) => void;
  onDelete: () => void;
}

// Per-row menu: "Move to group" (every group except the row's own) and "Delete".
export const RowMenu: React.FC<RowMenuProps> = ({ groups, ownGroupId, requestLabel, disabled, onMove, onDelete }) => (
  <Menu buttonClass="row-menu-btn" buttonLabel="⋯" ariaLabel={`Actions for ${requestLabel}`} disabled={disabled}>
    {(close) => (
      <>
        <div className="menu-heading">Move to group</div>
        {groups
          .filter((g) => g.id !== ownGroupId)
          .map((g) => (
            <button
              key={g.id}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close();
                onMove(g.id);
              }}
            >
              {g.name}
            </button>
          ))}
        <div className="menu-divider" />
        <button
          type="button"
          role="menuitem"
          className="menu-item menu-item--danger"
          onClick={() => {
            close();
            onDelete();
          }}
        >
          Delete
        </button>
      </>
    )}
  </Menu>
);
