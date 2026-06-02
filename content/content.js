// content script — runs on every page

function getJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product') return item;
        if (item['@graph']) {
          const prod = item['@graph'].find(n => n['@type'] === 'Product');
          if (prod) return prod;
        }
      }
    } catch (e) {}
  }
  return null;
}

function getMeta(property) {
  const el = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
  return el ? el.getAttribute('content') : null;
}

function extractPrice(jsonLd) {
  if (!jsonLd) return null;
  if (jsonLd.offers) {
    const offers = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
    if (offers.price !== undefined) return String(offers.price);
    if (offers.lowPrice !== undefined) return String(offers.lowPrice);
  }
  if (jsonLd.price !== undefined) return String(jsonLd.price);
  return null;
}

function extractImage(jsonLd) {
  if (jsonLd && jsonLd.image) {
    if (typeof jsonLd.image === 'string') return jsonLd.image;
    if (Array.isArray(jsonLd.image)) return jsonLd.image[0];
    if (jsonLd.image.url) return jsonLd.image.url;
  }
  const ogImage = getMeta('og:image');
  if (ogImage) return ogImage;
  const img = document.querySelector('[itemprop="image"], .product-image img, #product-image img, .product__image img');
  if (img) return img.src || img.getAttribute('content') || null;
  return null;
}

function countVisiblePrices() {
  const els = document.querySelectorAll(
    '[itemprop="price"], [class*="price"]:not(script):not(style), [class*="Price"]:not(script):not(style), [data-price], [data-product-price]'
  );
  let count = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) count++;
    if (count > 3) break; // short-circuit
  }
  return count;
}

function detectProduct() {
  const jsonLd = getJsonLd();
  const path = window.location.pathname;
  const search = window.location.search;

  // --- Extract metadata ---
  let title = jsonLd?.name || getMeta('og:title') || document.querySelector('h1')?.textContent?.trim() || document.title;
  const image = extractImage(jsonLd);

  const priceSelectors = [
    '[itemprop="price"]', '.price', '.product-price', '.product__price',
    '[class*="price"]', '[class*="Price"]', '[data-price]', '[data-product-price]',
  ];
  let domPrice = null;
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      domPrice = el.getAttribute('content') || el.getAttribute('data-price') || el.textContent?.trim();
      if (domPrice) break;
    }
  }
  const finalPrice = extractPrice(jsonLd) || getMeta('og:price:amount') || getMeta('product:price:amount') || domPrice || null;

  // ── RULE 2: Not a product URL = listing/store page ────────────────────────
  // Single product pages always have a unique identifier in the URL.
  // Anything without a product URL pattern is a listing or non-commerce page.
  const hasMultiplePrices = countVisiblePrices() > 3;

  const isListingPage = !hasProductUrl || hasMultiplePrices;

  // ── RULE 1: Single product signals ───────────────────────────────────────
  const hasStrongMeta =
    getMeta('og:type') === 'product' ||
    !!document.querySelector('[itemtype*="schema.org/Product"]') ||
    !!getMeta('og:price:amount') ||
    !!getMeta('product:price:amount') ||
    !!jsonLd;

  const hasProductUrl =
    /\/products\/[^/?#]+(\/)?$/i.test(path) ||   // Shopify
    /\/(product|item|p)\/[^/?#]/i.test(path) ||   // /product/slug, /p/slug (Cettire)
    /\/dp\/[A-Z0-9]/i.test(path) ||               // Amazon
    /\/[^/]+-\d{5,}\.(html?|aspx)$/i.test(path) || // Farfetch
    /\/(pdp|product-detail|product_detail)\//i.test(path);

  const hasAddToCart = !!document.querySelector(
    'button[name="add"], [class*="add-to-cart"], [class*="AddToCart"], [class*="add_to_cart"], [id*="add-to-cart"], [id*="AddToCart"], [data-action*="add-to-cart"]'
  );

  // Rule 2 overrides Rule 1
  const isProductPage = !isListingPage && (hasStrongMeta || hasProductUrl || hasAddToCart);

  // ── RULE 3: Store vs empty ────────────────────────────────────────────────
  // Store = listing page that has at least one price or product signal on it
  const hasAnyPrice = countVisiblePrices() > 0;
  const hasAddToCartAnywhere = !!document.querySelector(
    'button[name="add"], [class*="add-to-cart"], [class*="AddToCart"], [class*="add_to_cart"], [id*="add-to-cart"], [id*="AddToCart"]'
  );
  const isStorePage = !isProductPage && isListingPage && (hasAnyPrice || hasAddToCartAnywhere || hasStrongMeta);

  return { title, price: finalPrice, image, isProductPage, isStorePage, url: window.location.href };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PRODUCT_DATA') {
    sendResponse(detectProduct());
  }
  return true;
});
