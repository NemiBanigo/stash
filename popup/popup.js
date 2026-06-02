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
  const savedCollectionNew = document.getElementById('savedCollectionNew');
  const productCollection = document.getElementById('productCollection');
  const productCollectionNew = document.getElementById('productCollectionNew');
  const noteArea = document.getElementById('noteArea');
  const noteInput = document.getElementById('noteInput');
  const watchingFrom = document.getElementById('watchingFrom');

  let currentItem = null;
  let currentTab = null;

  async function getCollectionNames() {
    const all = await chrome.storage.local.get(null);
    const names = new Set(['General']);
    for (const val of Object.values(all)) {
      if (val && typeof val === 'object' && val.collection) names.add(val.collection);
    }
    return [...names].sort();
  }

  async function populateSelect(select, currentValue) {
    const names = await getCollectionNames();
    select.innerHTML = '';
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '＋ New collection';
    select.appendChild(newOpt);
    select.value = names.includes(currentValue) ? currentValue : 'General';
  }

  function wireNewCollection(select, newInput) {
    select.addEventListener('change', () => {
      if (select.value === '__new__') {
        newInput.value = '';
        select.classList.add('hidden');
        newInput.classList.remove('hidden');
        newInput.focus();
      }
    });

    async function confirmNewCollection() {
      const name = newInput.value.trim() || 'General';
      await populateSelect(select, name);
      newInput.classList.add('hidden');
      select.classList.remove('hidden');
    }

    newInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmNewCollection(); }
      if (e.key === 'Escape') { newInput.value = ''; confirmNewCollection(); }
    });
    newInput.addEventListener('blur', confirmNewCollection);
  }

  await populateSelect(savedCollection, 'General');
  await populateSelect(productCollection, 'General');
  wireNewCollection(savedCollection, savedCollectionNew);
  wireNewCollection(productCollection, productCollectionNew);

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
      productData = { isProductPage: false, isStorePage: false };
    }
  }

  // Check if URL is already saved
  const urlKey = urlToKey(tab.url);
  const stored = await chrome.storage.local.get(urlKey);
  currentItem = stored[urlKey] || null;

  const isWebPage = tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'));

  if (currentItem) {
    await showSavedState(currentItem);
  } else if (productData && productData.isProductPage) {
    await showProductState(productData);
  } else if (productData && productData.isStorePage) {
    showStoreState();
  } else if (isWebPage) {
    // Any http/https page that isn't a detected product defaults to store state
    showStoreState();
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
      collection: productCollection.value.trim() || 'General',
      notifyOnPriceDrop: productNotifyToggle.checked,
      note: ''
    };
    await chrome.storage.local.set({ [item.id]: item });
    currentItem = item;
    await showSavedState(item);
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

  // ---- Collection: auto-save on change (skip __new__ sentinel) ----
  savedCollection.addEventListener('change', async () => {
    if (currentItem && savedCollection.value !== '__new__') {
      const updated = { ...currentItem, collection: savedCollection.value };
      await chrome.storage.local.set({ [updated.id]: updated });
      currentItem = updated;
    }
  });

  // ---- Helpers ----

  function urlToKey(url) {
    return 'item_' + btoa(encodeURIComponent(url)).replace(/[^a-zA-Z0-9]/g, '');
  }

  function showState(id) {
    ['stateLoading', 'stateSaved', 'stateEmpty', 'stateProduct', 'stateStore'].forEach(s => {
      document.getElementById(s).classList.add('hidden');
    });
    document.getElementById(id).classList.remove('hidden');
  }

  async function showSavedState(item) {
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

    await populateSelect(savedCollection, item.collection || 'General');
    notifyToggle.checked = !!item.notifyOnPriceDrop;
    updateWatchingFrom(item);

    if (item.note) {
      noteInput.value = item.note;
    }
  }

  async function showProductState(data) {
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

    await populateSelect(productCollection, 'General');
  }

  function showEmptyState() {
    showState('stateEmpty');
    document.getElementById('app').classList.add('show-manual');
  }

  function showStoreState() {
    showState('stateStore');
    document.getElementById('app').classList.remove('show-manual');
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
