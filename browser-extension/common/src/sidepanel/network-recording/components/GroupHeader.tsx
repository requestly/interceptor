import React from "react";
import { GroupNameRejection, PanelGroup } from "../../../networkRecordingProtocol";
import { CheckState } from "../groupedPanelModel";
import GroupNameEditor from "./GroupNameEditor";
import { Icon } from "./icons";

interface GroupHeaderProps {
  group: PanelGroup;
  count: number;
  collapsed: boolean;
  active: boolean;
  paused: boolean;
  editing: boolean;
  editorKey: number;
  readOnly: boolean;
  otherNames: string[];
  checkbox?: { state: CheckState; disabled: boolean; label: string; onChange: () => void };
  onToggleCollapsed: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveName: (name: string) => Promise<GroupNameRejection | null>;
}

const GroupHeader: React.FC<GroupHeaderProps> = ({
  group,
  count,
  collapsed,
  active,
  paused,
  editing,
  editorKey,
  readOnly,
  otherNames,
  checkbox,
  onToggleCollapsed,
  onStartEdit,
  onCancelEdit,
  onSaveName,
}) => (
  <div
    className={[
      "gp-group-header",
      active ? "gp-group-header--active" : "",
      active && paused ? "gp-group-header--paused" : "",
      editing ? "gp-group-header--editing" : "",
      checkbox && checkbox.state !== "unchecked" ? "gp-group-header--selected" : "",
    ]
      .filter(Boolean)
      .join(" ")}
  >
    <span className="gp-check-slot">
      {checkbox && (
        <input
          type="checkbox"
          className="gp-checkbox"
          checked={checkbox.state === "checked"}
          disabled={checkbox.disabled}
          aria-label={checkbox.label}
          aria-checked={checkbox.state === "partial" ? "mixed" : checkbox.state === "checked"}
          ref={(el) => {
            if (el) el.indeterminate = checkbox.state === "partial";
          }}
          onChange={checkbox.onChange}
        />
      )}
    </span>
    <button
      type="button"
      className="gp-chevron"
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
      aria-expanded={!collapsed}
      onClick={onToggleCollapsed}
    >
      <Icon name="chevronDown" size={16} className={collapsed ? "gp-chevron-icon--collapsed" : ""} />
    </button>
    <Icon name="folder" size={16} className="gp-folder-icon" />
    {editing ? (
      <GroupNameEditor
        key={editorKey}
        initialName={group.name}
        otherNames={otherNames}
        onSave={onSaveName}
        onCancel={onCancelEdit}
      />
    ) : (
      <>
        <button type="button" className="gp-group-title" title={group.name} onClick={onToggleCollapsed} tabIndex={-1}>
          <span className="gp-group-name">{group.name}</span>
          <span className="gp-group-count">{count}</span>
        </button>
        {active && (
          <span className={`gp-badge ${paused ? "gp-badge--paused" : "gp-badge--recording"}`}>
            {paused ? <Icon name="pause" size={12} /> : <span className="gp-badge-dot" />}
            {paused ? "Paused" : "Recording"}
          </span>
        )}
        <span className="gp-action-slot">
          {!readOnly && (
            <button
              type="button"
              className="gp-icon-btn gp-pencil"
              aria-label={`Rename ${group.name}`}
              onClick={onStartEdit}
            >
              <Icon name="edit" size={13} />
            </button>
          )}
        </span>
      </>
    )}
  </div>
);

export default GroupHeader;
