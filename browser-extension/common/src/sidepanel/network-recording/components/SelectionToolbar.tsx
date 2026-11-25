import React from "react";
import { PanelGroup } from "../../../networkRecordingProtocol";
import { Icon } from "./icons";
import { MoveToMenu } from "./MoveToMenu";

interface SelectionToolbarProps {
  groups: PanelGroup[];
  sourceIds: ReadonlySet<string>;
  selectedCount: number;
  hiddenCount: number;
  onClear: () => void;
  onMove: (groupId: string) => void;
  onDelete: () => void;
}

// Takes the filter chips' row while anything is selected. `selectedCount` counts every selected row,
// hidden ones included, because Move and Delete act on all of them.
const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  groups,
  sourceIds,
  selectedCount,
  hiddenCount,
  onClear,
  onMove,
  onDelete,
}) => (
  <div className="gp-selection" role="toolbar" aria-label="Selected requests">
    <span
      className="gp-selection-count"
      aria-live="polite"
      title={hiddenCount > 0 ? `${hiddenCount} of them hidden by the search or filter` : undefined}
    >
      <strong>{selectedCount}</strong> selected
      {hiddenCount > 0 && <span className="gp-selection-hidden"> · {hiddenCount} hidden</span>}
    </span>
    <span className="gp-selection-spacer" />
    <button type="button" className="gp-ghost-btn" onClick={onClear}>
      Clear
    </button>
    <MoveToMenu groups={groups} sourceIds={sourceIds} count={selectedCount} onPick={onMove} />
    <button type="button" className="gp-ghost-btn gp-ghost-btn--danger" onClick={onDelete}>
      <Icon name="trash" size={13} />
      Delete
    </button>
  </div>
);

export default SelectionToolbar;
