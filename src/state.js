// 地圖生命週期相關的共用可變狀態：由 googleMaps.js 建立/清除，
// results.js 在渲染搜尋結果時也會讀寫 marker 相關欄位
export const mapState = {
  map: null,
  directionsService: null,
  directionsRenderer: null,
  placeMarkers: [],
  placeMarkerCluster: null,
  placeCards: []
};

// 搜尋/路線相關的共用可變狀態：由 search.js 的 runSearch/searchAlongRoute 寫入，
// results.js、discover.js、googleMaps.js 讀取
export const searchState = {
  allRoutes: [],
  selectedRouteIndex: 0,
  lastResults: [],
  lastOrigin: '',
  lastDestination: '',
  lastOriginLocation: null // 沒填目的地時，搜尋中心點（起點的經緯度）
};
