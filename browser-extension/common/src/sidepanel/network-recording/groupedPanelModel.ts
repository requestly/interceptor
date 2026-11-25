// Copy and derived values for the grouped side panel. No React and no chrome.*, so it is unit-tested
// with the recorder tests.

export type RequestFilterChip = "ALL" | "GET" | "POST" | "XHR";

export const FILTER_CHIPS: { id: RequestFilterChip; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "GET", label: "GET" },
  { id: "POST", label: "POST" },
  { id: "XHR", label: "XHR" },
];

export interface RequestFilter {
  text: string;
  chip: RequestFilterChip;
}

export interface FilterableEntry {
  request: { method: string; url: string };
  _resourceType?: unknown;
}

export const matchesFilter = (entry: FilterableEntry, filter: RequestFilter): boolean => {
  if (filter.chip === "XHR" && entry._resourceType !== "xhr") return false;
  if ((filter.chip === "GET" || filter.chip === "POST") && entry.request.method !== filter.chip) return false;
  if (filter.text && !entry.request.url.toLowerCase().includes(filter.text.toLowerCase())) return false;
  return true;
};

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

export const splitUrl = (url: string): { host: string; path: string } => {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: parsed.pathname + parsed.search || "/" };
  } catch {
    return { host: "", path: url };
  }
};

/** The document request shows its host, as in the mock ("www.bstackdemo.com/"); the rest show the path. */
export const rowLabel = (url: string, resourceType: unknown): string => {
  const { host, path } = splitUrl(url);
  return resourceType === "document" && host ? `${host}${path}` : path;
};

export const footerSummary = (urls: string[]): string => {
  const hosts = new Set(urls.map((url) => splitUrl(url).host).filter(Boolean));
  return `${plural(urls.length, "request")} · ${plural(hosts.size, "host")}`;
};

export const movedMessage = (count: number): string => `Moved ${plural(count, "request")} to`;

export const deletedMessage = (count: number): string => `Deleted ${plural(count, "request")}.`;

export const PAUSED_BANNER = "Recording paused. Requests you make now aren’t captured.";

export const NEW_GROUP_TOOLTIP =
  "Organise specific steps in your session into groups. Once created, any further requests will be captured under it.";

export const SOURCE_GROUP_TOOLTIP = "Can’t move to a source group";

export const emptyGroupText = ({
  hasRequests,
  active,
  paused,
}: {
  hasRequests: boolean;
  active: boolean;
  paused: boolean;
}): string => {
  if (hasRequests) return "No requests match the current filter.";
  if (!active) return "No requests yet.";
  return paused
    ? "No requests yet. Resume, then use the site."
    : "No requests yet. Use the site to capture under this group.";
};

export type CheckState = "checked" | "partial" | "unchecked";

/** A group checkbox reflects the group's rows that match the current filters. */
export const groupCheckState = (visibleIds: string[], selected: ReadonlySet<string>): CheckState => {
  const picked = visibleIds.filter((id) => selected.has(id)).length;
  if (picked === 0) return "unchecked";
  return picked === visibleIds.length ? "checked" : "partial";
};

/** Ticking a group header selects its visible rows, or clears them when all are already selected. */
export const toggleGroupSelection = (visibleIds: string[], selected: ReadonlySet<string>): Set<string> => {
  const next = new Set(selected);
  if (visibleIds.length > 0 && visibleIds.every((id) => next.has(id))) visibleIds.forEach((id) => next.delete(id));
  else visibleIds.forEach((id) => next.add(id));
  return next;
};

/** Selected ids that still exist after a groups snapshot; new rows are never added. */
export const pruneSelection = (selected: ReadonlySet<string>, placed: ReadonlySet<string>): Set<string> =>
  new Set(Array.from(selected).filter((id) => placed.has(id)));

/** Groups holding any of the selected requests; a move into them is disabled. */
export const sourceGroupIds = (
  groups: { id: string; requestIds: string[] }[],
  selected: Iterable<string>
): Set<string> => {
  const ids = new Set(selected);
  return new Set(groups.filter((g) => g.requestIds.some((id) => ids.has(id))).map((g) => g.id));
};

/** After a new group is created the other groups fold away, so the list leads with the step being named. */
export const collapseAllBut = (groupIds: string[], keepId: string): Set<string> =>
  new Set(groupIds.filter((id) => id !== keepId));
