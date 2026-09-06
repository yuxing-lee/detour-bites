import { GOOGLE_MAPS_API_KEY, GEMINI_API_KEY } from './config.js';
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=geometry,places&callback=__gmapsInit`;
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
  mapState.map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 25.0478, lng: 121.5171 },
    zoom: 8,
    disableDefaultUI: false,
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
    polylineOptions: { strokeColor: '#f2a340', strokeWeight: 5 }
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
  if (searchState.allRoutes.length && searchState.allRoutes[searchState.selectedRouteIndex]) {
    mapState.map.fitBounds(searchState.allRoutes[searchState.selectedRouteIndex].bounds);
  } else if (searchState.lastOriginLocation) {
    mapState.map.setCenter(searchState.lastOriginLocation);
    mapState.map.setZoom(15);
  }
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
  if (mapState.placeMarkerCluster) {
    mapState.placeMarkerCluster.clearMarkers();
    mapState.placeMarkerCluster = null;
  }
  mapState.placeMarkers.forEach(m => m.setMap(null));
  mapState.placeMarkers = [];
  mapState.placeCards = [];
  if (activeInfoWindow) {
    activeInfoWindow.close();
    activeInfoWindow = null;
  }
}

// 清單編號跟地圖標記共用同一套外觀邏輯：預設是帶數字的橘色小圓點，
// 滑鼠移到清單卡片或地圖標記其中一邊時，兩邊會一起放大變色，讓使用者看得出兩者對應同一間店
export function markerIcon(highlighted) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: highlighted ? 13 : 9,
    fillColor: highlighted ? '#ffb85c' : '#f2a340',
    fillOpacity: 1,
    strokeColor: '#12172b',
    strokeWeight: highlighted ? 2.5 : 1.5
  };
}

export function markerLabel(index) {
  return { text: String(index + 1), color: '#12172b', fontSize: '11px', fontWeight: '700' };
}

export function setPlaceHighlighted(index, isOn) {
  const marker = mapState.placeMarkers[index];
  const card = mapState.placeCards[index];
  if (marker) marker.setIcon(markerIcon(isOn));
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
  mapState.map.panTo(pos);
  if (typeof zoom === 'number') mapState.map.setZoom(zoom);
  mapState.map.panBy(0, -110);
}

// 開啟前先收掉前一個開著的 InfoWindow，避免在地圖上切換餐廳時舊的視窗還留著。
// card 是這間店在清單裡對應的卡片元素，有給的話才會顯示/接上「AI 解析」按鈕
export function openPlaceInfoWindow(p, pos, anchor, card) {
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
  activeInfoWindow.open(mapState.map, anchor);
}
