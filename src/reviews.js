import { DISH_SYNONYM_GROUPS } from './config.js';
import { escapeHtml } from './utils.js';

export function reviewText(review) {
  return (review.text?.text || review.originalText?.text || '').trim();
}

export function expandDishTokens(rawText) {
  const tokens = rawText.split(/[、,，\/\s]+/).map(t => t.trim()).filter(Boolean);
  const expanded = new Set();
  (tokens.length ? tokens : [rawText.trim()]).filter(Boolean).forEach(tok => {
    expanded.add(tok);
    DISH_SYNONYM_GROUPS.forEach(group => {
      if (group.some(w => tok.includes(w) || w.includes(tok))) {
        group.forEach(w => expanded.add(w));
      }
    });
  });
  return Array.from(expanded);
}

export function reviewMentionsAny(review, tokens) {
  const text = reviewText(review).toLowerCase();
  return tokens.some(t => text.includes(t.toLowerCase()));
}

// 找關鍵字附近的一小段文字當作預覽，找不到就退回開頭那段
export function reviewSnippet(review, keyword) {
  const text = reviewText(review).replace(/\s+/g, ' ');
  if (!text) return '';
  const windowSize = 90;
  const idx = keyword ? text.toLowerCase().indexOf(keyword.toLowerCase()) : -1;
  if (idx === -1) {
    return text.length > windowSize ? text.slice(0, windowSize) + '…' : text;
  }
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + keyword.length + 60);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export function renderReviewList(container, reviews) {
  if (!reviews.length) {
    container.innerHTML = '<div class="review-empty">目前沒有評論資料</div>';
    return;
  }
  container.innerHTML = reviews.map(r => {
    const author = escapeHtml(r.authorAttribution?.displayName || '匿名');
    const rating = r.rating ? '★'.repeat(Math.round(r.rating)) : '';
    const time = escapeHtml(r.relativePublishTimeDescription || '');
    const text = escapeHtml(reviewText(r));
    return `
      <div class="review-item">
        <div class="review-meta"><span class="review-author">${author}</span><span class="review-rating">${rating}</span><span class="review-time">${time}</span></div>
        <div class="review-text">${text}</div>
      </div>
    `;
  }).join('');
}
