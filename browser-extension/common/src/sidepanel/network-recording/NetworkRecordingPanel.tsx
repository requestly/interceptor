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
  fetch: "fetch",
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

const NetworkRecordingPanel: React.FC = () => {
  const [entries, setEntries] = useState<NetworkEntry[]>([]);
  const [filter, setFilter] = useState({ text: "", method: "ALL" });
  const [recordingStartTime, setRecordingStartTime] = useState<number>(Date.now());
  const [isRecording, setIsRecording] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [targetUrl, setTargetUrl] = useState("");
  const currentTabIdRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      currentTabIdRef.current = tab.id;
      try {
        setTargetUrl(new URL(tab.url).hostname);
      } catch {
        setTargetUrl(tab.url || "");
      }

      chrome.runtime.sendMessage({ action: "getNetworkRecordingState", tabId: tab.id }, (response) => {
        if (response?.active) {
          setEntries(response.entries || []);
          setRecordingStartTime(response.startTime);
          setIsRecording(true);
        }
      });
    };

    init();

    const listener = (message: any) => {
      if (message.action === "networkEventCaptured" && message.tabId === currentTabIdRef.current) {
        setEntries((prev) => [...prev, message.entry]);
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
    const xhr = filteredEntries.filter((e) => e._resourceType === "xhr" || e._resourceType === "fetch").length;
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
