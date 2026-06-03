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

function isProductPage() {
  const path = window.location.pathname;
  const search = window.location.search;

  // ── Explicit non-product pages ───────────────────────────────────────────
  // Search results, category listings with filters
  if (/^\/s(\?|$)/.test(path)) return false;           // Amazon search: /s?k=
  if (/[?&](k|q|query|search|keyword)=/.test(search)) return false; // search queries
  if (/[?&](page|pg)=\d/.test(search) && !/\/dp\/|\/products\//.test(path)) return false; // paginated listing
  // Get the last non-empty path segment
  const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1] || '';

  // ── Tier 1: Structured data — most reliable ──────────────────────────────
  if (getMeta('og:type') === 'product') return true;
  if (getMeta('og:price:amount') || getMeta('product:price:amount')) return true;
  if (document.querySelector('[itemtype*="schema.org/Product"]')) return true;
  if (getJsonLd()) return true;

  // ── Tier 2: URL patterns for known platforms ─────────────────────────────
  // Shopify: /products/product-slug
  if (/^\/products\/[^/]+\/?$/.test(path)) return true;
  // Cettire, generic: /p/slug
  if (/\/(product|item|p)\/[^/]/.test(path)) return true;
  // Amazon: /dp/ASIN or /gp/product/ASIN
  if (/\/dp\/[A-Z0-9]|\/gp\/product\//.test(path)) return true;
  // Farfetch: item-name-12345.aspx
  if (/\/[^/]+-\d{5,}\.(html?|aspx)$/.test(path)) return true;
  // PDP paths
  if (/\/(pdp|product-detail|product_detail)\//.test(path)) return true;
  // ASOS: /prd/12345
  if (/\/prd\/\d+/.test(path)) return true;
  // Net-a-Porter: /shop/product/
  if (/\/shop\/product\//.test(path)) return true;

  // ── Tier 3: Last URL segment ends with a numeric ID ──────────────────────
  // Covers Mytheresa (-p00975477), most custom stores, any site that appends
  // a product ID to the slug. 5+ digits avoids false matches on years (2024).
  if (/\d{5,}$/.test(lastSegment)) return true;
  // Also catches patterns like: slug-p00123, slug_123456, slug.12345
  if (/[-_.]p?\d{5,}$/.test(lastSegment)) return true;

  // ── Tier 4: Single add-to-cart button ────────────────────────────────────
  const addToCartBtns = document.querySelectorAll(
    'button[name="add"], [class*="add-to-cart"], [class*="AddToCart"], [class*="add_to_cart"], [id*="add-to-cart"], [id*="AddToCart"], [data-action*="add-to-cart"]'
  );
  if (addToCartBtns.length === 1) return true;

  return false;
}

function detectProduct() {
  const jsonLd = getJsonLd();

  const title = jsonLd?.name || getMeta('og:title') || document.querySelector('h1')?.textContent?.trim() || document.title;
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
  const price = extractPrice(jsonLd) || getMeta('og:price:amount') || getMeta('product:price:amount') || domPrice || null;

  const onProductPage = isProductPage();
  const domain = window.location.hostname;

  return {
    title,
    price,
    image,
    domain,
    isProductPage: onProductPage,
    isStorePage: !onProductPage,  // any non-product http page = store state
    url: window.location.href
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PRODUCT_DATA') {
    sendResponse(detectProduct());
  }
  return true;
});
