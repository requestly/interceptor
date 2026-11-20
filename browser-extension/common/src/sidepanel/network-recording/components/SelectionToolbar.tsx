import React from "react";
import { PanelGroup } from "../../../networkRecordingProtocol";
import { MoveToMenu } from "./MoveToMenu";

interface SelectionToolbarProps {
  groups: PanelGroup[];
  selectedCount: number;
  hiddenCount: number;
  onClear: () => void;
  onMove: (groupId: string) => void;
  onDelete: () => void;
}

// Replaces the New group row while anything is selected. `selectedCount` counts every selected row,
// hidden ones included, because Move and Delete act on all of them.
const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  groups,
  selectedCount,
  hiddenCount,
  onClear,
  onMove,
  onDelete,
}) => (
  <div className="selection-toolbar">
    <div className="selection-summary" aria-live="polite">
      <span className="selection-count">{selectedCount} selected</span>
      {hiddenCount > 0 && <span className="selection-hidden">{hiddenCount} hidden by filter</span>}
    </div>
    <div className="selection-actions">
      <button type="button" className="toolbar-btn" onClick={onClear}>
        Clear
      </button>
      <MoveToMenu groups={groups} count={selectedCount} onPick={onMove} />
      <button type="button" className="toolbar-btn toolbar-btn--danger" onClick={onDelete}>
        Delete
      </button>
    </div>
  </div>
);

export default SelectionToolbar;
