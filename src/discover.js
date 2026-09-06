import { EATEN_GOOD_RATING_THRESHOLD, OLD_FAVORITE_RATIO, GEMINI_API_KEY } from './config.js';
import { discoverBtn, openNowOnlyEl, includeEatenCheckbox, discoverResultEl } from './dom.js';
import { mapState, searchState } from './state.js';
import { escapeHtml, priceText, websiteLinkHtml, buildNavUrl, formatRouteDistance } from './utils.js';
import { isEaten, eatenRating, wireEatenWidget, weightedRandomPick } from './eatenList.js';
import { wireReviewAndAiActions } from './placeActions.js';
import { panForInfoWindow, openPlaceInfoWindow } from './googleMaps.js';

let discoverMarker = null;
let lastDiscoverPickId = null;

function clearDiscoverMarker() {
  if (discoverMarker) {
    discoverMarker.setMap(null);
    discoverMarker = null;
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
        <span class="rating">${rating}</span>
        <span>${escapeHtml(address)}</span>
        ${price ? `<span>${price}</span>` : ''}
        ${openStatus}
      </div>
      <a class="nav-link" href="${navUrl}" target="_blank" rel="noopener noreferrer" title="在 Google Maps 開啟含原本起點/終點的完整路線">導航 →</a>
      ${websiteLinkHtml(p, 'class="website-link" title="前往店家官網"')}
      <div class="card-actions">
        <button type="button" class="review-toggle">查看評論${reviewCountLabel}</button>
        ${GEMINI_API_KEY ? '<button type="button" class="review-toggle ai-summary-toggle">✨ AI 摘要</button>' : ''}
      </div>
      <div class="eaten-widget-slot"></div>
      <div class="ai-summary" hidden></div>
      <div class="review-list" hidden></div>
    </div>
  `;

  wireEatenWidget(discoverResultEl.querySelector('.eaten-widget-slot'), p.id, name);
  wireReviewAndAiActions(discoverResultEl, p, name);

  clearDiscoverMarker();
  discoverMarker = new google.maps.Marker({
    position: pos,
    map: mapState.map,
    title: name,
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
  panForInfoWindow(pos, 16);
  openPlaceInfoWindow(p, pos, discoverMarker, discoverResultEl);
}

discoverBtn.addEventListener('click', () => {
  if (!searchState.lastResults.length) return;

  discoverBtn.classList.remove('rolling');
  void discoverBtn.offsetWidth;
  discoverBtn.classList.add('rolling');
  setTimeout(() => discoverBtn.classList.remove('rolling'), 500);

  let candidates = searchState.lastResults.slice();
  if (openNowOnlyEl.checked) {
    candidates = candidates.filter(p => p.currentOpeningHours?.openNow === true);
  }

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
  renderDiscoverResult(picked);
});
