// Service worker: injects the viewer into pages the detector reports as raw JSON, and opens the paste page from the
// toolbar button.

chrome.runtime.onMessage.addListener((message: { type?: string }, sender) => {
  if (message.type !== "brace-render" || sender.tab?.id === undefined) return;
  const target = { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] };
  void chrome.scripting
    .insertCSS({ target, files: ["styles.css"] })
    .then(() => chrome.scripting.executeScript({ target, files: ["parse.js", "viewer.js", "page.js"] }))
    .catch((error) => console.warn("Brace could not render this page:", error));
});

// The toolbar button opens the paste page, reusing an open one.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("tool.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});
