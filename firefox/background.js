/*
 * Firefox background script.
 * Clicking the toolbar icon toggles the sidebar; Firefox only allows
 * opening the sidebar from a user gesture, so it cannot be opened
 * automatically when a match is detected.
 */
browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

browser.runtime.onInstalled.addListener(async () => {
  const v = await browser.storage.local.get({ following: true });
  await browser.storage.local.set({ following: v.following });
});
