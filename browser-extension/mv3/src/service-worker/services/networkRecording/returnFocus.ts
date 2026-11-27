export interface FocusTarget {
  senderTabId?: number;
  senderWindowId?: number;
  fallbackUrl: string;
}

// Return the user to where they came from after a recording ends. Cascade:
//   1. the originating LTS tab, if it still exists: select it and bring its window to the front
//      (tabs.update alone leaves another window, e.g. the recording window, in front)
//   2. else its window (LTS tab closed but window alive), focusing it
//   3. else open the LTS fallback URL in a new tab (tab + window both gone)
// Each step is guarded; failures fall through to the next.
export const returnFocusToSender = ({ senderTabId, senderWindowId, fallbackUrl }: FocusTarget): void => {
  const openFallback = () => {
    chrome.tabs.create({ url: fallbackUrl }).catch(() => {});
  };

  const tryWindowThenFallback = () => {
    if (senderWindowId === undefined) {
      openFallback();
      return;
    }
    chrome.windows.update(senderWindowId, { focused: true }).then(
      () => {},
      () => openFallback()
    );
  };

  if (senderTabId === undefined) {
    tryWindowThenFallback();
    return;
  }

  // tabs.get rejects if the tab is gone -> fall through to window, then fallback.
  chrome.tabs.get(senderTabId).then(
    (tab) =>
      chrome.tabs
        .update(senderTabId, { active: true })
        .then((updated) => chrome.windows.update(updated?.windowId ?? tab.windowId, { focused: true }))
        .then(() => {}, tryWindowThenFallback),
    tryWindowThenFallback
  );
};
