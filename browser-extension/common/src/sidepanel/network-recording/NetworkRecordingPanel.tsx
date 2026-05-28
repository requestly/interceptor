import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { NetworkRecordingEvent } from "./types";
import NetworkEventRow from "./components/NetworkEventRow";
import FilterBar from "./components/FilterBar";

const RESOURCE_TYPE_DISPLAY: Record<string, string> = {
  xmlhttprequest: "xhr",
  main_frame: "document",
  sub_frame: "document",
  stylesheet: "css",
  script: "js",
  image: "img",
  font: "font",
  media: "media",
  websocket: "ws",
  other: "other",
  fetch: "fetch",
};

const formatTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatSize = (bytes: number | undefined): string => {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const NetworkRecordingPanel: React.FC = () => {
  const [events, setEvents] = useState<NetworkRecordingEvent[]>([]);
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
          setEvents(response.events || []);
          setRecordingStartTime(response.startTime);
          setIsRecording(true);
        }
      });
    };

    init();

    const listener = (message: any) => {
      if (message.action === "networkEventCaptured" && message.tabId === currentTabIdRef.current) {
        setEvents((prev) => [...prev, message.event]);
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

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events.length]);

  const handleStop = useCallback(() => {
    chrome.runtime.sendMessage({
      action: "stopNetworkRecording",
      targetTabId: currentTabIdRef.current,
    });
    setIsRecording(false);
  }, []);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (filter.method !== "ALL" && event.method !== filter.method) return false;
      if (filter.text && !event.url.toLowerCase().includes(filter.text.toLowerCase())) return false;
      return true;
    });
  }, [events, filter]);

  const counts = useMemo(() => {
    const total = filteredEvents.length;
    const xhr = filteredEvents.filter((e) => e.type === "xmlhttprequest" || e.type === "fetch").length;
    const docs = filteredEvents.filter((e) => e.type === "main_frame" || e.type === "sub_frame").length;
    const staticCount = filteredEvents.filter((e) => ["script", "stylesheet", "image", "font"].includes(e.type)).length;
    return { total, xhr, docs, static: staticCount };
  }, [filteredEvents]);

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

      <div className="request-list" ref={listRef}>
        {filteredEvents.map((event) => (
          <NetworkEventRow
            key={event.requestId}
            event={event}
            typeDisplay={RESOURCE_TYPE_DISPLAY[event.type] || event.type}
            formatSize={formatSize}
          />
        ))}
        {filteredEvents.length === 0 && (
          <div className="empty-state">
            {events.length === 0 ? "Waiting for network requests..." : "No requests match the current filter"}
          </div>
        )}
      </div>

      <div className="panel-footer">
        <span>Sending live updates to BrowserStack Load Testing</span>
        <span className="version">v{chrome.runtime.getManifest().version}</span>
      </div>
    </div>
  );
};

export default NetworkRecordingPanel;
