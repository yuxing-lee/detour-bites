import {
  GOOGLE_MAPS_API_KEY,
  GEMINI_API_KEY,
  SAMPLE_INTERVAL_KM,
  MAX_REVIEW_CANDIDATES,
  SEARCH_STORAGE_KEY
} from './config.js';
import {
  searchBtn,
  originInput,
  destinationInput,
  targetCountInput,
  radiusInput,
  keywordInput,
  dishKeywordInput,
  useCurrentLocationBtn,
  routeOptionsEl,
  sortSelectEl,
  sortDistanceOptionEl,
  openNowOnlyEl,
  resultsControlsEl,
  discoverBoxEl
} from './dom.js';
import { mapState, searchState } from './state.js';
import { setStatus } from './ui.js';
import { escapeHtml } from './utils.js';
import { samplePointsAlongPath, buildDetailedRoutePath, projectPointOntoRoutePath, summarizeRoute } from './routeMath.js';
import { nearbySearch, fetchPlaceReviews } from './placesApi.js';
import { expandDishTokens, reviewMentionsAny } from './reviews.js';
import { localParseKeyword, parseKeywordWithGemini, semanticMatchDishKeyword } from './gemini.js';
import { loadGoogleMapsSDK, initMapIfNeeded, resolveLocationText } from './googleMaps.js';
import { applyFiltersAndRender } from './results.js';
import { resetDiscoverResult } from './discover.js';

let savedOrigin = '';

function loadSavedSearch() {
  try {
    const raw = localStorage.getItem(SEARCH_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.origin) savedOrigin = saved.origin;
    if (saved.destination) destinationInput.value = saved.destination;
    if (saved.targetCount) targetCountInput.value = saved.targetCount;
    if (saved.radius) radiusInput.value = saved.radius;
    if (saved.keyword) keywordInput.value = saved.keyword;
    if (saved.dishKeyword) dishKeywordInput.value = saved.dishKeyword;
  } catch (err) {
    console.warn('讀取上次搜尋條件失敗：', err);
  }
}

function saveSearch() {
  try {
    localStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify({
      origin: originInput.value.trim(),
      destination: destinationInput.value.trim(),
      targetCount: targetCountInput.value,
      radius: radiusInput.value,
      keyword: keywordInput.value.trim(),
      dishKeyword: dishKeywordInput.value.trim()
    }));
  } catch (err) {
    console.warn('儲存搜尋條件失敗：', err);
  }
}

loadSavedSearch();
useCurrentLocation({ silent: true });

if (!GOOGLE_MAPS_API_KEY) {
  setStatus('尚未設定 Google Maps API Key，請在 .env 中設定 VITE_GOOGLE_MAPS_API_KEY 後重新啟動 npm run dev', 'error');
  searchBtn.disabled = true;
}

function useCurrentLocation({ silent } = {}) {
  if (!navigator.geolocation) {
    if (!silent) setStatus('這個瀏覽器不支援定位功能', 'error');
    return;
  }
  useCurrentLocationBtn.disabled = true;
  useCurrentLocationBtn.textContent = '定位中…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      originInput.value = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
      useCurrentLocationBtn.disabled = false;
      useCurrentLocationBtn.textContent = '目前位置';
      if (!silent) setStatus('已取得目前位置', 'ok');
    },
    (err) => {
      useCurrentLocationBtn.disabled = false;
      useCurrentLocationBtn.textContent = '目前位置';
      if (silent) {
        if (savedOrigin) originInput.value = savedOrigin;
      } else {
        setStatus('無法取得目前位置：' + err.message, 'error');
      }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

useCurrentLocationBtn.addEventListener('click', () => useCurrentLocation());

function renderRouteOptions() {
  routeOptionsEl.innerHTML = '';
  const routes = searchState.allRoutes.slice(0, 3);

  routes.forEach((route, i) => {
    const card = document.createElement('label');
    card.className = 'route-option' + (i === searchState.selectedRouteIndex ? ' selected' : '');
    card.innerHTML = `
      <input type="radio" name="routeChoice" value="${i}" ${i === searchState.selectedRouteIndex ? 'checked' : ''} />
      <div>
        <div class="route-option-title">路線 ${i + 1}${route.summary ? '：' + escapeHtml(route.summary) : ''}</div>
        <div class="route-option-meta">${summarizeRoute(route)}</div>
      </div>
    `;
    card.querySelector('input').addEventListener('change', () => selectRoute(i));
    routeOptionsEl.appendChild(card);
  });

  routeOptionsEl.hidden = routes.length === 0;
}

async function selectRoute(index) {
  searchState.selectedRouteIndex = index;
  mapState.directionsRenderer.setRouteIndex(index);
  renderRouteOptions();
  await searchAlongRoute(index);
}

let searchAlongRouteInProgress = false;

async function searchAlongRoute(routeIndex) {
  if (searchAlongRouteInProgress) return;
  searchAlongRouteInProgress = true;

  searchBtn.disabled = true;
  searchBtn.classList.add('is-loading');

  const radius = parseInt(radiusInput.value, 10) || 1200;
  const rawKeyword = keywordInput.value.trim();
  const localParsed = localParseKeyword(rawKeyword);
  let keyword = localParsed.keyword;
  let openNow = localParsed.openNow;
  let preferCheap = localParsed.preferCheap;

  if (GEMINI_API_KEY && rawKeyword) {
    setStatus('AI 解析關鍵字中…');
    try {
      const aiParsed = await parseKeywordWithGemini(rawKeyword);
      openNow = openNow || !!aiParsed.openNow;
      preferCheap = preferCheap || !!aiParsed.preferCheap;
      const aiKeyword = (aiParsed.keyword || '').trim();
      if (aiKeyword) keyword = aiKeyword;
      keywordInput.value = keyword;
    } catch (err) {
      console.warn('AI 關鍵字解析失敗，改用本機解析結果：', err);
    }
  }

  if (openNow) openNowOnlyEl.checked = true;
  if (preferCheap) sortSelectEl.value = 'price';
  const wantOpenNow = openNowOnlyEl.checked;
  const hasRoute = searchState.allRoutes.length > 0;
  sortDistanceOptionEl.textContent = hasRoute ? '順路優先' : '離起點最近';

  try {
    const samplePoints = hasRoute
      ? samplePointsAlongPath(searchState.allRoutes[routeIndex].overview_path, SAMPLE_INTERVAL_KM)
      : [searchState.lastOriginLocation];

    setStatus(hasRoute ? `路線取得完成，沿路 ${samplePoints.length} 個點搜尋中…` : '搜尋起點附近中…');

    const allResultsMap = new Map();
    for (let i = 0; i < samplePoints.length; i++) {
      if (hasRoute) setStatus(`搜尋中… (${i + 1}/${samplePoints.length})`);
      const places = await nearbySearch(samplePoints[i], radius, keyword, wantOpenNow);
      places.forEach(p => {
        if (!p.id || !p.location) return;
        // 同一間店可能被多個取樣點找到，去重即可，實際「順路距離」在下面統一用完整路線重新計算
        if (!allResultsMap.has(p.id)) allResultsMap.set(p.id, p);
      });
      // 避免過快連續打 API
      await new Promise(r => setTimeout(r, 150));
    }

    searchState.lastResults = Array.from(allResultsMap.values());

    if (hasRoute) {
      // 用完整、有方向性的逐步路徑（而不是粗略的取樣點）算出每間店「真正垂直於路線的距離」，
      // 以及沿路線方向的累積進度，避免把對向車道、反方向路段或平行道路上的店誤判成順路
      const detailedPath = buildDetailedRoutePath(searchState.allRoutes[routeIndex]);
      searchState.lastResults.forEach(p => {
        const placeLatLng = new google.maps.LatLng(p.location.latitude, p.location.longitude);
        const proj = projectPointOntoRoutePath(placeLatLng, detailedPath);
        p._routeDistance = proj.distance;
        p._routeProgress = proj.progress;
      });
    } else {
      // 沒有路線可比對，改成算「離起點多遠」，_routeProgress 全部一樣，排序就單純依距離
      searchState.lastResults.forEach(p => {
        const placeLatLng = new google.maps.LatLng(p.location.latitude, p.location.longitude);
        p._routeDistance = google.maps.geometry.spherical.computeDistanceBetween(searchState.lastOriginLocation, placeLatLng);
        p._routeProgress = 0;
      });
    }

    const dishKeyword = dishKeywordInput.value.trim();
    let cappedCandidateCount = 0;
    let dishAiMatchedCount = 0;
    if (dishKeyword) {
      // 依順路距離排序後只取前 MAX_REVIEW_CANDIDATES 間去查評論，
      // 避免路線很長、候選店家很多時打爆 Place Details 配額
      const candidates = searchState.lastResults
        .slice()
        .sort((a, b) => (a._routeDistance ?? Infinity) - (b._routeDistance ?? Infinity))
        .slice(0, MAX_REVIEW_CANDIDATES);
      cappedCandidateCount = candidates.length;

      const dishTokens = expandDishTokens(dishKeyword);
      const matched = [];
      for (let i = 0; i < candidates.length; i++) {
        setStatus(`比對評論中…(${i + 1}/${candidates.length})`);
        const place = candidates[i];
        const reviews = await fetchPlaceReviews(place.id);
        if (reviews !== null) place._reviews = reviews;
        const hit = (reviews || []).find(r => reviewMentionsAny(r, dishTokens));
        if (hit) {
          place._matchedReview = hit;
          place._matchedKeyword = dishKeyword;
          matched.push(place);
        }
        await new Promise(r => setTimeout(r, 120));
      }

      // 同義詞擴充比對不到任何一間時才啟用 AI 語意比對，一次把所有候選店家的評論
      // 摘錄送給 Gemini 判斷，涵蓋「氣氛好」「約會」這類同義詞庫沒收錄的抽象描述
      if (!matched.length && candidates.length && GEMINI_API_KEY) {
        setStatus(`本機比對沒有找到符合「${dishKeyword}」的餐廳，改用 AI 語意比對中…`);
        try {
          const { matchedIndexes } = await semanticMatchDishKeyword(dishKeyword, candidates);
          (matchedIndexes || []).forEach(idx => {
            const place = candidates[idx];
            if (place && !matched.includes(place)) {
              place._matchedKeyword = dishKeyword;
              place._aiMatched = true;
              matched.push(place);
              dishAiMatchedCount++;
            }
          });
        } catch (err) {
          console.warn('AI 語意比對失敗：', err);
        }
      }

      searchState.lastResults = matched;
    }

    resultsControlsEl.hidden = searchState.lastResults.length === 0;
    discoverBoxEl.hidden = searchState.lastResults.length === 0;
    resetDiscoverResult();
    applyFiltersAndRender();
    if (dishKeyword) {
      const aiNote = dishAiMatchedCount ? `（其中 ${dishAiMatchedCount} 間是透過 AI 語意比對找到）` : '';
      setStatus(`完成！在 ${cappedCandidateCount} 間候選餐廳中比對評論後，找到 ${searchState.lastResults.length} 間符合「${dishKeyword}」的餐廳${aiNote}。`, 'ok');
    } else {
      setStatus(hasRoute
        ? `完成！沿路共找到 ${searchState.lastResults.length} 間不重複的餐廳。`
        : `完成！起點附近共找到 ${searchState.lastResults.length} 間不重複的餐廳。`, 'ok');
    }
  } catch (err) {
    console.error(err);
    setStatus(err.message || '發生錯誤，請檢查網路連線', 'error');
  } finally {
    searchAlongRouteInProgress = false;
    searchBtn.disabled = false;
    searchBtn.classList.remove('is-loading');
  }
}

async function runSearch() {
  const origin = originInput.value.trim();
  const destination = destinationInput.value.trim();

  if (!GOOGLE_MAPS_API_KEY) return setStatus('尚未設定 Google Maps API Key，請在 .env 中設定 VITE_GOOGLE_MAPS_API_KEY 後重新啟動 npm run dev', 'error');
  if (!origin) return setStatus('請輸入起點', 'error');

  searchState.lastOrigin = origin;
  searchState.lastDestination = destination;
  saveSearch();

  searchBtn.disabled = true;
  searchBtn.classList.add('is-loading');
  routeOptionsEl.hidden = true;
  setStatus('載入地圖服務中…');

  try {
    await loadGoogleMapsSDK();
    initMapIfNeeded();

    if (destination) {
      mapState.directionsRenderer.setMap(mapState.map);
      setStatus('規劃路線中…');
      const result = await new Promise((resolve, reject) => {
        mapState.directionsService.route(
          { origin, destination, travelMode: google.maps.TravelMode.DRIVING, provideRouteAlternatives: true },
          (res, status) => {
            if (status === google.maps.DirectionsStatus.OK) resolve(res);
            else reject(new Error('路線規劃失敗：' + status));
          }
        );
      });

      searchState.allRoutes = result.routes;
      searchState.selectedRouteIndex = 0;
      searchState.lastOriginLocation = null;
      mapState.directionsRenderer.setDirections(result);
      mapState.directionsRenderer.setRouteIndex(0);
      renderRouteOptions();
    } else {
      // 沒填目的地：只找起點附近，不需要路線，先把上一次搜尋留下的路線畫面清掉
      searchState.allRoutes = [];
      searchState.selectedRouteIndex = 0;
      mapState.directionsRenderer.setMap(null);
      setStatus('定位起點中…');
      searchState.lastOriginLocation = await resolveLocationText(origin);
      mapState.map.setCenter(searchState.lastOriginLocation);
      mapState.map.setZoom(15);
    }

    await searchAlongRoute(0);
  } catch (err) {
    console.error(err);
    setStatus(err.message || '發生錯誤，請檢查 API key 與網路連線', 'error');
    searchBtn.disabled = false;
    searchBtn.classList.remove('is-loading');
  }
}

searchBtn.addEventListener('click', runSearch);
