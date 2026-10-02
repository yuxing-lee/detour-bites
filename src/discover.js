import { EATEN_GOOD_RATING_THRESHOLD, OLD_FAVORITE_RATIO, GEMINI_API_KEY } from './config.js';
import { discoverBtn, includeEatenCheckbox, discoverResultEl } from './dom.js';
import { mapState, searchState } from './state.js';
import { escapeHtml, priceText, websiteLinkHtml, buildNavUrl, formatRouteDistance, oppositeSideBadgeHtml } from './utils.js';
import { applyCheckboxFilters } from './results.js';
import { isEaten, eatenRating, wireEatenWidget, weightedRandomPick } from './eatenList.js';
import { wireReviewAndAiActions, wirePhotoGalleryAction } from './placeActions.js';
import { flyToForInfoWindow, openPlaceInfoWindow, createPlaceMarker, removeMarker, setMarkerEaten, setPlaceHighlighted } from './googleMaps.js';
import { stopFlyover } from './flyover.js';

let lastDiscoverPickId = null;

function clearDiscoverMarker() {
  if (mapState.discoverMarker) {
    removeMarker(mapState.discoverMarker);
    mapState.discoverMarker = null;
  }
}

// 新一輪搜尋完成後呼叫，清掉上一次搜尋留下的「踩新點」推薦畫面
export function resetDiscoverResult() {
  clearDiscoverMarker();
  discoverResultEl.innerHTML = '';
  lastDiscoverPickId = null;
}

// 從目前搜尋結果（已依關鍵字/半徑等條件過濾）中隨機挑一間，可選是否排除已標記「吃過」的店家
function renderDiscoverResult(p) {
  const pos = { lat: p.location.latitude, lng: p.location.longitude };
  const name = p.displayName?.text || '(未命名)';
  const address = p.formattedAddress || '';
  const rating = p.rating
    ? `★ ${p.rating.toFixed(1)}${p.userRatingCount ? ` (${p.userRatingCount})` : ''}`
    : '尚無評分';
  const price = priceText(p);
  const openNow = p.currentOpeningHours?.openNow;
  const openStatus = openNow === true
    ? '<span class="open-badge open">營業中</span>'
    : openNow === false
    ? '<span class="open-badge closed">已打烊</span>'
    : '';
  const routeDistanceText = formatRouteDistance(p._routeDistance, searchState.lastDestination);
  const navUrl = buildNavUrl(pos, searchState.lastOrigin, searchState.lastDestination);
  const reviewCountLabel = p._reviews ? ` (${p._reviews.length})` : '';

  discoverResultEl.innerHTML = `
    <div class="place-card discover-card">
      <div class="name">🎯 ${escapeHtml(name)}</div>
      <div class="meta">
        ${routeDistanceText ? `<span class="route-distance">${routeDistanceText}</span>` : ''}
        ${oppositeSideBadgeHtml(p)}
        <span class="rating">${rating}</span>
        <span>${escapeHtml(address)}</span>
        ${price ? `<span>${price}</span>` : ''}
        ${openStatus}
      </div>
      <a class="nav-link" href="${navUrl}" target="_blank" rel="noopener noreferrer" title="在 Google Maps 開啟含原本起點/終點的完整路線">導航 →</a>
      ${websiteLinkHtml(p, 'class="website-link" title="前往店家官網"')}
      <div class="card-actions">
        <button type="button" class="review-toggle">查看評論${reviewCountLabel}</button>
        <button type="button" class="review-toggle photo-toggle">📷 查看照片</button>
        ${GEMINI_API_KEY ? '<button type="button" class="review-toggle ai-summary-toggle">✨ AI 摘要</button>' : ''}
      </div>
      <div class="eaten-widget-slot"></div>
      <div class="ai-summary" hidden></div>
      <div class="review-list" hidden></div>
      <div class="photo-gallery" hidden></div>
    </div>
  `;

  // 推薦的店也在搜尋結果清單裡，這裡標記吃過時順便更新結果清單那顆地圖標記的小印章
  const syncResultMarker = () => {
    const idx = mapState.placeData.findIndex(item => item.id === p.id);
    if (idx >= 0) setMarkerEaten(mapState.placeMarkers[idx], isEaten(p.id));
  };
  wireEatenWidget(discoverResultEl.querySelector('.eaten-widget-slot'), p.id, name, syncResultMarker, pos);
  wireReviewAndAiActions(discoverResultEl, p, name);
  wirePhotoGalleryAction(discoverResultEl, p);

  clearDiscoverMarker();
  mapState.discoverMarker = createPlaceMarker({ position: pos, title: name, variant: 'discover', map: mapState.map });
  const marker = mapState.discoverMarker;
  flyToForInfoWindow(pos, 16).then(landed => {
    // 飛行途中又抽了下一間的話，這一間的窗就不用開了
    if (landed && marker === mapState.discoverMarker) openPlaceInfoWindow(p, pos, marker, discoverResultEl);
  });
}

let spinning = false;

// 「轉盤」：揭曉前先在目前清單/地圖上的店家之間快速輪流亮起來，越轉越慢，
// 最後停在抽中的那間（抽中的店不在目前顯示的清單裡時，停在隨機一間後直接揭曉）。
// 結果本身在轉之前就已經抽好了，轉盤只是揭曉的過程
function spinRoulette(picked) {
  const shown = mapState.placeData;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (shown.length < 2 || reduced) return Promise.resolve();

  const finalIndex = shown.findIndex(p => p.id === picked.id);
  const steps = 14;
  let prev = -1;
  let current = Math.floor(Math.random() * shown.length);
  discoverResultEl.innerHTML = '<div class="discover-spinning">🎰 轉盤轉動中…<span class="discover-spinning-name"></span></div>';
  const nameEl = discoverResultEl.querySelector('.discover-spinning-name');

  return new Promise(resolve => {
    const step = (k) => {
      if (prev >= 0) setPlaceHighlighted(prev, false);
      if (k === steps - 1 && finalIndex >= 0) {
        current = finalIndex;
      } else {
        // 每一步換到另一間，不要原地停
        current = (current + 1 + Math.floor(Math.random() * (shown.length - 1))) % shown.length;
      }
      setPlaceHighlighted(current, true);
      nameEl.textContent = ` ${current + 1}. ${shown[current].displayName?.text || ''}`;
      prev = current;
      if (k < steps - 1) {
        // 間隔從 60ms 慢慢拉長到 ~300ms，像轉盤慢慢停下來
        setTimeout(() => step(k + 1), 60 + 240 * Math.pow(k / (steps - 1), 2));
      } else {
        setTimeout(() => {
          setPlaceHighlighted(current, false);
          resolve();
        }, 450);
      }
    };
    step(0);
  });
}

discoverBtn.addEventListener('click', async () => {
  if (!searchState.lastResults.length || spinning) return;

  discoverBtn.classList.remove('rolling');
  void discoverBtn.offsetWidth;
  discoverBtn.classList.add('rolling');
  setTimeout(() => discoverBtn.classList.remove('rolling'), 500);

  let candidates = applyCheckboxFilters(searchState.lastResults);

  // 避免連續兩次抽到同一間；但如果排除後就沒候選了（篩到只剩它自己），就不排除
  if (lastDiscoverPickId && candidates.some(p => p.id !== lastDiscoverPickId)) {
    candidates = candidates.filter(p => p.id !== lastDiscoverPickId);
  }

  const poolNew = candidates.filter(p => !isEaten(p.id));
  const poolOld = candidates.filter(p => isEaten(p.id) && eatenRating(p.id) >= EATEN_GOOD_RATING_THRESHOLD);

  // 先用固定比例（OLD_FAVORITE_RATIO）決定這次要從舊愛池還是新店池抽，
  // 池子裡沒東西時 fallback 到另一個池子，兩個都沒東西才算沒結果
  let picked = null;
  if (includeEatenCheckbox.checked && poolOld.length && (!poolNew.length || Math.random() < OLD_FAVORITE_RATIO)) {
    picked = weightedRandomPick(poolOld);
  } else if (poolNew.length) {
    picked = weightedRandomPick(poolNew);
  } else if (includeEatenCheckbox.checked) {
    picked = weightedRandomPick(poolOld);
  }

  if (!picked) {
    clearDiscoverMarker();
    discoverResultEl.innerHTML = '<div class="discover-result-empty">目前條件下沒有符合的餐廳可以推薦，試試勾選「包含吃過的高評價餐廳」。</div>';
    return;
  }

  lastDiscoverPickId = picked.id;
  stopFlyover();
  spinning = true;
  discoverBtn.disabled = true;
  try {
    await spinRoulette(picked);
  } finally {
    spinning = false;
    discoverBtn.disabled = false;
  }
  // 轉盤轉的時候使用者重新搜尋了，這次的結果就作廢
  if (lastDiscoverPickId !== picked.id) return;
  renderDiscoverResult(picked);
});
