document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('grid');
  const emptyPage = document.getElementById('emptyPage');
  const itemCount = document.getElementById('itemCount');
  const searchInput = document.getElementById('searchInput');
  const collectionFilter = document.getElementById('collectionFilter');

  let allItems = [];

  async function loadItems() {
    const stored = await chrome.storage.local.get(null);
    allItems = Object.values(stored).filter(v => v && v.id && v.url);
    allItems.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    populateCollections();
    renderItems();
  }

  function populateCollections() {
    const collections = [...new Set(allItems.map(i => i.collection).filter(Boolean))];
    const current = collectionFilter.value;
    // Clear except first option
    while (collectionFilter.options.length > 1) collectionFilter.remove(1);
    collections.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      collectionFilter.appendChild(opt);
    });
    collectionFilter.value = current;
  }

  function getFilteredItems() {
    const query = searchInput.value.toLowerCase().trim();
    const collection = collectionFilter.value;
    return allItems.filter(item => {
      if (collection && item.collection !== collection) return false;
      if (query) {
        const haystack = `${item.title} ${item.domain} ${item.price || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function renderItems() {
    const items = getFilteredItems();
    grid.innerHTML = '';

    itemCount.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

    if (items.length === 0) {
      emptyPage.classList.remove('hidden');
      return;
    }
    emptyPage.classList.add('hidden');

    items.forEach(item => {
      grid.appendChild(createCard(item));
    });
  }

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = item.id;

    let imageHtml;
    if (item.image) {
      imageHtml = `<img class="card-image" src="${escHtml(item.image)}" alt="${escHtml(item.title || '')}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <div class="card-image-placeholder" style="display:none">📦</div>`;
    } else {
      imageHtml = `<div class="card-image-placeholder">📦</div>`;
    }

    const date = item.savedAt ? formatDate(new Date(item.savedAt)) : '';
    const priceHtml = item.price ? `<div class="card-price">${escHtml(item.price)}</div>` : '';
    const notifyHtml = item.notifyOnPriceDrop ? `<span class="card-notify">● Watching</span>` : '';
    const collectionHtml = item.collection ? `<div class="card-collection">${escHtml(item.collection)}</div>` : '';

    card.innerHTML = `
      ${imageHtml}
      <div class="card-body">
        <div class="card-title">${escHtml(item.title || item.url)}</div>
        <div class="card-domain">${escHtml(item.domain || '')}</div>
        ${priceHtml}
        ${collectionHtml}
        <div class="card-meta">
          <span class="card-date">${date}</span>
          ${notifyHtml}
        </div>
      </div>
      <div class="card-actions">
        <button class="card-btn open" title="Open page">↗</button>
        <button class="card-btn delete" title="Delete">✕</button>
      </div>
    `;

    card.querySelector('.card-btn.open').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: item.url });
    });

    card.querySelector('.card-btn.delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.storage.local.remove(item.id);
      allItems = allItems.filter(i => i.id !== item.id);
      renderItems();
    });

    // Click card to open URL
    card.addEventListener('click', () => {
      chrome.tabs.create({ url: item.url });
    });

    return card;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(d) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  searchInput.addEventListener('input', renderItems);
  collectionFilter.addEventListener('change', renderItems);

  // Listen for storage changes (e.g., new items saved from popup)
  chrome.storage.onChanged.addListener(() => loadItems());

  await loadItems();
});
