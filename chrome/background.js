/*
 * Chrome background service worker.
 * Clicking the toolbar icon opens the side panel; note that Chrome only
 * allows the panel to open from a user gesture, so it cannot be opened
 * automatically when a match is detected.
 */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error('sidePanel.setPanelBehavior failed', e));

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ following: true }, (v) => {
    chrome.storage.local.set({ following: v.following });
  });
});
