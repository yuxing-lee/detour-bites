import { FLYOVER_TILT, FLYOVER_MIN_MS, FLYOVER_MAX_MS, FLYOVER_MS_PER_KM } from './config.js';
import { flyoverBtn, flyoverCaptionEl } from './dom.js';
import { mapState, searchState } from './state.js';
import { buildDetailedRoutePath, createPathWalker } from './routeMath.js';
import { setPlaceHighlighted, useAdvancedMarkers, closeActiveInfoWindow } from './googleMaps.js';
import { finishRouteReveal } from './routeAnimation.js';

// 「路線飛覽」：鏡頭壓低傾斜、跟著路線方向旋轉，像導航畫面一樣從起點飛到終點，
// 經過沿路的店家時，地圖標記跟清單卡片會一起亮起來、上方字幕顯示店名。
// 需要向量地圖（Map ID 的地圖類型選「向量」並開啟傾斜/旋轉）才能傾斜跟旋轉，
// 點陣地圖或沒有 Map ID 時不顯示按鈕。

let active = null;

function isVectorMap() {
  return !!mapState.map
    && useAdvancedMarkers
    && typeof mapState.map.getRenderingType === 'function'
    && mapState.map.getRenderingType() === google.maps.RenderingType?.VECTOR;
}

function currentRoute() {
  return searchState.allRoutes[searchState.selectedRouteIndex] || null;
}

// 有路線、是向量地圖、而且沒開著集章地圖時才顯示按鈕；
// 搜尋結果渲染完、集章地圖開關、地圖的渲染類型確定後都會呼叫
export function refreshFlyoverButton() {
  const show = !!currentRoute() && isVectorMap() && !mapState.refitStampView;
  flyoverBtn.hidden = !show;
  if (!show) stopFlyover();
}

// 地圖剛建立時渲染類型還是 UNINITIALIZED，確定是向量或點陣之後才知道能不能飛覽
let watchingRenderingType = false;
export function watchRenderingTypeForFlyover() {
  if (watchingRenderingType || !mapState.map) return;
  watchingRenderingType = true;
  mapState.map.addListener('renderingtype_changed', refreshFlyoverButton);
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 角度內插要走最短的那一邊（例如 350° → 10° 是轉 20°，不是反轉 340°）
function angleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

// 路線越長飛得越高、越久：縮放層級越小畫面涵蓋越廣，長路線才不會一秒鐘掃過好幾個畫面
function flyoverZoomFor(totalMeters) {
  const km = totalMeters / 1000;
  if (km < 8) return 16;
  if (km < 30) return 15;
  if (km < 80) return 14;
  return 13;
}

function showCaption(text) {
  flyoverCaptionEl.textContent = text;
  flyoverCaptionEl.hidden = false;
  // 重新觸發淡入動畫
  flyoverCaptionEl.classList.remove('flyover-caption-pop');
  void flyoverCaptionEl.offsetWidth;
  flyoverCaptionEl.classList.add('flyover-caption-pop');
}

export function startFlyover() {
  const route = currentRoute();
  if (!route || !isVectorMap()) return;
  stopFlyover();
  finishRouteReveal();
  closeActiveInfoWindow();

  const path = buildDetailedRoutePath(route);
  if (!path || path.length < 2) return;
  const walker = createPathWalker(path);
  if (walker.total <= 0) return;

  const map = mapState.map;
  const zoom = flyoverZoomFor(walker.total);
  const travelMs = Math.min(FLYOVER_MAX_MS, Math.max(FLYOVER_MIN_MS, (walker.total / 1000) * FLYOVER_MS_PER_KM));
  const introMs = 1500;
  // 鏡頭看向前方一小段路的方向，而不是當下這一小段的方向，轉彎才會提早、平順地轉過去
  const lookAhead = 150 * Math.pow(2, 16 - zoom);

  // 飛覽時縮放層級可能落在 clusterer 會合併的範圍，先把標記直接掛在地圖上，結束再交還
  const markers = mapState.placeMarkers.slice();
  const cluster = mapState.placeMarkerCluster;
  if (cluster) cluster.clearMarkers();
  markers.forEach(m => { m.map = map; });

  const puck = document.createElement('div');
  puck.className = 'flyover-puck';
  const puckMarker = new google.maps.marker.AdvancedMarkerElement({ map, position: path[0], content: puck, zIndex: 1000 });

  const queue = mapState.placeData
    .map((p, i) => ({ progress: p._routeProgress ?? 0, index: i, name: p.displayName?.text || '' }))
    .sort((a, b) => a.progress - b.progress);

  const from = {
    center: map.getCenter(),
    zoom: map.getZoom(),
    tilt: map.getTilt() || 0,
    heading: map.getHeading() || 0
  };
  const startHeading = walker.at(lookAhead).heading;

  active = {
    rafId: 0,
    markers,
    cluster,
    puckMarker,
    highlightTimers: [],
    dragListener: map.addListener('dragstart', () => stopFlyover())
  };
  flyoverBtn.textContent = '⏹ 停止飛覽';
  flyoverBtn.classList.add('is-flying');
  showCaption('🎬 出發！');

  let heading = startHeading;
  let nextIndex = 0;
  let lastNow = performance.now();
  const startTime = lastNow;

  const tick = (now) => {
    if (!active) return;
    const dt = now - lastNow;
    lastNow = now;
    const elapsed = now - startTime;

    // 第一段：從目前的全覽視角降落到起點、慢慢壓低傾斜
    if (elapsed < introMs) {
      const t = easeInOut(elapsed / introMs);
      const start = path[0];
      map.moveCamera({
        center: { lat: lerp(from.center.lat(), start.lat(), t), lng: lerp(from.center.lng(), start.lng(), t) },
        zoom: lerp(from.zoom, zoom, t),
        tilt: lerp(from.tilt, FLYOVER_TILT, t),
        heading: from.heading + angleDelta(from.heading, startHeading) * t
      });
      active.rafId = requestAnimationFrame(tick);
      return;
    }

    // 第二段：沿路線飛行，起步跟到站慢一點
    const t = Math.min(1, (elapsed - introMs) / travelMs);
    const traveled = easeInOut(t) * walker.total;
    const { position } = walker.at(traveled);
    const targetHeading = walker.at(Math.min(walker.total, traveled + lookAhead)).heading;
    // 跟 dt 綁在一起的平滑係數：不同更新率的螢幕轉向速度一樣
    const smoothing = 1 - Math.exp(-dt / 350);
    heading = (heading + angleDelta(heading, targetHeading) * smoothing + 360) % 360;

    map.moveCamera({ center: position, zoom, tilt: FLYOVER_TILT, heading });
    active.puckMarker.position = position;

    while (nextIndex < queue.length && queue[nextIndex].progress <= traveled) {
      const item = queue[nextIndex];
      setPlaceHighlighted(item.index, true);
      // 桌機版清單跟地圖並排，順便把清單捲到這間店；手機版清單隱藏時這行不會有作用
      mapState.placeCards[item.index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      active.highlightTimers.push(setTimeout(() => setPlaceHighlighted(item.index, false), 1600));
      showCaption(`📍 經過 ${item.index + 1}. ${item.name}`);
      nextIndex++;
    }

    if (t < 1) {
      active.rafId = requestAnimationFrame(tick);
    } else {
      showCaption('🏁 抵達終點');
      stopFlyover();
    }
  };
  active.rafId = requestAnimationFrame(tick);
}

// 結束飛覽（跑完、使用者按停止、拖曳地圖、重新搜尋）：鏡頭拉回正上方、回到整條路線的全覽
export function stopFlyover() {
  if (!active) return;
  const { rafId, markers, cluster, puckMarker, highlightTimers, dragListener } = active;
  active = null;
  cancelAnimationFrame(rafId);
  dragListener?.remove();
  highlightTimers.forEach(clearTimeout);
  mapState.placeData.forEach((_, i) => setPlaceHighlighted(i, false));
  puckMarker.map = null;
  flyoverBtn.textContent = '🎬 飛覽路線';
  flyoverBtn.classList.remove('is-flying');
  setTimeout(() => { if (!active) flyoverCaptionEl.hidden = true; }, 1800);

  // 標記已經被重新搜尋換掉的話，這批舊的不用交還
  if (cluster && cluster === mapState.placeMarkerCluster) cluster.addMarkers(markers);
  const route = currentRoute();
  if (mapState.map) {
    mapState.map.moveCamera({ tilt: 0, heading: 0 });
    if (route) mapState.map.fitBounds(route.bounds);
  }
}

flyoverBtn.addEventListener('click', () => {
  if (active) stopFlyover();
  else startFlyover();
});
