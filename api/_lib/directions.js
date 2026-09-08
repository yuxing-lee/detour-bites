import { GOOGLE_MAPS_API_KEY } from './config.js';
import { decodePolyline } from './geo.js';

const LATLNG_RE = /^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/;

function isLatLngText(text) {
  return LATLNG_RE.test(text.trim());
}

function parseLatLngText(text) {
  const [lat, lng] = text.split(',').map(s => parseFloat(s.trim()));
  return { lat, lng };
}

// Siri 口述、或從聯絡人/地圖 App 貼過來的地址常常帶換行（例如
// "台灣\n241006 新北市 三重區\n大同南路139巷5號"），Directions/Geocoding
// API 通常能處理但沒必要冒險，統一收斂成單行空白分隔再送出去
function normalizeAddressText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

async function geocode(address) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json'
    + `?address=${encodeURIComponent(normalizeAddressText(address))}&language=zh-TW&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(`地址解析失敗（"${address}"）：${data.status}${data.error_message ? ' - ' + data.error_message : ''}`);
  }
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

// origin 可能是 Shortcuts 的「目前位置」（"lat,lng"）或口述/打字的地址文字，
// 是座標就直接用，是地址文字才打 Geocoding API（對應網頁版 googleMaps.js 的 resolveLocationText）
export async function resolveLocation(text) {
  const trimmed = text.trim();
  if (isLatLngText(trimmed)) return parseLatLngText(trimmed);
  return geocode(trimmed);
}

export async function fetchDirections(origin, destination) {
  const url = 'https://maps.googleapis.com/maps/api/directions/json'
    + `?origin=${encodeURIComponent(normalizeAddressText(origin))}`
    + `&destination=${encodeURIComponent(normalizeAddressText(destination))}`
    + `&mode=driving&language=zh-TW&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.routes?.length) {
    throw new Error(`路線規劃失敗：${data.status}${data.error_message ? ' - ' + data.error_message : ''}`);
  }
  return data.routes[0];
}

// 把每個 leg 每個 step 的 polyline 解碼串成完整、有方向性的路徑
// （對應網頁版 routeMath.js 的 buildDetailedRoutePath，只是輸入是
// Directions REST API 的 JSON 而不是 JS SDK 的 DirectionsResult）
export function buildDetailedRoutePathFromRoute(route) {
  const points = [];
  (route.legs || []).forEach(leg => {
    (leg.steps || []).forEach(step => {
      const stepPoints = decodePolyline(step.polyline.points);
      stepPoints.forEach(pt => {
        const last = points[points.length - 1];
        if (!last || last.lat !== pt.lat || last.lng !== pt.lng) points.push(pt);
      });
    });
  });
  return points.length >= 2 ? points : decodePolyline(route.overview_polyline.points);
}

export function summarizeRoute(route) {
  let distanceMeters = 0;
  let durationSeconds = 0;
  (route.legs || []).forEach(leg => {
    distanceMeters += leg.distance?.value || 0;
    durationSeconds += leg.duration?.value || 0;
  });
  const km = (distanceMeters / 1000).toFixed(1);
  const mins = Math.round(durationSeconds / 60);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  const durationText = hours > 0 ? `${hours} 小時 ${remMins} 分` : `${mins} 分`;
  return { distanceText: `${km} 公里`, durationText, distanceMeters, durationSeconds };
}
