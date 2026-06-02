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
  const path = window.location.pathname;

  let title = null;
  if (jsonLd && jsonLd.name) {
    title = jsonLd.name;
  } else {
    title = getMeta('og:title') || document.querySelector('h1')?.textContent?.trim() || document.title;
  }

  const image = extractImage(jsonLd);

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

  // Homepage
  const isHomepage = /^\/?$/.test(path);

  // Known listing/category URL patterns
  const isListingUrl =
    /\/(collections?|categories|category|shop|store|search|listing|brands?|sale|new-in|new-arrivals?|featured|home)(\/|$|\?)/i.test(path) ||
    /\/products\/[^/?#]+\/[^/?#]/i.test(path); // /products/all/subcategory (multi-segment)

  const isListingPath = isHomepage || isListingUrl;

  // URL patterns that reliably point to a single product
  const isProductUrl =
    /\/products\/[^/?#]+(\/)?$/i.test(path) ||          // Shopify: /products/slug or /products/slug/
    /\/(product|item|p)\/[^/?#]/i.test(path) ||          // /product/slug, /item/slug, /p/slug (Cettire)
    /\/dp\/[A-Z0-9]/i.test(path) ||                      // Amazon: /dp/ASIN
    /\/[^/]+-\d{5,}\.(html?|aspx)$/i.test(path) ||       // Farfetch: item-name-12345.aspx
    /\/(pdp|product-detail|product_detail)\//i.test(path); // PDP paths

  // More than 3 product cards = a grid/listing
  const productCardCount = document.querySelectorAll(
    '[class*="product-card"], [class*="ProductCard"], [class*="product-item"], [class*="ProductItem"], [class*="product-tile"], [class*="ProductTile"], [class*="ProductGrid"] li, [class*="product-grid"] li'
  ).length;
  const isGrid = productCardCount > 3;

  // Add-to-cart button is a strong single-product signal
  const hasAddToCart = !!document.querySelector(
    'button[name="add"], [class*="add-to-cart"], [class*="AddToCart"], [class*="add_to_cart"], [id*="add-to-cart"], [id*="AddToCart"], [data-action*="add-to-cart"]'
  );

  // Structured data / meta signals
  const hasStrongMeta = !!(
    jsonLd ||
    getMeta('og:type') === 'product' ||
    document.querySelector('[itemtype*="schema.org/Product"]') ||
    getMeta('og:price:amount') ||
    getMeta('product:price:amount')
  );

  const isProductPage = !isListingPath && !isGrid && !!(
    hasStrongMeta ||
    isProductUrl ||
    hasAddToCart
  );

  // Query string signals for listing pages (e.g. ?saleStatus=, ?sortBy=, ?filter=, ?page=)
  const search = window.location.search;
  const isListingQuery = /[?&](saleStatus|sortBy|sort|filter|page|category|gender|size|color|brand)=/i.test(search);

  const isStorePage = !isProductPage && !!(
    isListingPath ||
    isGrid ||
    isListingQuery ||
    /\/(shop|store|collections?|category|designers?|search|listing|products)\b/i.test(path)
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
