import { MarkerClusterer, SuperClusterAlgorithm } from '@googlemaps/markerclusterer';
import { PRICE_RANK, GEMINI_API_KEY, PLACE_INFO_ZOOM, CLUSTER_MAX_ZOOM } from './config.js';
import { targetCountInput, openNowOnlyEl, sortSelectEl, resultCountEl, resultListEl } from './dom.js';
import { mapState, searchState } from './state.js';
import { escapeHtml, priceText, websiteLinkHtml, buildNavUrl, formatRouteDistance } from './utils.js';
import { reviewSnippet } from './reviews.js';
import { clearPlaceMarkers, markerIcon, markerLabel, setPlaceHighlighted, panForInfoWindow, openPlaceInfoWindow } from './googleMaps.js';
import { wireEatenWidget } from './eatenList.js';
import { wireReviewAndAiActions, wirePhotoGalleryAction } from './placeActions.js';

export function applyFiltersAndRender() {
  if (!searchState.lastResults.length) return;

  const targetCount = parseInt(targetCountInput.value, 10) || 10;
  let list = searchState.lastResults.slice();

  if (openNowOnlyEl.checked) {
    list = list.filter(p => p.currentOpeningHours?.openNow === true);
  }

  if (sortSelectEl.value === 'price') {
    list.sort((a, b) => (PRICE_RANK[a.priceLevel] || 99) - (PRICE_RANK[b.priceLevel] || 99));
  } else if (sortSelectEl.value === 'rating') {
    list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else {
    // 順路優先：先比真正垂直於路線的距離（越小代表越不用繞路），
    // 距離相近時再依沿路線方向的累積進度排序，讓清單順序盡量跟著行進方向走，不會忽前忽後
    list.sort((a, b) => {
      const da = a._routeDistance ?? Infinity;
      const db = b._routeDistance ?? Infinity;
      if (Math.abs(da - db) > 30) return da - db;
      return (a._routeProgress ?? Infinity) - (b._routeProgress ?? Infinity);
    });
  }

  renderResults(list.slice(0, targetCount));
}

sortSelectEl.addEventListener('change', applyFiltersAndRender);
openNowOnlyEl.addEventListener('change', applyFiltersAndRender);
targetCountInput.addEventListener('change', applyFiltersAndRender);

export function renderResults(places) {
  resultCountEl.textContent = `找到 ${places.length} 間餐廳`;
  resultListEl.innerHTML = '';
  clearPlaceMarkers();

  places.forEach((p, i) => {
    const pos = { lat: p.location.latitude, lng: p.location.longitude };
    const name = p.displayName?.text || '(未命名)';
    const address = p.formattedAddress || '';

    const marker = new google.maps.Marker({
      position: pos,
      title: name,
      icon: markerIcon(false),
      label: markerLabel(i),
      zIndex: 10
    });
    mapState.placeMarkers.push(marker);

    const card = document.createElement('div');
    card.className = 'place-card';
    card.style.animationDelay = `${Math.min(i, 12) * 25}ms`;
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
    const navUrl = buildNavUrl(pos, searchState.lastOrigin, searchState.lastDestination);
    const routeDistanceText = formatRouteDistance(p._routeDistance, searchState.lastDestination);
    const matchedSnippet = p._matchedReview ? reviewSnippet(p._matchedReview, p._matchedKeyword || '') : '';
    const matchNote = matchedSnippet
      ? `💬 評論提到：「${escapeHtml(matchedSnippet)}」`
      : (p._aiMatched ? `✨ AI 判斷這裡符合「${escapeHtml(p._matchedKeyword || '')}」` : '');
    const reviewCountLabel = p._reviews ? ` (${p._reviews.length})` : '';
    card.innerHTML = `
      <div class="name"><span class="place-index">${i + 1}</span>${escapeHtml(name)}</div>
      <div class="meta">
        ${routeDistanceText ? `<span class="route-distance">${routeDistanceText}</span>` : ''}
        <span class="rating">${rating}</span>
        <span>${escapeHtml(address)}</span>
        ${price ? `<span>${price}</span>` : ''}
        ${openStatus}
      </div>
      ${matchNote ? `<div class="review-match">${matchNote}</div>` : ''}
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
    `;
    card.addEventListener('click', () => {
      panForInfoWindow(pos, PLACE_INFO_ZOOM);
      openPlaceInfoWindow(p, pos, marker, card);
    });
    card.querySelector('.nav-link').addEventListener('click', (e) => e.stopPropagation());
    card.querySelector('.website-link')?.addEventListener('click', (e) => e.stopPropagation());

    // 清單卡片 ↔ 地圖標記雙向連動：滑過任一邊，另一邊會一起亮起來
    card.addEventListener('mouseenter', () => setPlaceHighlighted(i, true));
    card.addEventListener('mouseleave', () => setPlaceHighlighted(i, false));
    marker.addListener('mouseover', () => setPlaceHighlighted(i, true));
    marker.addListener('mouseout', () => setPlaceHighlighted(i, false));
    marker.addListener('click', () => {
      panForInfoWindow(pos, PLACE_INFO_ZOOM);
      openPlaceInfoWindow(p, pos, marker, card);
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    wireEatenWidget(card.querySelector('.eaten-widget-slot'), p.id, name);

    wireReviewAndAiActions(card, p, name);
    wirePhotoGalleryAction(card, p);

    mapState.placeCards.push(card);
    resultListEl.appendChild(card);
  });

  // 結果多、店家又密集時，個別 marker 會擠成一團互相蓋住；用 clusterer 讓縮小時
  // 自動收成一顆數字圓點，放大到能分辨個別店家的 zoom 才拆開顯示。
  // maxZoom 設在 PLACE_INFO_ZOOM 之下，確保點開 InfoWindow 時一定強制 zoom 到
  // 不會被 cluster 隱藏的層級，兩個 marker 相關的功能才不會互相打架
  if (mapState.placeMarkers.length) {
    mapState.placeMarkerCluster = new MarkerClusterer({
      map: mapState.map,
      markers: mapState.placeMarkers,
      algorithm: new SuperClusterAlgorithm({ maxZoom: CLUSTER_MAX_ZOOM })
    });
  }
}
