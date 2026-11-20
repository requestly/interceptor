import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CLIENT_MESSAGES, EXTENSION_MESSAGES } from "../../constants";
import {
  GroupNameRejection,
  GroupsManifest,
  NewGroupResult,
  OperationResult,
  PanelGroupsView,
  RenameGroupResult,
} from "../../networkRecordingProtocol";
import { NetworkEntry } from "./types";
import NetworkEventRow from "./components/NetworkEventRow";
import FilterBar from "./components/FilterBar";
import GroupHeader from "./components/GroupHeader";
import { GROUP_NAME_MESSAGES } from "./components/GroupNameEditor";
import { RowMenu } from "./components/MoveToMenu";
import SelectionToolbar from "./components/SelectionToolbar";
import StatusBanner from "./components/StatusBanner";
import UndoBanner from "./components/UndoBanner";
import { formatSize, formatTime, RESOURCE_TYPE_DISPLAY, STOP_BANNERS, StopReason } from "./NetworkRecordingPanel";

export interface GroupedPanelInitialState {
  tabId: number;
  active: boolean;
  entries: NetworkEntry[];
  startTime: number;
  url: string;
  view?: PanelGroupsView;
  endTime?: number;
  manifest?: GroupsManifest;
}

interface UndoState {
  opId: string;
  message: string;
}

const requestIdOf = (entry: NetworkEntry): string => entry._request_id as string;

const splitUrl = (url: string): { host: string; path: string } => {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: parsed.pathname + parsed.search || "/" };
  } catch {
    return { host: "", path: url };
  }
};

// A grouped panel reopened after Stop has no entries, only the retained manifest.
const viewFromManifest = (manifest: GroupsManifest): PanelGroupsView => ({
  revision: manifest.revision,
  groups: manifest.groups,
  activeGroupId: "",
  paused: false,
  pausedMsClosed: manifest.stats.pausedMs,
  pausedAt: null,
  deletedCount: manifest.deletedRequestIds.length,
});

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const sendCommand = <T,>(action: string, tabId: number, extra: Record<string, unknown> = {}): Promise<T | undefined> =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, targetTabId: tabId, ...extra }, (response) => {
      void chrome.runtime.lastError;
      resolve(response as T | undefined);
    });
  });

const GroupedNetworkRecordingPanel: React.FC<{ initial: GroupedPanelInitialState }> = ({ initial }) => {
  const { tabId } = initial;
  const manifestOnly = !initial.active && !!initial.manifest;

  // Entries can number in the thousands, so they live in a ref and a counter triggers redraws.
  const entriesRef = useRef<Map<string, NetworkEntry>>(new Map(initial.entries.map((e) => [requestIdOf(e), e])));
  const placedRef = useRef<Set<string>>(new Set());
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const [view, setView] = useState<PanelGroupsView | null>(
    initial.view ?? (initial.manifest ? viewFromManifest(initial.manifest) : null)
  );
  const [isRecording, setIsRecording] = useState(initial.active);
  const [stopReason, setStopReason] = useState<StopReason | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [filter, setFilter] = useState({ text: "", method: "ALL" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const targetHost = useMemo(() => {
    try {
      return new URL(initial.url).hostname;
    } catch {
      return initial.url || "";
    }
  }, [initial.url]);

  // --- Live updates from the service worker ---------------------------------------------------

  useEffect(() => {
    placedRef.current = new Set(initial.view?.groups.flatMap((g) => g.requestIds) ?? []);

    const listener = (message: any) => {
      if (message.tabId !== tabId) return;

      if (message.action === CLIENT_MESSAGES.NETWORK_EVENT_CAPTURED) {
        const id = requestIdOf(message.entry);
        entriesRef.current.set(id, message.entry);
        if (!placedRef.current.has(id)) {
          placedRef.current.add(id);
          setView((prev) =>
            prev
              ? {
                  ...prev,
                  groups: prev.groups.map((g) =>
                    g.id === (message.groupId ?? prev.groups[0].id) ? { ...g, requestIds: [...g.requestIds, id] } : g
                  ),
                }
              : prev
          );
        }
        redraw();
      } else if (message.action === CLIENT_MESSAGES.NETWORK_RECORDING_GROUPS_CHANGED) {
        const next = message.view as PanelGroupsView;
        placedRef.current = new Set(next.groups.flatMap((g) => g.requestIds));
        setView(next);
        // Deleted rows leave the selection; undone rows are simply not selected.
        setSelected((prev) => new Set(Array.from(prev).filter((id) => placedRef.current.has(id))));
      } else if (message.action === CLIENT_MESSAGES.NETWORK_RECORDING_ENDED) {
        setIsRecording(false);
        setStopReason(message.reason ?? "user");
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [tabId, initial.view]);

  // Frozen while paused: pausedAt stays fixed, so the value does not move until Resume.
  useEffect(() => {
    if (manifestOnly) {
      setElapsed(Math.max(0, (initial.endTime ?? initial.startTime) - initial.startTime - (view?.pausedMsClosed ?? 0)));
      return undefined;
    }
    if (!isRecording) return undefined;
    const tick = () =>
      setElapsed(
        Math.max(
          0,
          (viewRef.current?.pausedAt ?? Date.now()) - initial.startTime - (viewRef.current?.pausedMsClosed ?? 0)
        )
      );
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isRecording, manifestOnly, initial.startTime, initial.endTime, view?.pausedAt, view?.pausedMsClosed]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!flashId) return undefined;
    const timer = setTimeout(() => setFlashId(null), 1200);
    return () => clearTimeout(timer);
  }, [flashId]);

  // After Stop nothing can change, so a pending selection, editor or undo is dropped.
  useEffect(() => {
    if (isRecording) return;
    setSelected(new Set());
    setEditingId(null);
    setUndo(null);
  }, [isRecording]);

  // --- Derived data ---------------------------------------------------------------------------

  const paused = !!view?.paused;
  const groups = view?.groups ?? [];

  const matches = useCallback(
    (entry: NetworkEntry): boolean => {
      if (filter.method !== "ALL" && entry.request.method !== filter.method) return false;
      if (filter.text && !entry.request.url.toLowerCase().includes(filter.text.toLowerCase())) return false;
      return true;
    },
    [filter]
  );

  const liveIdsByGroup = useMemo(() => {
    const map = new Map<string, string[]>();
    groups.forEach((g) =>
      map.set(
        g.id,
        g.requestIds.filter((id) => entriesRef.current.has(id))
      )
    );
    return map;
    // entriesRef is mutated in place; `view` changes whenever a row is placed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const visibleIdsByGroup = useMemo(() => {
    const map = new Map<string, string[]>();
    liveIdsByGroup.forEach((ids, groupId) =>
      map.set(
        groupId,
        ids.filter((id) => matches(entriesRef.current.get(id)))
      )
    );
    return map;
  }, [liveIdsByGroup, matches]);

  const liveEntries = useMemo(
    () => Array.from(liveIdsByGroup.values()).flatMap((ids) => ids.map((id) => entriesRef.current.get(id))),
    [liveIdsByGroup]
  );

  const counts = useMemo(() => {
    const shown = liveEntries.filter(matches);
    return {
      total: shown.length,
      xhr: shown.filter((e) => e._resourceType === "xhr").length,
      docs: shown.filter((e) => e._resourceType === "document").length,
      static: shown.filter((e) => ["script", "stylesheet", "image", "font"].includes(e._resourceType as string)).length,
    };
  }, [liveEntries, matches]);

  const footer = useMemo(() => {
    const hosts = new Set(liveEntries.map((e) => splitUrl(e.request.url).host).filter(Boolean));
    return `${plural(liveEntries.length, "request")}, ${plural(hosts.size, "host")}`;
  }, [liveEntries]);

  const hiddenSelectedCount = useMemo(
    () =>
      Array.from(selected).filter((id) => {
        const entry = entriesRef.current.get(id);
        return !!entry && !matches(entry);
      }).length,
    [selected, matches]
  );

  const groupName = (groupId: string) => groups.find((g) => g.id === groupId)?.name ?? "";

  // --- Commands -------------------------------------------------------------------------------

  const handlePause = () => sendCommand(EXTENSION_MESSAGES.PAUSE_NETWORK_RECORDING, tabId);
  const handleResume = () => sendCommand(EXTENSION_MESSAGES.RESUME_NETWORK_RECORDING, tabId);

  const handleStop = () => {
    chrome.runtime.sendMessage({ action: EXTENSION_MESSAGES.STOP_NETWORK_RECORDING, targetTabId: tabId });
    setIsRecording(false);
    setStopReason("user");
  };

  const handleNewGroup = async () => {
    const result = await sendCommand<NewGroupResult>(EXTENSION_MESSAGES.NEW_NETWORK_RECORDING_GROUP, tabId);
    if (!result?.ok) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(result.groupId);
      return next;
    });
    if (result.reused) {
      setNotice(`"${groupName(result.groupId)}" is empty, so new requests will go there.`);
    } else {
      setEditingId(result.groupId);
    }
  };

  const handleRename = async (groupId: string, name: string): Promise<GroupNameRejection | null> => {
    const result = await sendCommand<RenameGroupResult>(EXTENSION_MESSAGES.RENAME_NETWORK_RECORDING_GROUP, tabId, {
      groupId,
      name,
    });
    if (result?.ok) {
      setEditingId(null);
      return null;
    }
    if (result && result.ok === false && result.reason in GROUP_NAME_MESSAGES) {
      return result.reason as GroupNameRejection;
    }
    setEditingId(null);
    return null;
  };

  const handleMove = async (ids: string[], targetGroupId: string) => {
    const result = await sendCommand<OperationResult>(EXTENSION_MESSAGES.MOVE_NETWORK_RECORDING_REQUESTS, tabId, {
      requestIds: ids,
      targetGroupId,
    });
    if (!result?.ok) return;
    setSelected(new Set());
    setUndo({ opId: result.opId, message: `Moved ${plural(result.count, "request")} to ${groupName(targetGroupId)}` });
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(targetGroupId);
      return next;
    });
    setFlashId(ids[0]);
  };

  const handleDelete = async (ids: string[]) => {
    const result = await sendCommand<OperationResult>(EXTENSION_MESSAGES.DELETE_NETWORK_RECORDING_REQUESTS, tabId, {
      requestIds: ids,
    });
    if (!result?.ok) return;
    setSelected(new Set());
    setUndo({ opId: result.opId, message: `Deleted ${plural(result.count, "request")}` });
  };

  const handleUndo = async () => {
    if (!undo) return;
    const { opId } = undo;
    setUndo(null);
    await sendCommand(EXTENSION_MESSAGES.UNDO_NETWORK_RECORDING_OPERATION, tabId, { opId });
  };

  // --- Selection ------------------------------------------------------------------------------

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The header checkbox acts on the rows matching the current search and filters.
  const toggleGroup = (groupId: string) =>
    setSelected((prev) => {
      const visible = visibleIdsByGroup.get(groupId) ?? [];
      const next = new Set(prev);
      if (visible.length > 0 && visible.every((id) => next.has(id))) visible.forEach((id) => next.delete(id));
      else visible.forEach((id) => next.add(id));
      return next;
    });

  const toggleCollapsed = (groupId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  // --- Render ---------------------------------------------------------------------------------

  const stopBanner = !isRecording && stopReason ? STOP_BANNERS[stopReason] : undefined;
  const statusLabel = !isRecording ? "Stopped" : paused ? "Paused" : "Recording";
  const selectedIds = Array.from(selected);

  return (
    <div className="network-panel network-panel--grouped">
      <div className="panel-header">
        <div className="header-top">
          <div className="recording-status">
            {isRecording && <span className={`recording-dot ${paused ? "recording-dot--paused" : ""}`} />}
            <span className={`recording-label ${paused ? "recording-label--paused" : ""}`}>{statusLabel}</span>
            <span className="recording-time">{formatTime(elapsed)}</span>
          </div>
          {isRecording && (
            <div className="header-actions">
              {paused ? (
                <button type="button" className="pause-btn" onClick={handleResume}>
                  Resume
                </button>
              ) : (
                <button type="button" className="pause-btn" onClick={handlePause}>
                  Pause
                </button>
              )}
              <button type="button" className="stop-btn" onClick={handleStop}>
                <span className="stop-icon" />
                Stop
              </button>
            </div>
          )}
        </div>
        {targetHost && <div className="target-url">{targetHost}</div>}
      </div>

      {stopBanner && (
        <StatusBanner
          variant={stopBanner.variant as "error" | "warning"}
          icon={stopBanner.icon}
          text={stopBanner.text}
        />
      )}
      {isRecording && paused && (
        <StatusBanner variant="warning" icon="⏸" text="Recording paused. Requests you make now aren't captured." />
      )}
      {notice && <StatusBanner variant="info" icon="ℹ" text={notice} onClose={() => setNotice(null)} />}
      {isRecording && undo && (
        <UndoBanner key={undo.opId} message={undo.message} onUndo={handleUndo} onClose={() => setUndo(null)} />
      )}
      {manifestOnly && (
        <StatusBanner variant="info" icon="ℹ" text="Recording ended. Requests are no longer listed in this panel." />
      )}

      {!manifestOnly && (
        <>
          <div className="summary-counters">
            <div className="counter">
              <span className="counter-value">{counts.total}</span>
              <span className="counter-label">Total</span>
            </div>
            <div className="counter">
              <span className="counter-value">{counts.xhr}</span>
              <span className="counter-label">XHR</span>
            </div>
            <div className="counter">
              <span className="counter-value">{counts.docs}</span>
              <span className="counter-label">Docs</span>
            </div>
            <div className="counter">
              <span className="counter-value">{counts.static}</span>
              <span className="counter-label">Static</span>
            </div>
          </div>

          <FilterBar filter={filter} onFilterChange={setFilter} />

          <div className="group-toolbar">
            {selectedIds.length > 0 ? (
              <SelectionToolbar
                groups={groups}
                selectedCount={selectedIds.length}
                hiddenCount={hiddenSelectedCount}
                onClear={() => setSelected(new Set())}
                onMove={(groupId) => handleMove(selectedIds, groupId)}
                onDelete={() => handleDelete(selectedIds)}
              />
            ) : (
              <button
                type="button"
                className="new-group-btn"
                disabled={!isRecording}
                title="Requests you make next are added to the new group"
                onClick={handleNewGroup}
              >
                + New group
              </button>
            )}
          </div>
        </>
      )}

      <div className="request-list">
        {groups.map((group) => {
          const liveIds = liveIdsByGroup.get(group.id) ?? [];
          const visibleIds = visibleIdsByGroup.get(group.id) ?? [];
          const isCollapsed = collapsed.has(group.id);
          const selectedVisible = visibleIds.filter((id) => selected.has(id)).length;
          const count = manifestOnly ? group.requestIds.length : liveIds.length;

          return (
            <div key={group.id} className="group-section">
              <GroupHeader
                group={group}
                count={count}
                collapsed={isCollapsed}
                active={isRecording && group.id === view?.activeGroupId}
                paused={paused}
                editing={editingId === group.id}
                readOnly={!isRecording}
                otherNames={groups.filter((g) => g.id !== group.id).map((g) => g.name)}
                checkbox={
                  manifestOnly
                    ? undefined
                    : {
                        checked: visibleIds.length > 0 && selectedVisible === visibleIds.length,
                        indeterminate: selectedVisible > 0 && selectedVisible < visibleIds.length,
                        disabled: !isRecording || visibleIds.length === 0,
                        label: `Select visible requests in ${group.name}`,
                        onChange: () => toggleGroup(group.id),
                      }
                }
                onToggleCollapsed={() => toggleCollapsed(group.id)}
                onStartEdit={() => setEditingId(group.id)}
                onCancelEdit={() => setEditingId(null)}
                onSaveName={(name) => handleRename(group.id, name)}
              />
              {!isCollapsed && !manifestOnly && (
                <div className="group-rows">
                  {visibleIds.map((id) => {
                    const entry = entriesRef.current.get(id);
                    const { path } = splitUrl(entry.request.url);
                    const label = `${entry.request.method} ${path}`;
                    return (
                      <NetworkEventRow
                        key={id}
                        entry={entry}
                        typeDisplay={
                          RESOURCE_TYPE_DISPLAY[entry._resourceType as string] ||
                          (entry._resourceType as string) ||
                          "other"
                        }
                        formatSize={formatSize}
                        flash={flashId === id}
                        selection={
                          isRecording
                            ? { checked: selected.has(id), onChange: () => toggleRow(id), label: `Select ${label}` }
                            : undefined
                        }
                        menu={
                          isRecording ? (
                            <RowMenu
                              groups={groups}
                              ownGroupId={group.id}
                              requestLabel={label}
                              onMove={(groupId) => handleMove([id], groupId)}
                              onDelete={() => handleDelete([id])}
                            />
                          ) : undefined
                        }
                      />
                    );
                  })}
                  {visibleIds.length === 0 && (
                    <div className="group-empty">
                      {liveIds.length > 0
                        ? "No requests match the current filter"
                        : paused && group.id === view?.activeGroupId
                          ? "No requests yet. Resume, then use the site."
                          : "No requests yet."}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel-footer panel-footer--grouped">
        {!manifestOnly && <span className="footer-summary">{footer}</span>}
        <span className="version">v{chrome.runtime.getManifest().version}</span>
      </div>
    </div>
  );
};

export default GroupedNetworkRecordingPanel;
