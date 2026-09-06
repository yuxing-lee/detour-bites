import { PLACE_PHOTO_MAX_COUNT, PLACE_PHOTO_WIDTH_PX } from './config.js';
import { escapeHtml, placePhotoMediaUrl } from './utils.js';

// Places API 沒有「菜單照片」分類，這裡顯示的是店家在 Google 地圖上的一般照片，
// 使用者自己滑過去找有沒有菜單。每張圖都照 Google 使用條款要求附上攝影者署名。
export function renderPhotoGallery(container, photos) {
  if (!photos.length) {
    container.innerHTML = '<div class="review-empty">目前沒有照片資料</div>';
    return;
  }
  container.innerHTML = photos.slice(0, PLACE_PHOTO_MAX_COUNT).map(photo => {
    const src = escapeHtml(placePhotoMediaUrl(photo.name, PLACE_PHOTO_WIDTH_PX));
    const attribution = photo.authorAttributions?.[0];
    const author = attribution?.displayName || '';
    const authorHtml = author
      ? (attribution.uri
        ? `<a href="${escapeHtml(attribution.uri)}" target="_blank" rel="noopener noreferrer">📷 ${escapeHtml(author)}</a>`
        : `<span>📷 ${escapeHtml(author)}</span>`)
      : '';
    return `
      <div class="photo-item">
        <img src="${src}" alt="店家照片" loading="lazy">
        ${authorHtml ? `<div class="photo-attribution">${authorHtml}</div>` : ''}
      </div>
    `;
  }).join('');

  // 圖片載入失敗（例如照片被移除、暫時性錯誤）就整格隱藏，不要留一個破圖示在畫面上
  container.querySelectorAll('.photo-item img').forEach(img => {
    img.addEventListener('error', () => { img.closest('.photo-item').hidden = true; }, { once: true });
  });
}
