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

  const price = extractPrice(jsonLd) ||
    getMeta('og:price:amount') ||
    getMeta('product:price:amount') ||
    document.querySelector('[itemprop="price"]')?.getAttribute('content') ||
    document.querySelector('[itemprop="price"]')?.textContent?.trim() ||
    document.querySelector('.price, .product-price')?.textContent?.trim() ||
    null;

  const image = extractImage(jsonLd);

  const isProductPage = !!(jsonLd ||
    getMeta('og:type') === 'product' ||
    document.querySelector('[itemtype*="Product"]') ||
    document.querySelector('[itemprop="price"]') ||
    getMeta('og:price:amount') ||
    getMeta('product:price:amount'));

  return { title, price, image, isProductPage, url: window.location.href };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PRODUCT_DATA') {
    const data = detectProduct();
    sendResponse(data);
  }
  return true;
});
