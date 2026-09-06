import { fetchPlaceReviews } from './placesApi.js';
import { renderReviewList } from './reviews.js';
import { summarizePlaceReviews } from './gemini.js';

// 「查看評論」＋「✨ AI 摘要」按鈕的共用綁定邏輯，讓一般搜尋結果卡片跟「踩新點」隨機推薦卡片
// 都能查看評論、生成 AI 摘要，行為完全一致
export function wireReviewAndAiActions(container, p, name) {
  // 用 :not(.ai-summary-toggle) 明確排除 AI 摘要按鈕，不依賴兩個按鈕在 DOM 裡的先後順序
  const reviewToggleBtn = container.querySelector('.review-toggle:not(.ai-summary-toggle)');
  const reviewListEl = container.querySelector('.review-list');
  reviewToggleBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!reviewListEl.hidden) {
      reviewListEl.hidden = true;
      return;
    }
    if (!p._reviews) {
      reviewToggleBtn.textContent = '載入評論中…';
      reviewToggleBtn.disabled = true;
      const reviews = await fetchPlaceReviews(p.id);
      reviewToggleBtn.disabled = false;
      // fetchPlaceReviews 失敗時回傳 null；不快取失敗結果，讓使用者下次點擊可以重試，
      // 而不是被永遠卡在「暫時性錯誤」造成的空清單
      if (reviews === null) {
        reviewListEl.innerHTML = '<div class="review-empty">評論載入失敗，請稍後再試</div>';
        reviewListEl.hidden = false;
        reviewToggleBtn.textContent = '查看評論';
        return;
      }
      p._reviews = reviews;
    }
    renderReviewList(reviewListEl, p._reviews);
    reviewListEl.hidden = false;
    reviewToggleBtn.textContent = `查看評論 (${p._reviews.length})`;
  });

  const aiSummaryBtn = container.querySelector('.ai-summary-toggle');
  const aiSummaryEl = container.querySelector('.ai-summary');
  if (aiSummaryBtn) {
    aiSummaryBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!aiSummaryEl.hidden) {
        aiSummaryEl.hidden = true;
        return;
      }
      if (!p._aiSummary) {
        aiSummaryBtn.textContent = '摘要生成中…';
        aiSummaryBtn.disabled = true;
        if (!p._reviews) {
          const reviews = await fetchPlaceReviews(p.id);
          if (reviews !== null) p._reviews = reviews;
        }
        const summary = await summarizePlaceReviews(name, p._reviews || []);
        aiSummaryBtn.disabled = false;
        aiSummaryBtn.textContent = '✨ AI 摘要';
        // summarizePlaceReviews 失敗時回傳 null；同樣不快取，讓下次點擊可以重新生成
        if (summary === null) {
          aiSummaryEl.textContent = 'AI 摘要暫時無法使用，請稍後再試。';
          aiSummaryEl.hidden = false;
          return;
        }
        p._aiSummary = summary;
      }
      aiSummaryEl.textContent = p._aiSummary;
      aiSummaryEl.hidden = false;
    });
  }
}
