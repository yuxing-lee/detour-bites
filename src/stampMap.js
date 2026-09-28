import { GOOGLE_MAPS_API_KEY, PLACES_CONCURRENCY, EATEN_GOOD_RATING_THRESHOLD } from './config.js';
import { openStampMapBtn, stampMapBarEl, stampMapSummaryEl, closeStampMapBtn } from './dom.js';
import { mapState, searchState } from './state.js';
import { escapeHtml, mapWithConcurrency } from './utils.js';
import { getEatenEntries, setEatenLocation, closeEatenModal } from './eatenList.js';
import { fetchPlaceLocation } from './placesApi.js';
import {
  loadGoogleMapsSDK,
  initMapIfNeeded,
  setMobileView,
  createPlaceMarker,
  onMarkerClick,
  removeMarker,
  openSimpleInfoWindow,
  closeActiveInfoWindow
} from './googleMaps.js';
import { finishRouteReveal, discardPendingRouteReveal } from './routeAnimation.js';
import { setStatus } from './ui.js';
import { stopFlyover, refreshFlyoverButton } from './flyover.js';

// 「集章地圖」：把所有標記過吃過的店，用印章的樣子一次攤在地圖上，
// 讓吃過清單變成一本可以慢慢集滿的美食圖鑑。
// 開啟期間暫時把搜尋結果的標記收起來（避免兩種標記混在一起），結束時再放回去、
// 視角也回到原本的路線／起點。

let stampMarkers = [];
let isOpen = false;
let opening = false;

function stampInfoHtml(entry) {
  const stars = entry.rating ? `${'★'.repeat(entry.rating)}${'☆'.repeat(5 - entry.rating)}` : '尚未評分';
  const dateText = entry.eatenAt ? new Date(entry.eatenAt).toLocaleDateString('zh-TW') + ' 蓋章' : '';
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(entry.name || '')}&query_place_id=${encodeURIComponent(entry.id)}`;
  return `<div style="color:#1b2140;font-size:13px;line-height:1.6;max-width:220px;">`
    + `<div style="font-weight:700;font-size:14px;margin-bottom:2px;">${escapeHtml(entry.name || '(未命名)')}</div>`
    + `<div style="color:#b8841a;">${stars}</div>`
    + (dateText ? `<div style="color:#5a6180;">${escapeHtml(dateText)}</div>` : '')
    + `<div style="margin-top:4px;"><a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" style="color:#8a5a1f;font-weight:700;text-decoration:underline;">在 Google Maps 開啟 →</a></div>`
    + `</div>`;
}

// 舊資料沒有座標的店，用 Place Details 補；補到的存回吃過清單，下次打開就不用再查
async function backfillLocations(entries) {
  const missing = entries.filter(e => !Number.isFinite(e.lat) || !Number.isFinite(e.lng));
  if (!missing.length) return;
  setStatus(`集章地圖：補查 ${missing.length} 間店的位置中…`);
  const locations = await mapWithConcurrency(missing, PLACES_CONCURRENCY, e => fetchPlaceLocation(e.id));
  let found = 0;
  missing.forEach((e, i) => {
    if (!locations[i]) return;
    e.lat = locations[i].lat;
    e.lng = locations[i].lng;
    setEatenLocation(e.id, locations[i]);
    found++;
  });
  setStatus(`集章地圖：補上 ${found}/${missing.length} 間店的位置`, found ? 'ok' : 'error');
}

function hideSearchLayer() {
  stopFlyover();
  // 沿路動畫還在跑或等著手機切到地圖頁籤才播的，都先收掉，不然切到地圖時會把搜尋標記又放出來
  finishRouteReveal();
  discardPendingRouteReveal();
  closeActiveInfoWindow();
  if (mapState.placeMarkerCluster) mapState.placeMarkerCluster.clearMarkers();
}

function restoreSearchLayer() {
  if (mapState.placeMarkerCluster && mapState.placeMarkers.length) {
    mapState.placeMarkerCluster.addMarkers(mapState.placeMarkers);
  }
  const route = searchState.allRoutes[searchState.selectedRouteIndex];
  if (route) {
    mapState.map.fitBounds(route.bounds);
  } else if (searchState.lastOriginLocation) {
    mapState.map.setCenter(searchState.lastOriginLocation);
    mapState.map.setZoom(15);
  }
}

export async function openStampMap() {
  if (opening) return;
  closeEatenModal();
  if (!GOOGLE_MAPS_API_KEY) {
    setStatus('尚未設定 Google Maps API Key，無法顯示集章地圖', 'error');
    return;
  }
  opening = true;
  try {
    await loadGoogleMapsSDK();
    initMapIfNeeded();
    if (isOpen) clearStamps();

    const entries = getEatenEntries();
    await backfillLocations(entries);

    hideSearchLayer();
    isOpen = true;
    stampMapBarEl.hidden = false;
    setMobileView('map');
    // 先放一個空的對焦函式代表「集章地圖開著」，飛覽按鈕看到它就會隱藏；有印章時下面再換成真的
    mapState.refitStampView = () => {};
    refreshFlyoverButton();

    const located = entries
      .filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lng))
      // 依第一次蓋章的時間依序蓋下去；舊資料沒有時間的排最前面
      .sort((a, b) => (a.eatenAt || 0) - (b.eatenAt || 0));
    const goldCount = entries.filter(e => e.rating >= EATEN_GOOD_RATING_THRESHOLD).length;
    const missingCount = entries.length - located.length;

    if (!entries.length) {
      stampMapSummaryEl.textContent = '還沒集到任何章：在餐廳卡片上點星星標記吃過，就會在這裡蓋章';
      return;
    }
    stampMapSummaryEl.textContent = `🗺️ 已集 ${entries.length} 章・🏅 ${goldCount} 間 ${EATEN_GOOD_RATING_THRESHOLD}★ 以上`
      + (missingCount ? `・${missingCount} 間找不到位置` : '');

    const bounds = new google.maps.LatLngBounds();
    stampMarkers = located.map((entry, i) => {
      const position = { lat: entry.lat, lng: entry.lng };
      bounds.extend(position);
      const marker = createPlaceMarker({
        position,
        title: entry.name,
        index: i,
        rating: entry.rating,
        variant: 'stamp',
        map: mapState.map
      });
      onMarkerClick(marker, () => openSimpleInfoWindow(stampInfoHtml(entry), marker));
      return marker;
    });

    mapState.refitStampView = () => {
      if (located.length === 1) {
        mapState.map.setCenter(bounds.getCenter());
        mapState.map.setZoom(15);
      } else if (located.length > 1) {
        mapState.map.fitBounds(bounds, 60);
      }
    };
    mapState.refitStampView();
  } catch (err) {
    console.error(err);
    setStatus(err.message || '集章地圖載入失敗', 'error');
  } finally {
    opening = false;
  }
}

function clearStamps() {
  stampMarkers.forEach(removeMarker);
  stampMarkers = [];
}

// 結束集章地圖；新的搜尋結果要渲染前也會呼叫，確保兩種標記不會同時出現
export function exitStampMap({ restoreView = true } = {}) {
  if (!isOpen) return;
  isOpen = false;
  mapState.refitStampView = null;
  clearStamps();
  closeActiveInfoWindow();
  stampMapBarEl.hidden = true;
  if (restoreView) restoreSearchLayer();
  refreshFlyoverButton();
}

openStampMapBtn.addEventListener('click', openStampMap);
closeStampMapBtn.addEventListener('click', () => exitStampMap());
