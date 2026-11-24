import React from "react";
import { PanelGroup } from "../../../networkRecordingProtocol";
import { Icon } from "./icons";
import { MoveToMenu } from "./MoveToMenu";

interface SelectionToolbarProps {
  groups: PanelGroup[];
  selectedCount: number;
  hiddenCount: number;
  onClear: () => void;
  onMove: (groupId: string) => void;
  onDelete: () => void;
}

// Takes the banner slot while anything is selected. `selectedCount` counts every selected row, hidden
// ones included, because Move and Delete act on all of them.
const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  groups,
  selectedCount,
  hiddenCount,
  onClear,
  onMove,
  onDelete,
}) => (
  <div className="gp-selection" role="toolbar" aria-label="Selected requests">
    <span className="gp-selection-count" aria-live="polite">
      {selectedCount} selected
      {hiddenCount > 0 && <span className="gp-selection-hidden"> · {hiddenCount} hidden by filter</span>}
    </span>
    <button type="button" className="gp-link-btn" onClick={onClear}>
      Clear
    </button>
    <span className="gp-selection-spacer" />
    <MoveToMenu groups={groups} count={selectedCount} onPick={onMove} />
    <button type="button" className="gp-toolbar-btn gp-toolbar-btn--danger" onClick={onDelete}>
      <Icon name="trash" size={14} />
      Delete
    </button>
  </div>
);

export default SelectionToolbar;
