// Stash service worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('Stash installed');
});

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STASH_ITEMS') {
    chrome.storage.local.get(null, (items) => {
      const stashItems = Object.values(items).filter(v => v && v.id && v.url);
      sendResponse({ items: stashItems });
    });
    return true;
  }

  if (message.type === 'SAVE_ITEM') {
    const item = message.item;
    chrome.storage.local.set({ [item.id]: item }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'DELETE_ITEM') {
    chrome.storage.local.remove(message.id, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'UPDATE_ITEM') {
    chrome.storage.local.get(message.id, (result) => {
      if (result[message.id]) {
        const updated = { ...result[message.id], ...message.updates };
        chrome.storage.local.set({ [message.id]: updated }, () => {
          sendResponse({ success: true, item: updated });
        });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  }
});
