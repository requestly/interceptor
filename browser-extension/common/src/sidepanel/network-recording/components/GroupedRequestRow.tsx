import React, { useState } from "react";
import { NetworkEntry } from "../types";
import { rowLabel } from "../groupedPanelModel";

const METHOD_CLASS: Record<string, string> = {
  GET: "gp-method--get",
  POST: "gp-method--post",
  PUT: "gp-method--put",
  PATCH: "gp-method--put",
  DELETE: "gp-method--delete",
};

const statusClass = (status: number, failed: boolean): string => {
  if (failed || status === 0 || status >= 500) return "gp-status--error";
  if (status >= 400) return "gp-status--warn";
  if (status >= 300) return "gp-status--redirect";
  return "gp-status--ok";
};

interface GroupedRequestRowProps {
  entry: NetworkEntry;
  selection?: { checked: boolean; onChange: () => void; label: string };
  renderMenu?: (onOpenChange: (open: boolean) => void) => React.ReactNode;
  flash?: boolean;
}

// One lean line: method, path, status. The checkbox and ⋮ appear on hover or focus.
const GroupedRequestRow: React.FC<GroupedRequestRowProps> = ({ entry, selection, renderMenu, flash }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { method, url } = entry.request;
  const { status } = entry.response;
  const error = (entry as { _error?: string })._error;
  const label = rowLabel(url, entry._resourceType);

  return (
    <div
      className={[
        "gp-row",
        selection?.checked ? "gp-row--selected" : "",
        flash ? "gp-row--flash" : "",
        menuOpen ? "gp-row--menu-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="gp-check-slot">
        {selection && (
          <input
            type="checkbox"
            className="gp-checkbox"
            checked={selection.checked}
            onChange={selection.onChange}
            aria-label={selection.label}
          />
        )}
      </span>
      <span className={`gp-method ${METHOD_CLASS[method] ?? ""}`}>{method}</span>
      <span className="gp-row-path" title={url}>
        {label}
      </span>
      <span className={`gp-status ${statusClass(status, !!error)}`} title={error || undefined}>
        {error ? "ERR" : status}
      </span>
      <span className="gp-action-slot">{renderMenu?.(setMenuOpen)}</span>
    </div>
  );
};

export default GroupedRequestRow;
