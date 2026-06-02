// content script — runs on every page
// Extracts product info and responds to popup requests

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

function detectProduct() {
  const jsonLd = getJsonLd();

  let title = null;
  if (jsonLd && jsonLd.name) {
    title = jsonLd.name;
  } else {
    title = getMeta('og:title') || document.querySelector('h1')?.textContent?.trim() || document.title;
  }

  const image = extractImage(jsonLd);

  // Broaden price detection for sites with custom selectors
  const priceSelectors = [
    '[itemprop="price"]',
    '.price', '.product-price', '.product__price',
    '[class*="price"]', '[class*="Price"]',
    '[data-price]', '[data-product-price]',
  ];
  let domPrice = null;
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      domPrice = el.getAttribute('content') || el.getAttribute('data-price') || el.textContent?.trim();
      if (domPrice) break;
    }
  }

  const finalPrice = extractPrice(jsonLd) ||
    getMeta('og:price:amount') ||
    getMeta('product:price:amount') ||
    domPrice ||
    null;

  const path = window.location.pathname;

  // Definitively a listing/home path — never a single product
  const isListingPath = /^\/?$/.test(path) ||
    /^\/?(shop|store|collections?|categories|category|search|listing|brands?|sale|new-in|new-arrivals?|featured|home)\/?$/i.test(path) ||
    /\/(shop|store|collections?|categories|category|search|listing|brands?)(\/|$|\?)/i.test(path) ||
    /\/products\/[^/?#]+\//i.test(path); // /products/all/new-arrivals/ style collection URLs

  // URL pattern pointing at a single product slug
  const isProductUrl = /\/(product|item|p)\/[^/]+/i.test(path) ||
    /\/products\/[^/?#]+$/i.test(path);

  // Multiple product cards = listing grid, not a single product
  const productCardCount = document.querySelectorAll(
    '[class*="product-card"], [class*="ProductCard"], [class*="product-item"], [class*="ProductItem"]'
  ).length;
  const isGrid = productCardCount > 3;

  const isProductPage = !isListingPath && !isGrid && !!(
    isProductUrl ||
    (!isGrid && getMeta('og:type') === 'product') ||
    document.querySelector('[itemtype*="Product"]') ||
    getMeta('og:price:amount') ||
    getMeta('product:price:amount') ||
    (jsonLd && isProductUrl) ||
    (!isGrid && document.querySelector('[itemprop="price"]') && !document.querySelector('[class*="product-card"], [class*="ProductCard"]')) ||
    (!isGrid && domPrice && document.querySelector('[class*="product-detail"], [class*="ProductDetail"], [class*="product__title"]'))
  );

  // Detect if we're on a store/shop site even if not a product page
  const isStorePage = !isProductPage && !!(
    isListingPath ||
    isGrid ||
    /\/(shop|store|collections?|category|search|listing|products)\b/i.test(path)
  );

  return { title, price: finalPrice, image, isProductPage, isStorePage, url: window.location.href };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PRODUCT_DATA') {
    const data = detectProduct();
    sendResponse(data);
  }
  return true;
});
