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
import GroupHeader from "./components/GroupHeader";
import GroupedRequestRow from "./components/GroupedRequestRow";
import { GROUP_NAME_MESSAGES } from "./components/GroupNameEditor";
import { Icon } from "./components/icons";
import { RowMenu } from "./components/MoveToMenu";
import SelectionToolbar from "./components/SelectionToolbar";
import StatusBanner from "./components/StatusBanner";
import UndoBanner from "./components/UndoBanner";
import { formatTime, STOP_BANNERS, StopReason } from "./NetworkRecordingPanel";
import {
  collapseAllBut,
  deletedMessage,
  emptyGroupText,
  FILTER_CHIPS,
  footerSummary,
  groupCheckState,
  matchesFilter,
  movedMessage,
  NEW_GROUP_TOOLTIP,
  PAUSED_BANNER,
  pruneSelection,
  RequestFilter,
  reusedGroupNotice,
  rowLabel,
  toggleGroupSelection,
} from "./groupedPanelModel";
import "./grouped.css";

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

type UndoState =
  | { opId: string; kind: "move"; count: number; target: string }
  | { opId: string; kind: "delete"; count: number };

const requestIdOf = (entry: NetworkEntry): string => entry._request_id as string;

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
  const [filter, setFilter] = useState<RequestFilter>({ text: "", chip: "ALL" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [reuseNotice, setReuseNotice] = useState<string | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const viewRef = useRef(view);
  viewRef.current = view;

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
        setSelected((prev) => pruneSelection(prev, placedRef.current));
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
    if (!reuseNotice) return undefined;
    const timer = setTimeout(() => setReuseNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [reuseNotice]);

  useEffect(() => {
    if (flashIds.size === 0) return undefined;
    const timer = setTimeout(() => setFlashIds(new Set()), 1200);
    return () => clearTimeout(timer);
  }, [flashIds]);

  // After Stop nothing can change, so a pending selection, editor, undo or notice is dropped.
  useEffect(() => {
    if (isRecording) return;
    setSelected(new Set());
    setEditingId(null);
    setUndo(null);
    setReuseNotice(null);
  }, [isRecording]);

  // --- Derived data ---------------------------------------------------------------------------

  const paused = !!view?.paused;
  const groups = view?.groups ?? [];

  const matches = useCallback((entry: NetworkEntry): boolean => matchesFilter(entry, filter), [filter]);

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

  const footer = useMemo(
    () =>
      footerSummary(
        Array.from(liveIdsByGroup.values()).flatMap((ids) => ids.map((id) => entriesRef.current.get(id).request.url))
      ),
    [liveIdsByGroup]
  );

  const hiddenSelectedCount = useMemo(
    () =>
      Array.from(selected).filter((id) => {
        const entry = entriesRef.current.get(id);
        return !!entry && !matches(entry);
      }).length,
    [selected, matches]
  );

  const groupName = (groupId: string) => groups.find((g) => g.id === groupId)?.name ?? "";

  const expand = (groupId: string) =>
    setCollapsed((prev) => {
      if (!prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });

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
    if (result.reused) {
      expand(result.groupId);
      setReuseNotice(reusedGroupNotice(groupName(result.groupId)));
    } else {
      setReuseNotice(null);
      setCollapsed(
        collapseAllBut(
          groups.map((g) => g.id),
          result.groupId
        )
      );
    }
    setEditingId(result.groupId);
  };

  const handleRename = async (groupId: string, name: string): Promise<GroupNameRejection | null> => {
    const result = await sendCommand<RenameGroupResult>(EXTENSION_MESSAGES.RENAME_NETWORK_RECORDING_GROUP, tabId, {
      groupId,
      name,
    });
    if (result?.ok) {
      setEditingId(null);
      setReuseNotice(null);
      return null;
    }
    if (result && result.ok === false && result.reason in GROUP_NAME_MESSAGES) {
      return result.reason as GroupNameRejection;
    }
    setEditingId(null);
    return null;
  };

  const handleMove = async (ids: string[], targetGroupId: string) => {
    const target = groupName(targetGroupId);
    const result = await sendCommand<OperationResult>(EXTENSION_MESSAGES.MOVE_NETWORK_RECORDING_REQUESTS, tabId, {
      requestIds: ids,
      targetGroupId,
    });
    if (!result?.ok) return;
    setSelected(new Set());
    setUndo({ opId: result.opId, kind: "move", count: result.count, target });
    expand(targetGroupId);
    setFlashIds(new Set(ids));
  };

  const handleDelete = async (ids: string[]) => {
    const result = await sendCommand<OperationResult>(EXTENSION_MESSAGES.DELETE_NETWORK_RECORDING_REQUESTS, tabId, {
      requestIds: ids,
    });
    if (!result?.ok) return;
    setSelected(new Set());
    setUndo({ opId: result.opId, kind: "delete", count: result.count });
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
    setSelected((prev) => toggleGroupSelection(visibleIdsByGroup.get(groupId) ?? [], prev));

  const toggleCollapsed = (groupId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  // --- Render ---------------------------------------------------------------------------------

  const stopBanner = !isRecording && stopReason ? STOP_BANNERS[stopReason] : undefined;
  const selectedIds = Array.from(selected);
  const selecting = isRecording && selectedIds.length > 0;
  const statusClass = !isRecording
    ? "gp-status-pill--stopped"
    : paused
      ? "gp-status-pill--paused"
      : "gp-status-pill--recording";
  const statusLabel = !isRecording ? "Stopped" : paused ? "Paused" : "Recording";

  return (
    <div className={`gp-panel ${selecting ? "gp-panel--selecting" : ""}`}>
      <header className="gp-header">
        <span className="gp-title">Requestly</span>
        <span className={`gp-status-pill ${statusClass}`} aria-live="polite">
          <span className="gp-status-dot" />
          <span>{statusLabel} ·</span>
          <span className="gp-status-time">{formatTime(elapsed)}</span>
        </span>
        {isRecording && (
          <>
            {paused ? (
              <button type="button" className="gp-header-btn gp-header-btn--resume" onClick={handleResume}>
                <Icon name="play" size={15} />
                Resume
              </button>
            ) : (
              <button type="button" className="gp-header-btn" onClick={handlePause}>
                <Icon name="pause" size={15} />
                Pause
              </button>
            )}
            <button type="button" className="gp-header-btn gp-header-btn--stop" onClick={handleStop}>
              Stop
            </button>
          </>
        )}
      </header>

      <div className="gp-banner-slot">
        {stopBanner && (
          <StatusBanner
            variant={stopBanner.variant as "error" | "warning"}
            icon={stopBanner.variant === "error" ? "error" : "info"}
          >
            {stopBanner.text}
          </StatusBanner>
        )}
        {manifestOnly && (
          <StatusBanner variant="info" icon="info">
            Recording ended. Requests are no longer listed in this panel.
          </StatusBanner>
        )}
        {isRecording && paused && (
          <StatusBanner variant="warning" icon="pause">
            {PAUSED_BANNER}
          </StatusBanner>
        )}
        {isRecording && undo && (
          <UndoBanner key={undo.opId} onUndo={handleUndo} onClose={() => setUndo(null)}>
            {undo.kind === "move" ? (
              <>
                {movedMessage(undo.count)} <strong>{undo.target}</strong>.
              </>
            ) : (
              deletedMessage(undo.count)
            )}
          </UndoBanner>
        )}
      </div>

      {!manifestOnly && (
        <div className="gp-filters">
          <div className="gp-search">
            <Icon name="search" size={16} className="gp-search-icon" />
            <input
              type="text"
              className="gp-search-input"
              placeholder="Search requests"
              aria-label="Search requests"
              value={filter.text}
              onChange={(e) => setFilter({ ...filter, text: e.target.value })}
            />
            {filter.text && (
              <button
                type="button"
                className="gp-icon-btn gp-search-clear"
                aria-label="Clear search"
                onClick={() => setFilter({ ...filter, text: "" })}
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          {selecting ? (
            <SelectionToolbar
              groups={groups}
              selectedCount={selectedIds.length}
              hiddenCount={hiddenSelectedCount}
              onClear={() => setSelected(new Set())}
              onMove={(groupId) => handleMove(selectedIds, groupId)}
              onDelete={() => handleDelete(selectedIds)}
            />
          ) : (
            <div className="gp-chips" role="group" aria-label="Filter requests">
              {FILTER_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={`gp-chip ${filter.chip === chip.id ? "gp-chip--active" : ""}`}
                  aria-pressed={filter.chip === chip.id}
                  onClick={() => setFilter({ ...filter, chip: chip.id })}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="gp-list">
        {groups.map((group) => {
          const liveIds = liveIdsByGroup.get(group.id) ?? [];
          const visibleIds = visibleIdsByGroup.get(group.id) ?? [];
          const isCollapsed = collapsed.has(group.id);
          const isActive = isRecording && group.id === view?.activeGroupId;
          const count = manifestOnly ? group.requestIds.length : liveIds.length;

          return (
            <section key={group.id} className="gp-group" aria-label={group.name}>
              <GroupHeader
                group={group}
                count={count}
                collapsed={isCollapsed}
                active={isActive}
                paused={paused}
                editing={editingId === group.id}
                readOnly={!isRecording}
                otherNames={groups.filter((g) => g.id !== group.id).map((g) => g.name)}
                checkbox={
                  isRecording && visibleIds.length > 0
                    ? {
                        state: groupCheckState(visibleIds, selected),
                        disabled: false,
                        label: `Select requests in ${group.name}`,
                        onChange: () => toggleGroup(group.id),
                      }
                    : undefined
                }
                onToggleCollapsed={() => toggleCollapsed(group.id)}
                onStartEdit={() => {
                  expand(group.id);
                  setEditingId(group.id);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSaveName={(name) => handleRename(group.id, name)}
              />
              {!isCollapsed && !manifestOnly && (
                <div className="gp-group-rows">
                  {visibleIds.map((id) => {
                    const entry = entriesRef.current.get(id);
                    const label = `${entry.request.method} ${rowLabel(entry.request.url, entry._resourceType)}`;
                    return (
                      <GroupedRequestRow
                        key={id}
                        entry={entry}
                        flash={flashIds.has(id)}
                        selection={
                          isRecording
                            ? { checked: selected.has(id), onChange: () => toggleRow(id), label: `Select ${label}` }
                            : undefined
                        }
                        renderMenu={
                          isRecording
                            ? (onOpenChange) => (
                                <RowMenu
                                  groups={groups}
                                  ownGroupId={group.id}
                                  requestLabel={label}
                                  onOpenChange={onOpenChange}
                                  onMove={(groupId) => handleMove([id], groupId)}
                                  onDelete={() => handleDelete([id])}
                                />
                              )
                            : undefined
                        }
                      />
                    );
                  })}
                  {visibleIds.length === 0 && (
                    <div className="gp-group-empty">
                      {emptyGroupText({ hasRequests: liveIds.length > 0, active: isActive, paused })}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {!manifestOnly && (
        <div className="gp-bottom">
          {reuseNotice && (
            <StatusBanner variant="info" icon="info" onClose={() => setReuseNotice(null)}>
              {reuseNotice}
            </StatusBanner>
          )}
          <div className="gp-new-group-wrap">
            <button
              type="button"
              className="gp-new-group"
              disabled={!isRecording}
              aria-describedby="gp-new-group-tip"
              onClick={handleNewGroup}
            >
              <Icon name="folderPlus" size={15} />
              New group
            </button>
            <span role="tooltip" id="gp-new-group-tip" className="gp-tooltip">
              {NEW_GROUP_TOOLTIP}
            </span>
          </div>
        </div>
      )}

      <footer className="gp-footer">
        {!manifestOnly && <span>{footer}</span>}
        <span className="gp-version">v{chrome.runtime.getManifest().version}</span>
      </footer>
    </div>
  );
};

export default GroupedNetworkRecordingPanel;
