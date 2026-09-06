import { EATEN_STORAGE_KEY, EATEN_GOOD_RATING_THRESHOLD } from './config.js';
import {
  manageEatenBtn,
  eatenModalOverlayEl,
  closeEatenModalBtn,
  eatenListEl,
  eatenModalStatusEl,
  exportEatenBtn,
  importEatenInput
} from './dom.js';

// 「吃過」清單存 { name, rating }：rating 是 1~5 顆星，0/undefined 代表吃過但還沒評分
function loadEatenPlaces() {
  try {
    const raw = localStorage.getItem(EATEN_STORAGE_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw);
    return new Map(arr.map(item => [item.id, { name: item.name, rating: item.rating || 0 }]));
  } catch (err) {
    console.warn('讀取已吃過清單失敗：', err);
    return new Map();
  }
}

function saveEatenPlaces() {
  try {
    localStorage.setItem(EATEN_STORAGE_KEY, JSON.stringify(
      Array.from(eatenPlaces, ([id, entry]) => ({ id, name: entry.name, rating: entry.rating }))
    ));
  } catch (err) {
    console.warn('儲存已吃過清單失敗：', err);
  }
}

let eatenPlaces = loadEatenPlaces();

export function isEaten(id) {
  return eatenPlaces.has(id);
}

export function eatenRating(id) {
  return eatenPlaces.get(id)?.rating || 0;
}

function setEatenRating(id, name, rating) {
  eatenPlaces.set(id, { name, rating });
  saveEatenPlaces();
  updateManageEatenBtnLabel();
}

function clearEaten(id) {
  eatenPlaces.delete(id);
  saveEatenPlaces();
  updateManageEatenBtnLabel();
}

function updateManageEatenBtnLabel() {
  manageEatenBtn.textContent = `📋 管理吃過清單（${eatenPlaces.size}）`;
}

updateManageEatenBtnLabel();

function starRatingHTML(id) {
  const rating = eatenRating(id);
  return [1, 2, 3, 4, 5].map(n => `<button type="button" class="star-btn${n <= rating ? ' filled' : ''}" data-value="${n}" aria-label="${n} 顆星">${n <= rating ? '★' : '☆'}</button>`).join('');
}

function eatenLabelText(id) {
  const rating = eatenRating(id);
  return rating ? `已吃過（${rating}★）` : (isEaten(id) ? '已吃過（尚未評分）' : '標記已吃過：');
}

function eatenWidgetHTML(id) {
  return `
    <div class="eaten-widget">
      <span class="eaten-label">${eatenLabelText(id)}</span>
      <span class="star-picker">${starRatingHTML(id)}</span>
      ${isEaten(id) ? '<button type="button" class="clear-eaten-btn" title="取消標記已吃過">✕</button>' : ''}
    </div>
  `;
}

// 掛在 slotEl 底下渲染星星評分小工具並綁定事件；點星星＝標記已吃過＋設定評分，點 ✕＝取消標記
// onChange 是選填的額外回呼，給需要在評分變動後重繪外層清單的呼叫端（例如管理清單）用
export function wireEatenWidget(slotEl, id, name, onChange) {
  slotEl.innerHTML = eatenWidgetHTML(id);
  slotEl.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setEatenRating(id, name, parseInt(btn.dataset.value, 10));
      wireEatenWidget(slotEl, id, name, onChange);
      if (onChange) onChange();
    });
  });
  const clearBtn = slotEl.querySelector('.clear-eaten-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearEaten(id);
      wireEatenWidget(slotEl, id, name, onChange);
      if (onChange) onChange();
    });
  }
}

function setEatenModalStatus(msg, kind) {
  eatenModalStatusEl.textContent = msg || '';
  eatenModalStatusEl.className = 'modal-status' + (kind ? ' ' + kind : '');
  eatenModalStatusEl.hidden = !msg;
}

// 「管理吃過清單」彈窗：列出所有標記過的餐廳，可直接改評分或清除，
// 不受目前搜尋結果限制（就算這次路線沒經過那間店，也能在這裡補評分）
function renderEatenList() {
  const entries = Array.from(eatenPlaces.entries());
  eatenListEl.innerHTML = '';

  if (!entries.length) {
    eatenListEl.innerHTML = '<div class="review-empty">目前沒有標記任何已吃過的餐廳，在餐廳卡片上點星星就可以加入。</div>';
    return;
  }

  entries.sort((a, b) => (b[1].rating || 0) - (a[1].rating || 0) || (a[1].name || '').localeCompare(b[1].name || '', 'zh-Hant'));

  entries.forEach(([id, entry]) => {
    const item = document.createElement('div');
    item.className = 'eaten-list-item';

    const nameEl = document.createElement('div');
    nameEl.className = 'eaten-list-name';
    nameEl.textContent = entry.name || '(未命名)';

    const slot = document.createElement('div');
    slot.className = 'eaten-widget-slot';

    item.appendChild(nameEl);
    item.appendChild(slot);
    eatenListEl.appendChild(item);

    wireEatenWidget(slot, id, entry.name, renderEatenList);
  });
}

function openEatenModal() {
  setEatenModalStatus('');
  renderEatenList();
  eatenModalOverlayEl.hidden = false;
}

function closeEatenModal() {
  eatenModalOverlayEl.hidden = true;
}

manageEatenBtn.addEventListener('click', openEatenModal);
closeEatenModalBtn.addEventListener('click', closeEatenModal);
eatenModalOverlayEl.addEventListener('click', (e) => {
  if (e.target === eatenModalOverlayEl) closeEatenModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !eatenModalOverlayEl.hidden) closeEatenModal();
});

exportEatenBtn.addEventListener('click', () => {
  const data = Array.from(eatenPlaces, ([id, entry]) => ({ id, name: entry.name, rating: entry.rating }));
  if (!data.length) {
    setEatenModalStatus('目前沒有資料可以匯出', 'error');
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `detour-bites-eaten-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setEatenModalStatus(`已匯出 ${data.length} 筆資料`, 'ok');
});

importEatenInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('內容不是陣列');

    let imported = 0;
    arr.forEach(item => {
      if (!item || typeof item.id !== 'string' || !item.id) return;
      const rating = Math.max(0, Math.min(5, Math.round(Number(item.rating)) || 0));
      eatenPlaces.set(item.id, { name: typeof item.name === 'string' ? item.name : '', rating });
      imported++;
    });

    saveEatenPlaces();
    updateManageEatenBtnLabel();
    renderEatenList();
    setEatenModalStatus(`已匯入 ${imported} 筆吃過清單資料`, 'ok');
  } catch (err) {
    console.warn('匯入吃過清單失敗：', err);
    setEatenModalStatus('匯入失敗，請確認檔案是先前用「匯出」產生的 JSON', 'error');
  } finally {
    importEatenInput.value = '';
  }
});

// 同一個池子（舊愛池或新店池）內部要抽哪一間時用的權重：
// 沒吃過＝基準權重 1；吃過且評分 4★／5★ 時，每多一顆星機率翻倍（2^(星星-3)）；
// 吃過但評分 3★ 以下（含尚未評分）一律不列入隨機清單
function placeWeight(p) {
  if (!isEaten(p.id)) return 1;
  const rating = eatenRating(p.id);
  if (rating < EATEN_GOOD_RATING_THRESHOLD) return 0;
  return Math.pow(2, rating - 3);
}

export function weightedRandomPick(pool) {
  const weights = pool.map(placeWeight);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
