import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { NetworkEntry } from "./types";
import NetworkEventRow from "./components/NetworkEventRow";
import FilterBar from "./components/FilterBar";

// Maps the HAR _resourceType (DevTools enum) to the short label shown in the list.
const RESOURCE_TYPE_DISPLAY: Record<string, string> = {
  document: "document",
  stylesheet: "css",
  script: "js",
  image: "img",
  font: "font",
  media: "media",
  websocket: "ws",
  xhr: "xhr",
  other: "other",
};

const formatTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatSize = (bytes: number | undefined): string => {
  if (bytes === undefined || bytes < 0) return "—"; // -1 = size unknown (HAR sentinel)
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Why a recording ended — mirrors the StopReason union in the service worker.
type StopReason = "user" | "max-duration" | "connection-lost" | "tab-closed" | "extension-disabled";

// Banner shown for SW-initiated stops. `user` and `tab-closed` show no banner (the user knows /
// the panel is gone), so they're absent from this map.
const STOP_BANNERS: Partial<Record<StopReason, { icon: string; text: string; variant: string }>> = {
  "max-duration": {
    icon: "⏱",
    text: "Recording stopped — time limit reached",
    variant: "warning",
  },
  "connection-lost": {
    icon: "⚠",
    text: "Connection to Load Testing lost — recording stopped",
    variant: "error",
  },
  "extension-disabled": {
    icon: "⚠",
    text: "Requestly was disabled — recording stopped",
    variant: "error",
  },
};

const NetworkRecordingPanel: React.FC = () => {
  const [entries, setEntries] = useState<NetworkEntry[]>([]);
  const [filter, setFilter] = useState({ text: "", method: "ALL" });
  const [recordingStartTime, setRecordingStartTime] = useState<number>(Date.now());
  const [isRecording, setIsRecording] = useState(true);
  const [stopReason, setStopReason] = useState<StopReason | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [targetUrl, setTargetUrl] = useState("");
  const currentTabIdRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      // Bind to the recording this panel is for. On Chrome/Edge the SW opens the per-tab panel
      // with ?tabId=<targetTabId>, so we read it from our own URL — deterministic even when
      // multiple tabs are recording at once. Firefox has a single global sidebar (no per-tab URL),
      // so fall back to the active tab; the sidebar then shows whichever recorded tab is active.
      const tabIdParam = new URLSearchParams(window.location.search).get("tabId");
      let tabId = tabIdParam ? Number(tabIdParam) : null;
      if (tabId === null) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id ?? null;
      }
      if (tabId === null) return;
      currentTabIdRef.current = tabId;

      chrome.runtime.sendMessage({ action: "getNetworkRecordingState", tabId }, (response) => {
        if (response?.active) {
          setEntries(response.entries || []);
          setRecordingStartTime(response.startTime);
          setIsRecording(true);
          // Header host comes from the recording's own URL (the SW's source of truth), not the
          // active tab — important on Firefox where the active tab may not be the recorded one.
          try {
            setTargetUrl(new URL(response.url).hostname);
          } catch {
            setTargetUrl(response.url || "");
          }
        }
      });
    };

    init();

    const listener = (message: any) => {
      if (message.tabId !== currentTabIdRef.current) return;
      if (message.action === "networkEventCaptured") {
        setEntries((prev) => [...prev, message.entry]);
      } else if (message.action === "networkRecordingEnded") {
        setIsRecording(false);
        setStopReason(message.reason ?? "user");
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!isRecording) return undefined;

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - recordingStartTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording, recordingStartTime]);

  // Auto-scroll to the newest entry, but only while the user is pinned to the bottom.
  // Once they scroll up, stop yanking them back down until they return to the bottom.
  const stickToBottomRef = useRef(true);

  const handleListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 24; // within ~1 row of the bottom
  }, []);

  useEffect(() => {
    if (listRef.current && stickToBottomRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries.length]);

  const handleStop = useCallback(() => {
    chrome.runtime.sendMessage({
      action: "stopNetworkRecording",
      targetTabId: currentTabIdRef.current,
    });
    setIsRecording(false);
    setStopReason("user");
  }, []);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (filter.method !== "ALL" && entry.request.method !== filter.method) return false;
      if (filter.text && !entry.request.url.toLowerCase().includes(filter.text.toLowerCase())) return false;
      return true;
    });
  }, [entries, filter]);

  const counts = useMemo(() => {
    const total = filteredEntries.length;
    const xhr = filteredEntries.filter((e) => e._resourceType === "xhr").length;
    const docs = filteredEntries.filter((e) => e._resourceType === "document").length;
    const staticCount = filteredEntries.filter((e) =>
      ["script", "stylesheet", "image", "font"].includes(e._resourceType as string)
    ).length;
    return { total, xhr, docs, static: staticCount };
  }, [filteredEntries]);

  return (
    <div className="network-panel">
      <div className="panel-header">
        <div className="header-top">
          <div className="recording-status">
            {isRecording && <span className="recording-dot" />}
            <span className="recording-label">{isRecording ? "Recording" : "Stopped"}</span>
            <span className="recording-time">{formatTime(elapsedTime)}</span>
          </div>
          {isRecording && (
            <button className="stop-btn" onClick={handleStop}>
              <span className="stop-icon" />
              Stop
            </button>
          )}
        </div>
        {targetUrl && <div className="target-url">{targetUrl}</div>}
      </div>

      {!isRecording && stopReason && STOP_BANNERS[stopReason] && (
        <div className={`end-banner end-banner--${STOP_BANNERS[stopReason].variant}`}>
          <span className="end-banner-icon">{STOP_BANNERS[stopReason].icon}</span>
          <span className="end-banner-text">{STOP_BANNERS[stopReason].text}</span>
        </div>
      )}

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

      <div className="request-list" ref={listRef} onScroll={handleListScroll}>
        {filteredEntries.map((entry) => (
          <NetworkEventRow
            key={entry._request_id as string}
            entry={entry}
            typeDisplay={
              RESOURCE_TYPE_DISPLAY[entry._resourceType as string] || (entry._resourceType as string) || "other"
            }
            formatSize={formatSize}
          />
        ))}
        {filteredEntries.length === 0 && (
          <div className="empty-state">
            {entries.length === 0 ? "Waiting for network requests..." : "No requests match the current filter"}
          </div>
        )}
      </div>

      <div className="panel-footer">
        <span className="version">v{chrome.runtime.getManifest().version}</span>
      </div>
    </div>
  );
};

export default NetworkRecordingPanel;
