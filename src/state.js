// 地圖生命週期相關的共用可變狀態：由 googleMaps.js 建立/清除，
// results.js 在渲染搜尋結果時也會讀寫 marker 相關欄位
export const mapState = {
  map: null,
  directionsService: null,
  directionsRenderer: null,
  placeMarkers: [],
  placeMarkerCluster: null,
  placeCards: [],
  placeData: [], // 目前清單/地圖上顯示的店家，跟 placeMarkers、placeCards 同順序
  // 「踩新點」推薦的那顆 🎯 標記（discover.js 建立）
  discoverMarker: null,
  // 集章地圖或採買地圖開著時設定：手機版切回地圖頁籤時改用它重新對焦，而不是對焦搜尋路線
  refitOverlayView: null,
  // 美食搜尋的標記暫時收起來（集章地圖、採買地圖開著）時為 true，見 searchLayer.js；
  // 這段期間剛好有搜尋跑完的話，結果只更新清單，不要把標記放回地圖上
  searchLayerHidden: false,
  // 採買地圖開著時為 true：連路線跟鏡頭都交給採買地圖，搜尋途中切過去的話不要畫路線、不要移動鏡頭。
  // 集章地圖不算（在集章地圖上按搜尋，本來就會畫出新路線、跳到搜尋結果）
  searchRouteHidden: false
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
