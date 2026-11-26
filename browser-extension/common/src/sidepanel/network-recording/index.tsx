import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import NetworkRecordingPanel from "./NetworkRecordingPanel";
import GroupedNetworkRecordingPanel, { GroupedPanelInitialState } from "./GroupedNetworkRecordingPanel";
import { resolvePanelTabId } from "./panelTab";
import "./index.css";

type PanelMode = { kind: "loading" } | { kind: "flat" } | { kind: "grouped"; initial: GroupedPanelInitialState };

// A recording that opted in to groups gets the grouped panel; every other recording keeps today's.
const PanelRoot: React.FC = () => {
  const [mode, setMode] = useState<PanelMode>({ kind: "loading" });

  useEffect(() => {
    resolvePanelTabId().then((tabId) => {
      if (tabId === null) {
        setMode({ kind: "flat" });
        return;
      }
      chrome.runtime.sendMessage({ action: "getNetworkRecordingState", tabId }, (response) => {
        void chrome.runtime.lastError;
        setMode(response?.groupsEnabled ? { kind: "grouped", initial: { ...response, tabId } } : { kind: "flat" });
      });
    });
  }, []);

  if (mode.kind === "loading") return null;
  if (mode.kind === "flat") return <NetworkRecordingPanel />;
  return <GroupedNetworkRecordingPanel initial={mode.initial} />;
};

const root = createRoot(document.getElementById("root"));
root.render(<PanelRoot />);
