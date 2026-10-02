import { GOOGLE_MAPS_API_KEY, GEMINI_API_KEY, GOOGLE_MAP_ID } from './config.js';
import {
  mapHintEl,
  appEl,
  mobileViewTabsEl,
  originInput,
  destinationInput,
  originSuggestionsEl,
  destinationSuggestionsEl
} from './dom.js';
import { mapState, searchState } from './state.js';
import { escapeHtml, debounce, priceText, websiteLinkHtml, buildNavUrl, formatRouteDistance } from './utils.js';
import { cancelRouteReveal, finishRouteReveal, resumePendingRouteReveal } from './routeAnimation.js';
import { currentMealTheme } from './mealTheme.js';

// Advanced Markers 一定要搭配 Map ID 才能用；沒設定 Map ID 時整套退回舊版 Marker，
// 讓 secret 還沒設好的環境也能正常運作
export const useAdvancedMarkers = !!GOOGLE_MAP_ID;

let sdkLoaded = false;
let sdkLoadPromise = null;

export function loadGoogleMapsSDK() {
  // 快取「載入中」的 Promise，讓打字觸發的自動完成跟按下搜尋兩邊同時呼叫時
  // 不會因為腳本還沒載完、sdkLoaded 還是 false，就各自插入重複的 <script>
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise((resolve, reject) => {
    window.__gmapsInit = () => {
      sdkLoaded = true;
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=geometry,places,marker&callback=__gmapsInit`;
    script.onerror = () => {
      sdkLoadPromise = null;
      reject(new Error('Google Maps SDK 載入失敗，請確認 API key 是否正確、且已啟用 Maps JavaScript API / Directions API'));
    };
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

// 用 AutocompleteSuggestion（新版 Places API，取代已對新客戶停用的 google.maps.places.Autocomplete）
// 自己畫下拉選單，這樣才能套用暗色主題、也不影響「目前位置」直接寫入座標字串的既有邏輯
function setupAutocomplete(inputEl, listEl) {
  let sessionToken = null;
  let currentSuggestions = [];
  let activeIndex = -1;

  function hideList() {
    listEl.hidden = true;
    listEl.innerHTML = '';
    currentSuggestions = [];
    activeIndex = -1;
  }

  function updateActive() {
    Array.from(listEl.children).forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
    });
  }

  function selectSuggestion(prediction) {
    inputEl.value = prediction.text?.text || '';
    hideList();
    sessionToken = null; // 選完這次搜尋就結束，下次輸入會開新的 session
  }

  function renderList(suggestions) {
    currentSuggestions = suggestions;
    activeIndex = -1;
    listEl.innerHTML = '';

    if (!suggestions.length) {
      hideList();
      return;
    }

    suggestions.forEach((s) => {
      const prediction = s.placePrediction;
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      const main = prediction.mainText?.text || prediction.text?.text || '';
      const secondary = prediction.secondaryText?.text || '';
      item.innerHTML = `
        <div class="main">${escapeHtml(main)}</div>
        ${secondary ? `<div class="secondary">${escapeHtml(secondary)}</div>` : ''}
      `;
      // 用 mousedown 而不是 click，才能搶在 input 的 blur 事件把清單關掉之前完成選取
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectSuggestion(prediction);
      });
      listEl.appendChild(item);
    });

    listEl.hidden = false;
  }

  const fetchSuggestions = debounce(async (value) => {
    if (!value) {
      hideList();
      return;
    }
    try {
      await loadGoogleMapsSDK();
      if (!sessionToken) sessionToken = new google.maps.places.AutocompleteSessionToken();
      const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: value,
        language: 'zh-TW',
        sessionToken
      });
      renderList(suggestions || []);
    } catch (err) {
      console.warn('地址建議載入失敗：', err);
      hideList();
    }
  }, 300);

  inputEl.addEventListener('input', () => {
    if (!GOOGLE_MAPS_API_KEY) return;
    fetchSuggestions(inputEl.value.trim());
  });

  inputEl.addEventListener('blur', () => {
    // 延遲一下，讓上面 mousedown 選取的邏輯先跑完，不然清單會在選取前就被關掉
    setTimeout(hideList, 150);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (listEl.hidden || !currentSuggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentSuggestions.length - 1);
      updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive();
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault();
        selectSuggestion(currentSuggestions[activeIndex].placePrediction);
      }
    } else if (e.key === 'Escape') {
      hideList();
    }
  });
}

setupAutocomplete(originInput, originSuggestionsEl);
setupAutocomplete(destinationInput, destinationSuggestionsEl);

export function initMapIfNeeded() {
  if (mapState.map) return;
  const baseOptions = {
    center: { lat: 25.0478, lng: 121.5171 },
    zoom: 8,
    disableDefaultUI: false
  };
  // 設了 mapId 之後 Google 會忽略 styles，配色改由 Cloud Console 的地圖樣式決定；
  // 還沒在後台設定樣式時，先用內建深色主題，至少不會跟全站深色 UI 衝突
  mapState.map = new google.maps.Map(document.getElementById('map'), useAdvancedMarkers ? {
    ...baseOptions,
    mapId: GOOGLE_MAP_ID,
    colorScheme: google.maps.ColorScheme?.DARK ?? 'DARK'
  } : {
    ...baseOptions,
    styles: [
      { elementType: 'geometry', stylers: [{ color: '#1b2140' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#9aa3c7' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#12172b' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a3355' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1428' }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] }
    ]
  });
  mapState.directionsService = new google.maps.DirectionsService();
  mapState.directionsRenderer = new google.maps.DirectionsRenderer({
    map: mapState.map,
    suppressMarkers: false,
    polylineOptions: { strokeColor: currentMealTheme().amber, strokeWeight: 5 }
  });
  mapHintEl.style.display = 'none';
}

// 手機版「清單／地圖」頁籤：桌機版兩欄並排看不到這排按鈕，切換邏輯不會影響桌機
let mobileView = 'list';

export function setMobileView(view) {
  mobileView = view;
  appEl.classList.toggle('mobile-view-map', view === 'map');
  mobileViewTabsEl.querySelectorAll('.mobile-view-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view !== 'map' || !mapState.map) return;
  // 地圖容器切換前是 display:none（寬高是 0），搜尋時算出來的置中/縮放都是在那個狀態下算的，
  // 所以切回地圖頁籤時不能只靠 resize，要用已知的路線邊界／起點座標重新套用一次，
  // 不然畫面可能整片灰掉，或停在容器還是 0 大小時算出來的錯誤縮放層級
  google.maps.event.trigger(mapState.map, 'resize');
  if (mapState.refitOverlayView) {
    mapState.refitOverlayView();
    return;
  }
  if (searchState.allRoutes.length && searchState.allRoutes[searchState.selectedRouteIndex]) {
    mapState.map.fitBounds(searchState.allRoutes[searchState.selectedRouteIndex].bounds);
  } else if (searchState.lastOriginLocation) {
    mapState.map.setCenter(searchState.lastOriginLocation);
    mapState.map.setZoom(15);
  }
  resumePendingRouteReveal();
}

mobileViewTabsEl.querySelectorAll('.mobile-view-tab').forEach(btn => {
  btn.addEventListener('click', () => setMobileView(btn.dataset.view));
});

// 把「起點」文字轉成經緯度：目前位置按鈕填入的是 "lat,lng" 字串可以直接解析，
// 其他地址文字則交給 Geocoder 轉換
export async function resolveLocationText(text) {
  const coordMatch = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    return new google.maps.LatLng(parseFloat(coordMatch[1]), parseFloat(coordMatch[2]));
  }
  const geocoder = new google.maps.Geocoder();
  const { results } = await geocoder.geocode({ address: text, language: 'zh-TW' });
  if (!results.length) throw new Error('找不到這個地點：' + text);
  return results[0].geometry.location;
}

let activeInfoWindow = null;

export function clearPlaceMarkers() {
  cancelRouteReveal();
  if (mapState.placeMarkerCluster) {
    mapState.placeMarkerCluster.clearMarkers();
    mapState.placeMarkerCluster = null;
  }
  mapState.placeMarkers.forEach(removeMarker);
  mapState.placeMarkers = [];
  mapState.placeCards = [];
  mapState.placeData = [];
  if (activeInfoWindow) {
    activeInfoWindow.close();
    activeInfoWindow = null;
  }
}

// 清單編號跟地圖標記共用同一套外觀邏輯：預設是帶數字的橘色小圓點，
// 滑鼠移到清單卡片或地圖標記其中一邊時，兩邊會一起放大變色，讓使用者看得出兩者對應同一間店
function markerIcon(highlighted) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: highlighted ? 13 : 9,
    fillColor: highlighted ? currentMealTheme().amberHi : currentMealTheme().amber,
    fillOpacity: 1,
    strokeColor: '#12172b',
    strokeWeight: highlighted ? 2.5 : 1.5
  };
}

function markerLabel(index) {
  return { text: String(index + 1), color: '#12172b', fontSize: '11px', fontWeight: '700' };
}

// 新舊兩種 marker 的差異都收在下面這幾個函式裡，results.js / discover.js 不用管目前用哪一種。
// variant: 'place'（搜尋結果，帶編號）、'discover'（踩新點推薦，綠色）或 'stamp'（集章地圖的印章）
// emoji / eaten 只有 Advanced Marker 會用到：圓點中間放美食圖示，編號改成右上角的小角標，
// 吃過的店左下角多蓋一個「吃」字小印章；rating 是集章印章上顯示的星數
export function createPlaceMarker({ position, title, index, emoji, eaten = false, rating = 0, variant = 'place', map = null }) {
  if (variant === 'stamp') return createStampMarker({ position, title, index, rating, map });
  if (useAdvancedMarkers) {
    const pin = document.createElement('div');
    pin.className = `map-pin map-pin-${variant} map-pin-enter`;
    // 跟清單卡片一樣依序冒出來；動畫播完就拿掉 class，不然 clusterer 拆開/收合時
    // marker 重新掛回 DOM 會每次都重播一次（還帶著延遲）
    pin.style.animationDelay = `${Math.min(index ?? 0, 12) * 40}ms`;
    pin.addEventListener('animationend', () => pin.classList.remove('map-pin-enter'), { once: true });
    const emojiEl = document.createElement('span');
    emojiEl.className = 'map-pin-emoji';
    emojiEl.textContent = variant === 'discover' ? '🎯' : (emoji || '');
    pin.appendChild(emojiEl);
    if (variant === 'place') {
      const badge = document.createElement('span');
      badge.className = 'map-pin-index';
      badge.textContent = String(index + 1);
      pin.appendChild(badge);
      if (eaten) pin.appendChild(createEatenBadge());
    }
    return new google.maps.marker.AdvancedMarkerElement({
      position,
      map,
      title,
      content: pin,
      gmpClickable: true,
      zIndex: variant === 'discover' ? 999 : 10
    });
  }
  if (variant === 'discover') {
    return new google.maps.Marker({
      position,
      map,
      title,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: '#6fbf8b',
        fillOpacity: 1,
        strokeColor: '#12172b',
        strokeWeight: 2
      },
      zIndex: 999
    });
  }
  return new google.maps.Marker({
    position,
    map,
    title,
    icon: markerIcon(false),
    label: markerLabel(index),
    zIndex: 10
  });
}

function createEatenBadge() {
  const stamp = document.createElement('span');
  stamp.className = 'map-pin-stamp';
  stamp.textContent = '吃';
  return stamp;
}

// 在搜尋結果卡片上標記/取消「吃過」時，同步更新地圖上那顆標記的小印章（舊版 Marker 沒有這個裝飾）
export function setMarkerEaten(marker, isOn) {
  if (!useAdvancedMarkers || !marker) return;
  const existing = marker.content.querySelector('.map-pin-stamp');
  if (isOn && !existing) marker.content.appendChild(createEatenBadge());
  if (!isOn && existing) existing.remove();
}

// 集章地圖的印章：紅色（4★ 以上是金色）圓形章、中間一個斜斜的「吃」字，有評分的話下方掛星數。
// index 用來錯開蓋章動畫的時間
function createStampMarker({ position, title, index = 0, rating = 0, map }) {
  const gold = rating >= 4;
  if (useAdvancedMarkers) {
    const stamp = document.createElement('div');
    stamp.className = 'map-stamp map-stamp-enter' + (gold ? ' map-stamp-gold' : '');
    stamp.style.animationDelay = `${Math.min(index, 30) * 70}ms`;
    stamp.addEventListener('animationend', () => stamp.classList.remove('map-stamp-enter'), { once: true });
    stamp.innerHTML = `<span class="map-stamp-text">吃</span>${rating ? `<span class="map-stamp-rating">${rating}★</span>` : ''}`;
    return new google.maps.marker.AdvancedMarkerElement({ position, map, title, content: stamp, gmpClickable: true, zIndex: 20 });
  }
  return new google.maps.Marker({
    position,
    map,
    title,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 11,
      fillColor: '#f3f1ea',
      fillOpacity: 1,
      strokeColor: gold ? '#e0a526' : '#d9453b',
      strokeWeight: 3
    },
    label: { text: '吃', color: gold ? '#b8841a' : '#d9453b', fontSize: '12px', fontWeight: '700' },
    zIndex: 20
  });
}

// Advanced Marker 的點擊事件是 gmp-click；滑鼠移入移出則沒有 marker 層級的事件，
// 要掛在自訂的 content 元素上
export function onMarkerClick(marker, handler) {
  if (useAdvancedMarkers) marker.addEventListener('gmp-click', handler);
  else marker.addListener('click', handler);
}

export function onMarkerHover(marker, onEnter, onLeave) {
  if (useAdvancedMarkers) {
    marker.content.addEventListener('mouseenter', onEnter);
    marker.content.addEventListener('mouseleave', onLeave);
  } else {
    marker.addListener('mouseover', onEnter);
    marker.addListener('mouseout', onLeave);
  }
}

export function removeMarker(marker) {
  setMarkerMap(marker, null);
}

// 暫時收起／放回標記（不重建），例如採買地圖打開時把「踩新點」的 🎯 收起來
export function setMarkerMap(marker, map) {
  if (useAdvancedMarkers) marker.map = map;
  else marker.setMap(map);
}

// 採買地圖的店家標記：泡泡裡是店家類別的圖示（🏪🛒💊…），在建議路線上的店框線變成強調色、
// 右上角標第幾站；已打烊的店整顆變淡。舊版 Marker 只能放一個 label，所以只顯示圖示、用框線區分
function shopMarkerIcon(plan, highlighted) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: highlighted ? 15 : (plan ? 13 : 11),
    fillColor: '#f3f1ea',
    fillOpacity: 1,
    strokeColor: plan ? currentMealTheme().amber : '#9aa3c7',
    strokeWeight: plan ? 3 : 2
  };
}

export function createShopMarker({ position, title, emoji, step = 0, closed = false, index = 0, map = null }) {
  if (useAdvancedMarkers) {
    const pin = document.createElement('div');
    pin.className = 'map-pin map-pin-shop map-pin-enter' + (step ? ' map-pin-plan' : '') + (closed ? ' map-pin-closed' : '');
    pin.style.animationDelay = `${Math.min(index, 12) * 40}ms`;
    pin.addEventListener('animationend', () => pin.classList.remove('map-pin-enter'), { once: true });
    const emojiEl = document.createElement('span');
    emojiEl.className = 'map-pin-emoji';
    emojiEl.textContent = emoji;
    pin.appendChild(emojiEl);
    if (step) {
      const badge = document.createElement('span');
      badge.className = 'map-pin-index';
      badge.textContent = String(step);
      pin.appendChild(badge);
    }
    return new google.maps.marker.AdvancedMarkerElement({
      position,
      map,
      title,
      content: pin,
      gmpClickable: true,
      zIndex: step ? 50 : 10
    });
  }
  return new google.maps.Marker({
    position,
    map,
    title,
    icon: shopMarkerIcon(!!step, false),
    label: { text: emoji, fontSize: '14px' },
    opacity: closed ? 0.55 : 1,
    zIndex: step ? 50 : 10
  });
}

export function setShopMarkerHighlighted(marker, isOn, plan) {
  if (useAdvancedMarkers) {
    marker.content.classList.toggle('highlighted', isOn);
    marker.zIndex = isOn ? 100 : (plan ? 50 : 10);
  } else {
    marker.setIcon(shopMarkerIcon(plan, isOn));
  }
}

// 採買地圖上「你在這裡」的藍點
export function createUserLocationMarker(position, map) {
  if (useAdvancedMarkers) {
    const dot = document.createElement('div');
    dot.className = 'me-dot';
    return new google.maps.marker.AdvancedMarkerElement({ position, map, title: '你在這裡', content: dot, zIndex: 5 });
  }
  return new google.maps.Marker({
    position,
    map,
    title: '你在這裡',
    clickable: false,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 7,
      fillColor: '#4285f4',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 3
    },
    zIndex: 5
  });
}

function setMarkerHighlighted(marker, isOn) {
  if (useAdvancedMarkers) {
    marker.content.classList.toggle('highlighted', isOn);
    // 放大的那顆要浮到其他 marker 上面，不然會被旁邊的店蓋住
    marker.zIndex = isOn ? 100 : 10;
  } else {
    marker.setIcon(markerIcon(isOn));
  }
}

export function setPlaceHighlighted(index, isOn) {
  const marker = mapState.placeMarkers[index];
  const card = mapState.placeCards[index];
  if (marker) setMarkerHighlighted(marker, isOn);
  if (card) card.classList.toggle('highlighted', isOn);
}

// InfoWindow 的預設氣泡背景是白色，但這個頁面全站文字顏色／清單卡片上的評分橘色、
// 營業狀態綠/紅色都是特地調給深色底看的淺色，直接原封不動搬進白底彈出框對比會不夠，
// 所以這裡不重用卡片那份已經上色的 HTML，自己從資料重新組一份深色系的版本
function buildInfoWindowContent(p, pos) {
  const name = p.displayName?.text || '(未命名)';
  const address = p.formattedAddress || '';
  const ratingText = p.rating
    ? `★ ${p.rating.toFixed(1)}${p.userRatingCount ? ` (${p.userRatingCount})` : ''}`
    : '尚無評分';
  const price = priceText(p);
  const openNow = p.currentOpeningHours?.openNow;
  const openHtml = openNow === true
    ? '<span style="color:#1a7a4c;font-weight:700;">營業中</span>'
    : openNow === false
    ? '<span style="color:#b3261e;font-weight:700;">已打烊</span>'
    : '';
  const routeDistanceText = formatRouteDistance(p._routeDistance, searchState.lastDestination);
  const navUrl = buildNavUrl(pos, searchState.lastOrigin, searchState.lastDestination);
  const metaLine = [escapeHtml(ratingText), price, openHtml].filter(Boolean).join(' · ');
  // AI 解析按鈕沒有自己獨立跑一份摘要邏輯，是借用清單卡片既有的 AI 摘要功能：
  // 按下去只負責切回清單、捲到那張卡片，再幫使用者點一下卡片上的「✨ AI 摘要」
  const aiBtnHtml = GEMINI_API_KEY
    ? `<button type="button" class="iw-ai-btn" style="margin-left:10px;border:none;background:none;color:#8a5a1f;font-weight:700;text-decoration:underline;cursor:pointer;padding:0;font-size:13px;">✨ AI 解析</button>`
    : '';
  const websiteHtml = websiteLinkHtml(p, 'style="margin-left:10px;color:#8a5a1f;font-weight:700;text-decoration:underline;"');

  return `<div style="color:#1b2140;font-size:13px;line-height:1.6;max-width:220px;">`
    + `<div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(name)}</div>`
    + `<div style="margin-bottom:2px;">${metaLine}</div>`
    + (routeDistanceText ? `<div style="margin-bottom:2px;">📍 ${escapeHtml(routeDistanceText)}</div>` : '')
    + `<div style="color:#5a6180;margin-bottom:6px;">${escapeHtml(address)}</div>`
    + `<div><a href="${navUrl}" target="_blank" rel="noopener noreferrer" style="color:#8a5a1f;font-weight:700;text-decoration:underline;">導航 →</a>${websiteHtml}${aiBtnHtml}</div>`
    + `</div>`;
}

// InfoWindow 預設往 marker 正上方彈出，如果 marker 太靠近地圖上緣（搜尋欄、
// 工具列下方那一小條），彈窗會被裁掉或蓋住其他 UI。這裡先置中，再把視角往上
// 移一點，讓 marker 落在畫面偏下方，上方多留一些淨空的彈窗空間
export function panForInfoWindow(pos, zoom) {
  // 直接跳過去的時候，把還在飛的 flyToForInfoWindow 停掉，不然下一幀又會被它拉走
  flyToken++;
  mapState.map.panTo(pos);
  if (typeof zoom === 'number') mapState.map.setZoom(zoom);
  mapState.map.panBy(0, -110);
}

// 「飛過去」版的 panForInfoWindow：鏡頭先稍微拉遠、再拉近降落到目標，看起來像從地圖上飛過去。
// 距離越遠拉得越高；使用者設定減少動態效果時直接跳過去。回傳的 Promise 在降落後 resolve，
// 呼叫端接著再開 InfoWindow。連續呼叫時，前一次沒飛完的會被放棄（不會 resolve 兩次開兩個窗）
let flyToken = 0;
export function flyToForInfoWindow(pos, zoom) {
  const map = mapState.map;
  const token = ++flyToken;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // 點陣地圖不支援小數縮放層級，拉高再降落的弧線會變成一格一格跳，直接用原本的平移就好
  const isVector = map.getRenderingType?.() === google.maps.RenderingType?.VECTOR;
  if (reduced || !isVector || !map.getCenter()) {
    panForInfoWindow(pos, zoom);
    return Promise.resolve(true);
  }
  const from = map.getCenter();
  const fromZoom = map.getZoom();
  const target = new google.maps.LatLng(pos.lat, pos.lng);
  const distKm = google.maps.geometry.spherical.computeDistanceBetween(from, target) / 1000;
  // 拉高的幅度：同一個畫面內幾乎不拉，距離每多一倍多拉半級，最多 3 級
  const bump = Math.min(3, Math.max(0, Math.log2(distKm + 1) * 0.5));
  const duration = 1100;
  const start = performance.now();
  return new Promise(resolve => {
    const tick = (now) => {
      if (token !== flyToken) {
        resolve(false);
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      map.moveCamera({
        center: { lat: from.lat() + (target.lat() - from.lat()) * e, lng: from.lng() + (target.lng() - from.lng()) * e },
        zoom: fromZoom + (zoom - fromZoom) * e - bump * Math.sin(Math.PI * t)
      });
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        map.panBy(0, -110);
        resolve(true);
      }
    };
    requestAnimationFrame(tick);
  });
}

// 集章地圖、採買地圖這類不是搜尋結果的標記用：直接給 HTML 內容，跟搜尋結果共用同一個 InfoWindow，
// 一次只會開著一個。回傳 InfoWindow，呼叫端要在裡面接按鈕事件時可以等它的 domready
export function openSimpleInfoWindow(html, anchor) {
  if (activeInfoWindow) activeInfoWindow.close();
  activeInfoWindow = new google.maps.InfoWindow({ content: html });
  activeInfoWindow.open({ map: mapState.map, anchor });
  return activeInfoWindow;
}

export function closeActiveInfoWindow() {
  if (activeInfoWindow) {
    activeInfoWindow.close();
    activeInfoWindow = null;
  }
}

// 開啟前先收掉前一個開著的 InfoWindow，避免在地圖上切換餐廳時舊的視窗還留著。
// card 是這間店在清單裡對應的卡片元素，有給的話才會顯示/接上「AI 解析」按鈕
export function openPlaceInfoWindow(p, pos, anchor, card) {
  // 動畫還在跑的話，要開窗的這間店可能還沒冒出來，先讓全部標記就位
  finishRouteReveal();
  if (activeInfoWindow) activeInfoWindow.close();
  activeInfoWindow = new google.maps.InfoWindow({
    content: buildInfoWindowContent(p, pos)
  });
  if (card) {
    google.maps.event.addListenerOnce(activeInfoWindow, 'domready', () => {
      const aiBtn = document.querySelector('.iw-ai-btn');
      if (!aiBtn) return;
      aiBtn.addEventListener('click', () => {
        activeInfoWindow.close();
        setMobileView('list');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 摘要還沒展開才代點一下，已經展開過的話只捲過去就好，不要反而把它點關掉
        const summaryEl = card.querySelector('.ai-summary');
        const toggleBtn = card.querySelector('.ai-summary-toggle');
        if (toggleBtn && (!summaryEl || summaryEl.hidden)) toggleBtn.click();
      });
    });
  }
  activeInfoWindow.open({ map: mapState.map, anchor });
}
