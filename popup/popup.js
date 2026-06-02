document.addEventListener('DOMContentLoaded', async () => {
  const closeBtn = document.getElementById('closeBtn');
  const viewStashLink = document.getElementById('viewStashLink');
  const saveManuallyBtn = document.getElementById('saveManuallyBtn');
  const saveBtn = document.getElementById('saveBtn');
  const doneBtn = document.getElementById('doneBtn');
  const addNoteBtn = document.getElementById('addNoteBtn');
  const saveNoteBtn = document.getElementById('saveNoteBtn');
  const notifyToggle = document.getElementById('notifyToggle');
  const productNotifyToggle = document.getElementById('productNotifyToggle');
  const savedCollection = document.getElementById('savedCollection');
  const productCollection = document.getElementById('productCollection');
  const noteArea = document.getElementById('noteArea');
  const noteInput = document.getElementById('noteInput');
  const watchingFrom = document.getElementById('watchingFrom');

  let currentItem = null;
  let currentTab = null;

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Setup "View stash" link
  viewStashLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('stash.html') });
    window.close();
  });

  // Close button
  closeBtn.addEventListener('click', () => window.close());

  // Save manually button
  saveManuallyBtn.addEventListener('click', () => {
    // Treat current page as a product with just title/url
    const item = {
      title: currentTab.title || currentTab.url,
      image: null,
      price: null,
      url: currentTab.url,
      domain: new URL(currentTab.url).hostname
    };
    showProductState(item);
  });

  // Request product data from content script
  let productData = null;
  try {
    productData = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PRODUCT_DATA' });
  } catch (e) {
    // Content script not injected yet — inject it programmatically and retry
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js']
      });
      productData = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PRODUCT_DATA' });
    } catch (e2) {
      productData = { isProductPage: false };
    }
  }

  // Check if URL is already saved
  const urlKey = urlToKey(tab.url);
  const stored = await chrome.storage.local.get(urlKey);
  currentItem = stored[urlKey] || null;

  if (currentItem) {
    showSavedState(currentItem);
  } else if (productData && productData.isProductPage) {
    showProductState(productData);
  } else {
    showEmptyState();
  }

  // ---- Save button ----
  saveBtn.addEventListener('click', async () => {
    if (!productData) return;
    const item = {
      id: urlToKey(tab.url),
      url: tab.url,
      title: productData.title || tab.title || tab.url,
      image: productData.image || null,
      price: productData.price || null,
      domain: productData.domain || new URL(tab.url).hostname,
      savedAt: new Date().toISOString(),
      collection: productCollection.value,
      notifyOnPriceDrop: productNotifyToggle.checked,
      note: ''
    };
    await chrome.storage.local.set({ [item.id]: item });
    currentItem = item;
    showSavedState(item);
  });

  // ---- Done button ----
  doneBtn.addEventListener('click', async () => {
    if (currentItem) {
      // Persist toggle + collection changes
      const updated = {
        ...currentItem,
        collection: savedCollection.value,
        notifyOnPriceDrop: notifyToggle.checked,
        note: noteInput.value
      };
      await chrome.storage.local.set({ [updated.id]: updated });
    }
    window.close();
  });

  // ---- Add note button ----
  addNoteBtn.addEventListener('click', () => {
    noteArea.classList.toggle('hidden');
    addNoteBtn.textContent = noteArea.classList.contains('hidden') ? 'Add note' : 'Hide note';
  });

  // ---- Save note button ----
  saveNoteBtn.addEventListener('click', async () => {
    if (currentItem) {
      const updated = { ...currentItem, note: noteInput.value };
      await chrome.storage.local.set({ [updated.id]: updated });
      currentItem = updated;
    }
  });

  // ---- Toggle: auto-save notify state ----
  notifyToggle.addEventListener('change', async () => {
    if (currentItem) {
      const updated = { ...currentItem, notifyOnPriceDrop: notifyToggle.checked };
      if (notifyToggle.checked && !currentItem.notifyOnPriceDrop) {
        updated.watchingSince = new Date().toISOString();
      }
      await chrome.storage.local.set({ [updated.id]: updated });
      currentItem = updated;
      updateWatchingFrom(updated);
    }
  });

  // ---- Collection: auto-save on change ----
  savedCollection.addEventListener('change', async () => {
    if (currentItem) {
      const updated = { ...currentItem, collection: savedCollection.value };
      await chrome.storage.local.set({ [updated.id]: updated });
      currentItem = updated;
    }
  });

  // ---- Helpers ----

  function urlToKey(url) {
    // Use base64-safe hash of URL as key
    return 'item_' + btoa(url).replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
  }

  function showState(id) {
    ['stateLoading', 'stateSaved', 'stateEmpty', 'stateProduct'].forEach(s => {
      document.getElementById(s).classList.add('hidden');
    });
    document.getElementById(id).classList.remove('hidden');
  }

  function showSavedState(item) {
    showState('stateSaved');
    document.getElementById('app').classList.remove('show-manual');

    document.getElementById('savedTitle').textContent = item.title || '';
    document.getElementById('savedDomain').textContent = item.domain || '';
    document.getElementById('savedPrice').textContent = item.price ? formatPrice(item.price) : '';

    const thumb = document.getElementById('savedThumb');
    if (item.image) {
      thumb.src = item.image;
      thumb.style.display = '';
    } else {
      thumb.src = '';
      thumb.style.display = 'none';
    }

    savedCollection.value = item.collection || '';
    notifyToggle.checked = !!item.notifyOnPriceDrop;
    updateWatchingFrom(item);

    if (item.note) {
      noteInput.value = item.note;
    }
  }

  function showProductState(data) {
    productData = data;
    showState('stateProduct');
    document.getElementById('app').classList.remove('show-manual');

    document.getElementById('productTitle').textContent = data.title || '';
    document.getElementById('productDomain').textContent = data.domain || (data.url ? new URL(data.url).hostname : '');
    document.getElementById('productPrice').textContent = data.price ? formatPrice(data.price) : '';

    const thumb = document.getElementById('productThumb');
    if (data.image) {
      thumb.src = data.image;
      thumb.style.display = '';
    } else {
      thumb.src = '';
      thumb.style.display = 'none';
    }
  }

  function showEmptyState() {
    showState('stateEmpty');
    document.getElementById('app').classList.add('show-manual');
  }

  function updateWatchingFrom(item) {
    if (item.notifyOnPriceDrop && item.watchingSince) {
      const d = new Date(item.watchingSince);
      watchingFrom.textContent = `Watching from ${formatDate(d)}`;
    } else if (item.notifyOnPriceDrop && item.savedAt) {
      const d = new Date(item.savedAt);
      watchingFrom.textContent = `Watching from ${formatDate(d)}`;
    } else {
      watchingFrom.textContent = '';
    }
  }

  function formatPrice(price) {
    // If already has currency symbol, return as-is
    if (/[$€£¥₹]/.test(price)) return price;
    return price;
  }

  function formatDate(d) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
});
