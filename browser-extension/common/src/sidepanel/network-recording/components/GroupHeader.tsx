import React from "react";
import { GroupNameRejection, PanelGroup } from "../../../networkRecordingProtocol";
import GroupNameEditor from "./GroupNameEditor";

interface GroupHeaderProps {
  group: PanelGroup;
  count: number;
  collapsed: boolean;
  active: boolean;
  paused: boolean;
  editing: boolean;
  readOnly: boolean;
  otherNames: string[];
  // Header checkbox: rows matching the current search and filters.
  checkbox?: { checked: boolean; indeterminate: boolean; disabled: boolean; label: string; onChange: () => void };
  onToggleCollapsed: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveName: (name: string) => Promise<GroupNameRejection | null>;
}

const MAX_NAME_DISPLAY = 60;

const GroupHeader: React.FC<GroupHeaderProps> = ({
  group,
  count,
  collapsed,
  active,
  paused,
  editing,
  readOnly,
  otherNames,
  checkbox,
  onToggleCollapsed,
  onStartEdit,
  onCancelEdit,
  onSaveName,
}) => {
  const name =
    Array.from(group.name).length > MAX_NAME_DISPLAY
      ? `${Array.from(group.name).slice(0, MAX_NAME_DISPLAY).join("")}…`
      : group.name;

  return (
    <div className={`group-header ${active ? "group-header--active" : ""}`}>
      {checkbox && (
        <input
          type="checkbox"
          className="group-checkbox"
          checked={checkbox.checked}
          disabled={checkbox.disabled}
          aria-label={checkbox.label}
          ref={(el) => {
            if (el) el.indeterminate = checkbox.indeterminate;
          }}
          onChange={checkbox.onChange}
        />
      )}
      <button
        type="button"
        className="group-chevron"
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        {collapsed ? "▸" : "▾"}
      </button>
      <span className="group-folder" aria-hidden="true">
        📁
      </span>
      {editing ? (
        <GroupNameEditor initialName={group.name} otherNames={otherNames} onSave={onSaveName} onCancel={onCancelEdit} />
      ) : (
        <>
          <span className="group-name" title={group.name}>
            {name}
          </span>
          <span className="group-count">{count}</span>
          {active && (
            <span className={`group-badge ${paused ? "group-badge--paused" : ""}`}>
              {paused ? "Paused" : "Recording"}
            </span>
          )}
          {!readOnly && (
            <button type="button" className="group-pencil" aria-label={`Rename ${group.name}`} onClick={onStartEdit}>
              ✎
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default GroupHeader;
