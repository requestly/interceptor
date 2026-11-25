import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PanelGroup } from "../../../networkRecordingProtocol";
import { SOURCE_GROUP_TOOLTIP } from "../groupedPanelModel";
import { Icon } from "./icons";

interface MenuProps {
  buttonClass: string;
  menuClass: string;
  buttonLabel: React.ReactNode;
  ariaLabel: string;
  disabled?: boolean;
  align?: "left" | "right";
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => React.ReactNode;
}

const MENU_GAP = 4;
// Leaving "Move to group" closes its submenu only after this delay, so the pointer can cross the gap to it.
const SUBMENU_CLOSE_DELAY_MS = 150;

// Fixed positioning so the popover is never clipped by the scrolling request list. Closes on Escape,
// on an outside click, on scroll and after a pick.
const Menu: React.FC<MenuProps> = ({
  buttonClass,
  menuClass,
  buttonLabel,
  ariaLabel,
  disabled,
  align = "right",
  onOpenChange,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: "hidden" });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !popoverRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const popover = popoverRef.current.getBoundingClientRect();
    const below = anchor.bottom + MENU_GAP;
    const top = below + popover.height > window.innerHeight - 8 ? anchor.top - MENU_GAP - popover.height : below;
    const left =
      align === "right"
        ? Math.max(8, anchor.right - popover.width)
        : Math.min(anchor.left, window.innerWidth - popover.width - 8);
    setPosition({ top: Math.max(8, top), left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div className={`gp-menu-root ${open ? "gp-menu-root--open" : ""}`} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClass}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setPosition({ visibility: "hidden" });
          setOpen(!open);
        }}
      >
        {buttonLabel}
      </button>
      {open && (
        <div ref={popoverRef} className={`gp-menu ${menuClass}`} role="menu" style={position}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

const GroupOptions: React.FC<{
  groups: PanelGroup[];
  sourceIds: ReadonlySet<string>;
  onPick: (groupId: string) => void;
}> = ({ groups, sourceIds, onPick }) => (
  <>
    {groups.map((g) => {
      const isSource = sourceIds.has(g.id);
      const tipId = `gp-source-tip-${g.id}`;
      return (
        <div key={g.id} className="gp-menu-option">
          <button
            type="button"
            role="menuitem"
            className="gp-menu-item"
            title={isSource ? undefined : g.name}
            aria-disabled={isSource || undefined}
            aria-describedby={isSource ? tipId : undefined}
            onClick={() => !isSource && onPick(g.id)}
          >
            <Icon name="folder" size={13} className="gp-menu-item-icon gp-folder-icon" />
            <span className="gp-menu-item-label">{g.name}</span>
          </button>
          {isSource && (
            <span role="tooltip" id={tipId} className="gp-tooltip gp-option-tooltip">
              {SOURCE_GROUP_TOOLTIP}
            </span>
          )}
        </div>
      );
    })}
  </>
);

interface MoveToMenuProps {
  groups: PanelGroup[];
  sourceIds: ReadonlySet<string>;
  count: number;
  disabled?: boolean;
  onPick: (groupId: string) => void;
}

// Selection toolbar dropdown: the button says "Move to", the list is titled "Move N to".
export const MoveToMenu: React.FC<MoveToMenuProps> = ({ groups, sourceIds, count, disabled, onPick }) => (
  <Menu
    buttonClass="gp-toolbar-btn"
    menuClass="gp-menu--toolbar"
    buttonLabel={
      <>
        <Icon name="folderMove" size={14} />
        Move to
        <Icon name="chevronDown" size={13} />
      </>
    }
    ariaLabel={`Move ${count} selected to a group`}
    disabled={disabled}
  >
    {(close) => (
      <>
        <div className="gp-menu-heading">Move {count} to</div>
        <GroupOptions
          groups={groups}
          sourceIds={sourceIds}
          onPick={(groupId) => {
            close();
            onPick(groupId);
          }}
        />
      </>
    )}
  </Menu>
);

interface RowMenuProps {
  groups: PanelGroup[];
  ownGroupId: string;
  requestLabel: string;
  onOpenChange?: (open: boolean) => void;
  onMove: (groupId: string) => void;
  onDelete: () => void;
}

// Per-row ⋮ menu: "Move to group ›" (the row's own group listed but disabled) and "Delete".
export const RowMenu: React.FC<RowMenuProps> = ({
  groups,
  ownGroupId,
  requestLabel,
  onOpenChange,
  onMove,
  onDelete,
}) => {
  const sourceIds = new Set([ownGroupId]);
  return (
    <Menu
      buttonClass="gp-row-menu-btn"
      menuClass="gp-menu--row"
      buttonLabel={<Icon name="moreVert" size={16} />}
      ariaLabel={`Actions for ${requestLabel}`}
      onOpenChange={onOpenChange}
    >
      {(close) => (
        <RowMenuItems
          groups={groups}
          sourceIds={sourceIds}
          onMove={(groupId) => {
            close();
            onMove(groupId);
          }}
          onDelete={() => {
            close();
            onDelete();
          }}
        />
      )}
    </Menu>
  );
};

const RowMenuItems: React.FC<{
  groups: PanelGroup[];
  sourceIds: ReadonlySet<string>;
  onMove: (groupId: string) => void;
  onDelete: () => void;
}> = ({ groups, sourceIds, onMove, onDelete }) => {
  const [subOpen, setSubOpen] = useState(false);
  const subRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const canMove = groups.some((g) => !sourceIds.has(g.id));

  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  // The submenu opens to the left; in a narrow panel it is pulled back inside the viewport, over the menu.
  useLayoutEffect(() => {
    const sub = subRef.current;
    if (!sub) return;
    const overflow = 8 - sub.getBoundingClientRect().left;
    if (overflow > 0) sub.style.transform = `translateX(${overflow}px)`;
  }, [subOpen]);

  return (
    <>
      <div
        className="gp-menu-sub-anchor"
        onMouseEnter={() => {
          clearTimeout(closeTimerRef.current);
          if (canMove) setSubOpen(true);
        }}
        onMouseLeave={() => {
          closeTimerRef.current = setTimeout(() => setSubOpen(false), SUBMENU_CLOSE_DELAY_MS);
        }}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={subOpen}
          className={`gp-menu-item ${subOpen ? "gp-menu-item--active" : ""}`}
          disabled={!canMove}
          onClick={() => setSubOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") setSubOpen(true);
          }}
        >
          <Icon name="folderMove" size={13} className="gp-menu-item-icon" />
          <span className="gp-menu-item-label">Move to group</span>
          <Icon name="chevronRight" size={14} className="gp-menu-item-chevron" />
        </button>
        {subOpen && (
          <div ref={subRef} className="gp-menu gp-menu--sub" role="menu">
            <div className="gp-menu-heading">Move to</div>
            <GroupOptions groups={groups} sourceIds={sourceIds} onPick={onMove} />
          </div>
        )}
      </div>
      <button type="button" role="menuitem" className="gp-menu-item gp-menu-item--danger" onClick={onDelete}>
        <Icon name="trash" size={13} className="gp-menu-item-icon" />
        <span className="gp-menu-item-label">Delete</span>
      </button>
    </>
  );
};
