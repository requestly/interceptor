// Which recorded tab this panel is for. On Chrome/Edge the service worker opens the per-tab panel
// with ?tabId=<targetTabId>, so it is read from the panel's own URL (deterministic when several tabs
// record at once). Firefox has one global sidebar with no per-tab URL, so it falls back to the active
// tab.
export const resolvePanelTabId = async (): Promise<number | null> => {
  const tabIdParam = new URLSearchParams(window.location.search).get("tabId");
  if (tabIdParam) return Number(tabIdParam);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
};
