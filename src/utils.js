import { PRICE_LABELS, RESERVATION_PLATFORM_DOMAINS } from './config.js';

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// priceLevel（$/$$/$$$/$$$$ 等級）在很多店家（尤其台灣的店）都沒有資料，
// 但新版 Places API 另外提供 priceRange（實際金額區間），有資料時可以拿來當備援顯示
export function formatMoney(money) {
  if (!money || money.units == null) return '';
  const amount = Number(money.units);
  if (Number.isNaN(amount)) return '';
  return `${money.currencyCode || ''}${amount}`;
}

export function formatPriceRange(priceRange) {
  if (!priceRange) return '';
  const start = formatMoney(priceRange.startPrice);
  const end = formatMoney(priceRange.endPrice);
  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} 起`;
  if (end) return `${end} 以下`;
  return '';
}

export function priceText(p) {
  return PRICE_LABELS[p.priceLevel] || formatPriceRange(p.priceRange);
}

function isReservationPlatformUrl(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return RESERVATION_PLATFORM_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

// Places API 的 reservable 欄位屬於更貴的 Enterprise + Atmosphere SKU，且資料涵蓋率
// 未知（跟 priceLevel 一樣，很多店家可能查不到），不值得為了這個欄位讓每次搜尋都被
// 算成更貴的等級。改成只要查得到官網（websiteUri，跟其他既有欄位同一個 SKU 不加價），
// 就顯示連結讓使用者自己去確認能不能訂位，不在按鈕文字上暗示「這間店一定能訂位」
export function websiteLinkHtml(p, extraAttrs) {
  if (!p.websiteUri) return '';
  const label = isReservationPlatformUrl(p.websiteUri) ? '🍽️ 線上訂位' : '🔗 官方網站';
  return `<a href="${escapeHtml(p.websiteUri)}" target="_blank" rel="noopener noreferrer" ${extraAttrs || ''}>${label}</a>`;
}

// 帶原本的起點/終點，把這間店當中途停靠點，開起來是一條完整的「起點→餐廳→目的地」路線；
// 沒填目的地時就直接導航去這間店，不需要中途停靠點
// 注意：waypoints 參數不支援 place_id: 前綴（實測會被當成純文字搜尋，顯示「找不到」），只能用經緯度
export function buildNavUrl(pos, origin, destination) {
  const base = `https://www.google.com/maps/dir/?api=1`
    + `&origin=${encodeURIComponent(origin)}`
    + `&travelmode=driving`;
  return destination
    ? base
      + `&destination=${encodeURIComponent(destination)}`
      + `&waypoints=${encodeURIComponent(`${pos.lat},${pos.lng}`)}`
    : base + `&destination=${encodeURIComponent(`${pos.lat},${pos.lng}`)}`;
}

export function formatRouteDistance(meters, destination) {
  if (typeof meters !== 'number') return '';
  // 沒填目的地時是「離起點多遠」，有填目的地時才是「離路線多遠」
  const label = destination ? '距路線' : '距起點';
  return meters >= 1000
    ? `${label} ${(meters / 1000).toFixed(1)} 公里`
    : `${label} ${Math.round(meters)} 公尺`;
}
