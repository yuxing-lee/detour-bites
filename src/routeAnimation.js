import { GOOGLE_MAP_ID, ROUTE_REVEAL_DURATION_MS } from './config.js';
import { mapState } from './state.js';
import { buildDetailedRoutePath } from './routeMath.js';

// 「沿路開過去」動畫：順路搜尋完成後，一台小車從起點沿路線開到終點，
// 車子經過哪間店（店的 _routeProgress ≤ 車子目前開過的距離），那間店的標記才冒出來。
// 只在有 Map ID（Advanced Markers，標記是可以直接加 class 的 HTML）時播放；
// 舊版 Marker 維持原本一次全部顯示。
//
// 動畫期間先把標記從 clusterer 拿出來直接掛在地圖上，不然路線全覽的縮放層級下
// 大部分店家會被收成群集圓點，看不到一顆顆冒出來的效果；播完再交還給 clusterer。

let active = null;
// 手機版預設停在「清單」頁籤，地圖是 display:none，這時候播動畫使用者看不到，
// 先記下來，等切到地圖頁籤再播
let pending = null;

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function isMapVisible() {
  const el = document.getElementById('map');
  return !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
}

// 順路搜尋完成、清單渲染完之後由 search.js 呼叫
export function playRouteReveal(route) {
  const places = mapState.placeData;
  cancelRouteReveal();
  if (!GOOGLE_MAP_ID || !route || !places.length || prefersReducedMotion()) return;
  if (!isMapVisible()) {
    pending = { route, places, markers: mapState.placeMarkers };
    return;
  }
  start(route, places);
}

export function discardPendingRouteReveal() {
  pending = null;
}

// 切到手機版地圖頁籤時呼叫；只有標記還是同一批（中間沒有重新搜尋/篩選）才補播
export function resumePendingRouteReveal() {
  if (!pending) return;
  const { route, places, markers } = pending;
  pending = null;
  if (markers !== mapState.placeMarkers || prefersReducedMotion()) return;
  // 容器剛從 display:none 切回來，等地圖套用完新的尺寸/縮放再開始
  google.maps.event.addListenerOnce(mapState.map, 'idle', () => {
    if (markers === mapState.placeMarkers) start(route, places);
  });
}

function start(route, places) {
  const path = buildDetailedRoutePath(route);
  if (!path || path.length < 2) return;

  // 每個路徑點從起點累積的距離，之後用二分搜尋找車子目前落在哪一段
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative.push(cumulative[i - 1] + google.maps.geometry.spherical.computeDistanceBetween(path[i - 1], path[i]));
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= 0) return;

  const markers = mapState.placeMarkers.slice();
  const cluster = mapState.placeMarkerCluster;
  if (cluster) cluster.clearMarkers();
  markers.forEach(m => {
    m.content.classList.remove('map-pin-enter');
    m.content.classList.add('map-pin-waiting');
    m.map = mapState.map;
  });

  const car = document.createElement('div');
  car.className = 'route-car';
  car.textContent = '🚗';
  const carMarker = new google.maps.marker.AdvancedMarkerElement({
    map: mapState.map,
    position: path[0],
    content: car,
    zIndex: 1000
  });

  // 依沿路進度排好，每一幀只要從上次的位置往後檢查
  const queue = places
    .map((p, i) => ({ progress: p._routeProgress ?? 0, marker: markers[i] }))
    .filter(item => item.marker)
    .sort((a, b) => a.progress - b.progress);

  active = {
    markers,
    cluster,
    queue,
    nextIndex: 0,
    carMarker,
    rafId: 0,
    dragListener: null
  };
  // 使用者自己拖地圖就代表想看別的地方了，直接收尾，不要一邊拖一邊還有東西在動
  active.dragListener = mapState.map.addListener('dragstart', () => finishRouteReveal());

  const startTime = performance.now();
  let segIndex = 1;
  const tick = (now) => {
    if (!active) return;
    const t = Math.min(1, (now - startTime) / ROUTE_REVEAL_DURATION_MS);
    // ease-in-out：起步、到站都慢一點，看起來比較像開車
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const traveled = eased * total;

    while (segIndex < cumulative.length - 1 && cumulative[segIndex] < traveled) segIndex++;
    const A = path[segIndex - 1];
    const B = path[segIndex];
    const segLen = cumulative[segIndex] - cumulative[segIndex - 1];
    const frac = segLen > 0 ? Math.min(1, Math.max(0, (traveled - cumulative[segIndex - 1]) / segLen)) : 1;
    active.carMarker.position = google.maps.geometry.spherical.interpolate(A, B, frac);
    // 🚗 預設車頭朝左，往東開（heading 0~180）時水平翻轉，讓車頭大致朝行進方向
    const heading = google.maps.geometry.spherical.computeHeading(A, B);
    car.classList.toggle('route-car-east', heading > 0 && heading < 180);

    while (active.nextIndex < active.queue.length && active.queue[active.nextIndex].progress <= traveled) {
      revealMarker(active.queue[active.nextIndex].marker);
      active.nextIndex++;
    }

    if (t < 1) {
      active.rafId = requestAnimationFrame(tick);
    } else {
      finishRouteReveal();
    }
  };
  active.rafId = requestAnimationFrame(tick);
}

function revealMarker(marker) {
  const pin = marker.content;
  pin.classList.remove('map-pin-waiting');
  pin.style.animationDelay = '0ms';
  pin.classList.add('map-pin-enter');
  pin.addEventListener('animationend', () => pin.classList.remove('map-pin-enter'), { once: true });
}

function teardown() {
  cancelAnimationFrame(active.rafId);
  if (active.dragListener) active.dragListener.remove();
  const car = active.carMarker;
  car.content.classList.add('route-car-leave');
  setTimeout(() => { car.map = null; }, 400);
}

// 動畫跑完、使用者拖地圖、或點了某間店要開 InfoWindow 時呼叫：
// 還沒冒出來的店一次全部顯示，標記交還給 clusterer
export function finishRouteReveal() {
  if (!active) return;
  const { queue, nextIndex, markers, cluster } = active;
  teardown();
  active = null;
  queue.slice(nextIndex).forEach(item => revealMarker(item.marker));
  // 中間已經重新搜尋/篩選過的話，這批標記已經被清掉，不要再塞回 clusterer
  if (cluster && cluster === mapState.placeMarkerCluster) cluster.addMarkers(markers);
}

// 標記要被整批清掉（重新搜尋、改篩選條件）時呼叫：只停掉動畫、收掉車子，
// 標記本身交給呼叫端處理
export function cancelRouteReveal() {
  pending = null;
  if (!active) return;
  teardown();
  active = null;
}
