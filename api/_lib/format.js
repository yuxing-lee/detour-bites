// Port of the response-formatting bits of src/utils.js needed for the API's
// JSON output (no HTML escaping here — this isn't rendered as HTML).
import { PRICE_LABELS } from './config.js';

function formatMoney(money) {
  if (!money || money.units == null) return '';
  const amount = Number(money.units);
  if (Number.isNaN(amount)) return '';
  return `${money.currencyCode || ''}${amount}`;
}

function formatPriceRange(priceRange) {
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

// 帶原本的起點/目的地，把這間店當中途停靠點；沒填目的地時直接導航去這間店
// （跟 src/utils.js 的 buildNavUrl 邏輯一致）
export function buildNavUrl(pos, origin, destination) {
  const base = 'https://www.google.com/maps/dir/?api=1'
    + `&origin=${encodeURIComponent(origin)}`
    + '&travelmode=driving';
  return destination
    ? base
      + `&destination=${encodeURIComponent(destination)}`
      + `&waypoints=${encodeURIComponent(`${pos.lat},${pos.lng}`)}`
    : base + `&destination=${encodeURIComponent(`${pos.lat},${pos.lng}`)}`;
}
