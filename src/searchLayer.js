import { mapState, searchState } from './state.js';
import { finishRouteReveal, discardPendingRouteReveal } from './routeAnimation.js';
import { stopFlyover } from './flyover.js';
import { closeActiveInfoWindow, setMarkerMap } from './googleMaps.js';

// 美食搜尋結果在地圖上的那一層（店家標記，選填連路線跟「踩新點」的 🎯）。
// 集章地圖、採買地圖打開時先收起來，避免兩種標記混在一起；關掉時再放回去，
// 視角也回到原本的路線／起點。

export function hideSearchLayer({ includeRoute = false } = {}) {
  mapState.searchLayerHidden = true;
  stopFlyover();
  // 沿路動畫還在跑或等著手機切到地圖頁籤才播的，都先收掉，不然切到地圖時會把搜尋標記又放出來
  finishRouteReveal();
  discardPendingRouteReveal();
  closeActiveInfoWindow();
  if (mapState.placeMarkerCluster) mapState.placeMarkerCluster.clearMarkers();
  // 集章地圖只收標記、路線留著；採買地圖整層都收
  if (includeRoute) {
    mapState.searchRouteHidden = true;
    mapState.directionsRenderer?.setMap(null);
    if (mapState.discoverMarker) setMarkerMap(mapState.discoverMarker, null);
  }
}

// refit 為 false 時只把東西放回去、不動視角（呼叫端接下來要自己決定看哪裡，例如馬上要渲染新的搜尋結果）
export function restoreSearchLayer({ refit = true } = {}) {
  mapState.searchLayerHidden = false;
  if (!mapState.map) return;
  if (mapState.placeMarkerCluster && mapState.placeMarkers.length) {
    mapState.placeMarkerCluster.addMarkers(mapState.placeMarkers);
  }
  if (mapState.searchRouteHidden) {
    mapState.searchRouteHidden = false;
    if (searchState.allRoutes.length) mapState.directionsRenderer?.setMap(mapState.map);
    if (mapState.discoverMarker) setMarkerMap(mapState.discoverMarker, mapState.map);
  }
  if (!refit) return;
  const route = searchState.allRoutes[searchState.selectedRouteIndex];
  if (route) {
    mapState.map.fitBounds(route.bounds);
  } else if (searchState.lastOriginLocation) {
    mapState.map.setCenter(searchState.lastOriginLocation);
    mapState.map.setZoom(15);
  }
}
