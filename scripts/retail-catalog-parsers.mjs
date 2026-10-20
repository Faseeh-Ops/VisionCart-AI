// Parse public catalog responses without executing retailer scripts.
export const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))).replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, n) => ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[n]).replace(/\s+/g, ' ').trim();
export function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), clean(m[2] ?? m[3])]));
}
export function canonical(url, base) {
  const u = new URL(url, base); u.pathname = u.pathname.replace(/\/{2,}/g, '/'); return u.href;
}
export function rahimCategories(html) {
  const result = new Map();
  for (const m of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const a = attributes(m[0]);
    if (a.hitem_code) result.set(a.hitem_code, {store:'rahim', id:a.hitem_code, name:clean(m[0]), url:canonical(a.href, 'https://www.rahimstore.com'), department_id:a.head_code, group_id:a.hdept_code});
  }
  return [...result.values()];
}
const amount = s => { const n = Number(clean(s).replace(/,/g,'')); return s != null && clean(s) !== '' && Number.isFinite(n) && n >= 0 ? n : null; };
export function rahimListing(html, category, scrapedAt) {
  const totalMatch = html.match(/Items\s+[\d,]+\s*-\s*[\d,]+\s+of\s+([\d,]+)/i);
  const products = [];
  // Only cards containing a product image and its Add to Cart data are accepted.
  for (const card of html.split(/<div\s+class=['"]item img-hover-zoom--quick-zoom['"][^>]*>/i).slice(1)) {
    const img = attributes(card.match(/<img\b[^>]*>/i)?.[0] || '');
    const button = attributes(card.match(/<button\b[^>]*id=['"]btn-add-to-cart['"][^>]*>/i)?.[0] || '');
    const fields = button.data?.split('~');
    if (!fields || fields[0] !== img.productid || !img.src || !img.alt) continue;
    const current = card.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1]?.replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '');
    const old = card.match(/<(?:strike|del|s)\b[^>]*>([\s\S]*?)<\/(?:strike|del|s)>/i)?.[1];
    const selling = amount(current), regular = old == null ? selling : amount(old);
    const image = new URL(canonical(img.src, category.url)); image.search = '';
    products.push({id:`rahim:${fields[0]}`, store:'rahim', source_product_id:fields[0], name:img.alt, barcode:null, currency:'PKR', regular_price:regular, selling_price:selling, price_basis:old == null ? 'displayed_price_no_separate_discount' : 'displayed_struck_through_price', price_unit:'retailer_pack', availability:null, location_context:'Retailer website default; branch not exposed', source_url:`https://www.rahimstore.com/product/${fields[0]}`, image_url:image.href, category_ids:[category.id], category_names:[category.name], scraped_at:scrapedAt});
  }
  return {products, total:totalMatch ? Number(totalMatch[1].replace(/,/g,'')) : null};
}
export function carrefourCategories(html, sitemap = '') {
  const result = new Map();
  for (const m of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const a = attributes(m[0]), id = a.href?.match(/\/c\/((?:N?FPAK)\d+)/i)?.[1]?.toUpperCase();
    const label=attributes(m[0].match(/<img\b[^>]*>/i)?.[0] || '').alt || clean(m[0]);
    if (id) result.set(id, {store:'carrefour', id, name:label==='View All'?null:label, url:`https://www.carrefour.pk/mafpak/en/c/${id}`});
  }
  for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const id = m[1].match(/\/c\/((?:N?FPAK)\d+)$/i)?.[1]?.toUpperCase();
    if (id && !result.has(id)) result.set(id, {store:'carrefour', id, name:null, url:clean(m[1])});
  }
  return [...result.values()];
}
export function flightObjects(html) {
  let stream = '';
  for (const m of html.matchAll(/<script[^>]*>self\.__next_f\.push\(([\s\S]*?)\)<\/script>/g)) {
    try { const d = JSON.parse(m[1]); if (d[0] === 1 && typeof d[1] === 'string') stream += d[1]; } catch { /* Non-JSON Flight records are not catalog data. */ }
  }
  const roots = [];
  for (const line of stream.split('\n')) { try { roots.push(JSON.parse(line.slice(line.indexOf(':') + 1))); } catch {} }
  return roots;
}
export function carrefourListing(html, category, scrapedAt) {
  const products = new Map(); let pagination = null, title = null;
  function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.pagination?.totalResults != null) pagination = o.pagination;
    if (o.additionalAttributes?.title) title = o.additionalAttributes.title;
    if (o.productId && o.productName && typeof o.sellingPrice === 'number' && o.productUrl) {
      const id = `carrefour:${o.productId}:${o.offerId || 'default'}:${o.intent || 'default'}`;
      products.set(id, {id, store:'carrefour', source_product_id:String(o.productId), offer_id:o.offerId || null, name:clean(o.productName), barcode:null, currency:o.currency || null, regular_price:typeof o.markedPrice === 'number' && o.markedPrice >= 0 ? o.markedPrice : null, selling_price:o.sellingPrice, price_basis:'retailer_markedPrice', price_unit:o.quantityTypeKey || null, availability:o.stock?.stockLevelStatus || null, location_context:'Website default delivery context; verify delivery area before using prices', service_context:o.intent || null, seller:o.shopName || null, source_url:canonical(o.productUrl, 'https://www.carrefour.pk'), image_url:o.imageUrl ? canonical(o.imageUrl, 'https://www.carrefour.pk') : null, category_ids:[category.id], category_names:category.name ? [category.name] : [], scraped_at:scrapedAt});
    }
    for (const v of Object.values(o)) if (typeof v === 'object') walk(v);
  }
  flightObjects(html).forEach(walk);
  return {products:[...products.values()], pagination, title};
}
export function csv(rows, fields) {
  const cell = v => { let s = Array.isArray(v) ? v.join(' | ') : String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g,'""') + '"'; };
  return '\ufeff' + [fields, ...rows.map(r => fields.map(k => r[k]))].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
