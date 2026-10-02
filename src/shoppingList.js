import { SHOP_LIST_STORAGE_KEY, SHOP_MEMORY_STORAGE_KEY, GEMINI_API_KEY, SHOP_MAX_NAME_SEARCHES } from './config.js';
import {
  shopInputEl,
  shopAddBtn,
  shopVoiceBtn,
  shopInputNoteEl,
  shopChipsEl,
  shopListEl,
  shopDoneSectionEl,
  shopDoneSummaryEl,
  shopDoneListEl,
  shopClearDoneBtn,
  shopModeCountEl
} from './dom.js';
import { SHOP_CATEGORIES, STARTER_ITEMS } from './shopCatalog.js';
import { CATEGORY_BY_ID, splitItems, resolveItem, needsAiClassification, itemKey, stripQuantity } from './shopMatch.js';
import { classifyShoppingItems } from './gemini.js';
import { escapeHtml, debounce } from './utils.js';
import { showToast } from './ui.js';
import { onAppModeChange, requestInitialMode } from './appMode.js';
import {
  configureShopNearby,
  activateShopLayer,
  deactivateShopLayer,
  requestNearbyRefresh,
  nearbyInfoForItem,
  focusStore,
  formatDistance
} from './shopNearby.js';

// 採買清單：重點是「記下來要夠快」，太麻煩就不會用了。所以：
//   - 一個輸入框打完按 Enter 就加入，焦點留在輸入框，可以一直打下去；一次打好幾樣用頓號、逗號、換行都行
//   - 🎤 直接用說的（「牛奶、雞蛋跟衛生紙」），說完自動拆開加入
//   - 「常買」那排：買過的東西點一下就加回來
//   - 網址帶 ?add=牛奶,雞蛋 也能加入，iPhone 捷徑／Siri 可以直接呼叫（見 README）
//   - 不用自己選要去哪買：自動判斷類別，判斷錯了點一下改掉，之後同一樣東西都會記住

// 已買的品項保留一天，讓使用者還來得及反悔，之後自動清掉
const DONE_KEEP_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 200;
const AI_CACHE_LIMIT = 500;
const QUICK_CHIP_COUNT = 10;
const AI_BATCH_SIZE = 20;
const DEFAULT_PLACEHOLDER = shopInputEl.placeholder;

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.warn(`讀取 ${key} 失敗：`, err);
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`儲存 ${key} 失敗：`, err);
  }
}

function sanitizeItems(raw) {
  const now = Date.now();
  return (Array.isArray(raw) ? raw : [])
    .filter(it => it && typeof it.id === 'string' && typeof it.text === 'string' && it.text.trim())
    .map(it => ({
      id: it.id,
      text: it.text.trim(),
      done: !!it.done,
      createdAt: Number(it.createdAt) || now,
      doneAt: Number(it.doneAt) || null
    }))
    .filter(it => !it.done || !it.doneAt || now - it.doneAt < DONE_KEEP_MS);
}

// memory：learned（使用者改過的品項類別）、history（買過幾次，給「常買」用）、ai（AI 判斷過的品項類別）
function sanitizeMemory(raw) {
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { learned: obj(raw?.learned), history: obj(raw?.history), ai: obj(raw?.ai) };
}

let items = sanitizeItems(loadJson(SHOP_LIST_STORAGE_KEY, []));
const memory = sanitizeMemory(loadJson(SHOP_MEMORY_STORAGE_KEY, {}));

function saveItems() {
  saveJson(SHOP_LIST_STORAGE_KEY, items);
}

function saveMemory() {
  saveJson(SHOP_MEMORY_STORAGE_KEY, memory);
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// 同一樣東西的比對鍵：「牛奶」「牛奶 x2」「兩瓶牛奶」都是同一個
function keyOf(text) {
  return itemKey(stripQuantity(text));
}

function pendingItems() {
  return items.filter(it => !it.done);
}

// ── 新增／打勾／刪除 ──

// 剛加入的品項，下一次畫面更新時播一下進場動畫（之後重畫就不再播，不然每次更新附近的店都在閃）
let justAddedIds = new Set();

function afterChange() {
  renderList();
  scheduleAi();
  requestNearbyRefresh();
}

function addTexts(texts) {
  const pendingKeys = new Set(pendingItems().map(it => keyOf(it.text)));
  const added = [];
  const dupes = [];
  texts.forEach(text => {
    const key = keyOf(text);
    if (!key) return;
    if (pendingKeys.has(key)) {
      dupes.push(text);
      return;
    }
    pendingKeys.add(key);
    // 已買區有同一樣東西就拿掉，免得同時出現在兩邊
    items = items.filter(it => !(it.done && keyOf(it.text) === key));
    added.push({ id: newId(), text, done: false, createdAt: Date.now(), doneAt: null });
  });
  if (added.length) {
    // 新的放最上面（就在輸入框下面，打完馬上看得到），一次加好幾樣時維持說的順序
    items = [...added, ...items];
    justAddedIds = new Set(added.map(it => it.id));
    saveItems();
    afterChange();
  }
  return { added, dupes };
}

function summarizeNames(names) {
  return names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')} 等 ${names.length} 項`;
}

function announceAdded({ added, dupes }) {
  if (added.length) {
    const ids = added.map(it => it.id);
    showToast(`已加入：${summarizeNames(added.map(it => it.text))}`, {
      actionLabel: '復原',
      onAction: () => removeIds(ids)
    });
  } else if (dupes.length) {
    showToast(`「${dupes[0]}」已經在清單上了`);
  }
}

function addFromText(text, { voice = false } = {}) {
  const texts = splitItems(text, { voice, memory });
  if (!texts.length) {
    showToast('沒有認出要買的東西');
    return null;
  }
  const result = addTexts(texts);
  announceAdded(result);
  return result;
}

function removeIds(ids) {
  items = items.filter(it => !ids.includes(it.id));
  saveItems();
  afterChange();
}

// 買過的東西記到 history，「常買」那排就會出現；改回沒買就扣回去
function recordHistory(item, delta) {
  const key = keyOf(item.text);
  const prev = memory.history[key];
  if (delta > 0) {
    memory.history[key] = { text: stripQuantity(item.text), count: (prev?.count || 0) + 1, at: Date.now() };
    const keys = Object.keys(memory.history);
    if (keys.length > HISTORY_LIMIT) {
      keys.sort((a, b) => memory.history[a].at - memory.history[b].at)
        .slice(0, keys.length - HISTORY_LIMIT)
        .forEach(k => delete memory.history[k]);
    }
  } else if (prev) {
    prev.count -= 1;
    if (prev.count <= 0) delete memory.history[key];
  }
}

function toggleDone(id, { announce = false } = {}) {
  const item = items.find(it => it.id === id);
  if (!item) return;
  item.done = !item.done;
  item.doneAt = item.done ? Date.now() : null;
  recordHistory(item, item.done ? 1 : -1);
  if (editingId === id) editingId = null;
  saveItems();
  saveMemory();
  afterChange();
  if (announce && item.done) {
    showToast(`✓ ${item.text} 買到了`, { actionLabel: '復原', onAction: () => toggleDone(id) });
  }
}

// 從店家卡片或地圖上的資訊窗點品項＝在這間店買到了
function markBoughtFromStore(id) {
  const item = items.find(it => it.id === id);
  if (item && !item.done) toggleDone(id, { announce: true });
}

function deleteItem(id) {
  const index = items.findIndex(it => it.id === id);
  if (index < 0) return;
  const [removed] = items.splice(index, 1);
  if (editingId === id) editingId = null;
  saveItems();
  afterChange();
  showToast(`已刪除：${removed.text}`, {
    actionLabel: '復原',
    onAction: () => {
      items.splice(Math.min(index, items.length), 0, removed);
      saveItems();
      afterChange();
    }
  });
}

function clearDone() {
  const removed = items.filter(it => it.done);
  if (!removed.length) return;
  items = items.filter(it => !it.done);
  saveItems();
  afterChange();
  showToast(`已清除 ${removed.length} 項已買的東西`, {
    actionLabel: '復原',
    onAction: () => {
      items = [...items, ...removed];
      saveItems();
      afterChange();
    }
  });
}

// ── 類別：自動判斷、AI 備援、使用者修正 ──

const aiInFlight = new Set();
// 這次開著網頁期間 AI 失敗過的品項不再重試，改用字典的猜測或名稱搜尋
const aiFailed = new Set();

function resolutionOf(item) {
  return resolveItem(item.text, memory);
}

function isAwaitingAi(resolution) {
  return !!GEMINI_API_KEY && needsAiClassification(resolution) && !aiFailed.has(resolution.key);
}

async function runAiClassification() {
  if (!GEMINI_API_KEY) return;
  const targets = [];
  pendingItems().forEach(item => {
    const res = resolutionOf(item);
    if (!isAwaitingAi(res) || aiInFlight.has(res.key) || targets.some(t => t.key === res.key)) return;
    targets.push({ key: res.key, name: stripQuantity(item.text) });
  });
  if (!targets.length) return;
  const batch = targets.slice(0, AI_BATCH_SIZE);
  batch.forEach(t => aiInFlight.add(t.key));
  renderList();
  try {
    const { results } = await classifyShoppingItems(batch.map(t => t.name), SHOP_CATEGORIES);
    const byIndex = new Map((Array.isArray(results) ? results : []).map(r => [r.index, r.categories]));
    batch.forEach((t, i) => {
      if (!byIndex.has(i)) {
        aiFailed.add(t.key);
        return;
      }
      // 空陣列也存：代表 AI 也找不到合適的類別，之後直接用名稱搜尋，不用再問一次
      memory.ai[t.key] = (byIndex.get(i) || []).filter(c => CATEGORY_BY_ID.has(c)).slice(0, 3);
    });
    const keys = Object.keys(memory.ai);
    if (keys.length > AI_CACHE_LIMIT) keys.slice(0, keys.length - AI_CACHE_LIMIT).forEach(k => delete memory.ai[k]);
    saveMemory();
  } catch (err) {
    console.warn('AI 判斷品項類別失敗：', err);
    batch.forEach(t => aiFailed.add(t.key));
  } finally {
    batch.forEach(t => aiInFlight.delete(t.key));
    renderList();
    requestNearbyRefresh();
    if (targets.length > batch.length) scheduleAi();
  }
}

const scheduleAi = debounce(runAiClassification, 400);

// 正在編輯類別的品項 id（一次只開一個）
let editingId = null;

function saveCategories(id, selected) {
  const item = items.find(it => it.id === id);
  if (!item) return;
  const res = resolutionOf(item);
  const before = res.mode === 'name' ? [] : res.cats;
  // 保留原本的順序（第一個是最常去買的地方），新勾的接在後面
  const cats = [...before.filter(c => selected.includes(c)), ...selected.filter(c => !before.includes(c))];
  editingId = null;
  const unchanged = cats.length === before.length && cats.every((c, i) => c === before[i]) && res.mode !== 'chain';
  if (unchanged) {
    renderList();
    return;
  }
  memory.learned[res.key] = cats;
  saveMemory();
  afterChange();
  const name = stripQuantity(item.text);
  showToast(cats.length
    ? `記住了：「${name}」去${cats.map(c => CATEGORY_BY_ID.get(c).label).join('、')}找`
    : `記住了：「${name}」直接用品名在地圖上找`);
}

function resetCategories(id) {
  const item = items.find(it => it.id === id);
  if (!item) return;
  delete memory.learned[resolutionOf(item).key];
  editingId = null;
  saveMemory();
  afterChange();
  showToast(`「${stripQuantity(item.text)}」改回自動判斷`);
}

// ── 畫面 ──

function categoryButtonHtml(item, res) {
  let label;
  let tag = '';
  if (aiInFlight.has(res.key) || isAwaitingAi(res)) {
    label = '✨ AI 判斷中…';
  } else if (res.mode === 'chain') {
    label = `🏷️ 只找${escapeHtml(res.chain.label)}`;
  } else if (res.mode === 'name') {
    label = '🔎 用品名找';
  } else {
    const first = CATEGORY_BY_ID.get(res.cats[0]);
    label = `${res.cats.slice(0, 3).map(c => CATEGORY_BY_ID.get(c).emoji).join('')} ${escapeHtml(first.label)}${res.cats.length > 1 ? ' 等' : ''}`;
    if (res.source === 'ai') tag = '<span class="shop-src">AI</span>';
    if (res.source === 'guess') tag = '<span class="shop-src">猜的</span>';
  }
  return `<button type="button" class="shop-cat-btn" aria-label="修改「${escapeHtml(item.text)}」要去哪裡買" aria-expanded="${editingId === item.id}">${label}${tag}</button>`;
}

function hintHtml(item) {
  const info = nearbyInfoForItem(item.id);
  if (!info) return '';
  switch (info.state) {
    case 'loading':
      return '<span class="shop-item-hint">找附近的店…</span>';
    case 'classifying':
      return '<span class="shop-item-hint">判斷完類別再找</span>';
    case 'skipped':
      return `<span class="shop-item-hint">用品名找一次最多 ${SHOP_MAX_NAME_SEARCHES} 項，先略過</span>`;
    case 'failed':
      return '<span class="shop-item-hint warn">查詢失敗，按「重新找」再試一次</span>';
    case 'none':
      return `<span class="shop-item-hint warn">${formatDistance(info.radius)}內沒找到</span>`;
    case 'found': {
      const store = info.nearest || info.nearestClosed;
      const text = info.nearest
        ? `最近：${info.emoji || ''} ${store.name}・${formatDistance(store.distance)}`
        : `最近的 ${store.name} 已打烊`;
      return `<button type="button" class="shop-item-hint found${info.nearest ? '' : ' warn'}" data-store-id="${escapeHtml(store.id)}">${escapeHtml(text)}</button>`;
    }
    default:
      return '';
  }
}

function catEditorHtml(item, res) {
  const selected = new Set(res.mode === 'name' ? [] : res.cats);
  const learnedExists = Object.hasOwn(memory.learned, res.key);
  return `<div class="shop-cat-editor" data-for="${escapeHtml(item.id)}">`
    + `<div class="shop-cat-editor-title">「${escapeHtml(stripQuantity(item.text))}」可以去哪裡買？<span>改了會記住，下次自動套用</span></div>`
    + '<div class="shop-cat-options">'
    + SHOP_CATEGORIES.map(c => `<button type="button" class="shop-cat-option${selected.has(c.id) ? ' selected' : ''}" data-cat="${c.id}" aria-pressed="${selected.has(c.id)}" title="${escapeHtml(c.hint)}">${c.emoji} ${escapeHtml(c.label)}</button>`).join('')
    + '</div>'
    + '<div class="shop-cat-editor-note">都不選＝直接用品名在地圖上搜尋</div>'
    + '<div class="shop-cat-editor-actions">'
    + (learnedExists ? '<button type="button" class="shop-link-btn shop-cat-reset">恢復自動判斷</button>' : '')
    + '<button type="button" class="shop-cat-save">完成</button>'
    + '</div></div>';
}

function itemRowHtml(item) {
  const res = resolutionOf(item);
  const isNew = justAddedIds.has(item.id);
  const sub = item.done ? '' : `<div class="shop-item-sub">${categoryButtonHtml(item, res)}${hintHtml(item)}</div>`;
  return `<div class="shop-item${item.done ? ' done' : ''}${isNew ? ' shop-item-new' : ''}${editingId === item.id ? ' editing' : ''}" data-id="${escapeHtml(item.id)}">`
    + `<button type="button" class="shop-check" aria-label="${item.done ? '改回還沒買' : '買到了'}：${escapeHtml(item.text)}"></button>`
    + `<div class="shop-item-body"><div class="shop-item-text">${escapeHtml(item.text)}</div>${sub}</div>`
    + `<button type="button" class="shop-del" aria-label="刪除：${escapeHtml(item.text)}">✕</button>`
    + '</div>'
    + (editingId === item.id && !item.done ? catEditorHtml(item, res) : '');
}

let chipEditing = false;

function quickChips() {
  const pendingKeys = new Set(pendingItems().map(it => keyOf(it.text)));
  const fromHistory = Object.entries(memory.history)
    .filter(([key]) => !pendingKeys.has(key))
    .sort((a, b) => (b[1].count - a[1].count) || (b[1].at - a[1].at))
    .slice(0, QUICK_CHIP_COUNT)
    .map(([key, h]) => ({ key, text: h.text }));
  if (Object.keys(memory.history).length) return { label: '常買', chips: fromHistory, editable: true };
  return { label: '常見', chips: STARTER_ITEMS.filter(t => !pendingKeys.has(keyOf(t))).map(t => ({ key: keyOf(t), text: t })), editable: false };
}

function renderChips() {
  const { label, chips, editable } = quickChips();
  if (!editable) chipEditing = false;
  if (!chips.length) {
    shopChipsEl.innerHTML = '';
    return;
  }
  shopChipsEl.innerHTML = `<span class="shop-chips-label">${label}</span>`
    + chips.map(c => `<button type="button" class="shop-chip${chipEditing ? ' editing' : ''}" data-key="${escapeHtml(c.key)}" data-text="${escapeHtml(c.text)}" aria-label="${chipEditing ? `從常買移除：${escapeHtml(c.text)}` : `加入：${escapeHtml(c.text)}`}">${escapeHtml(c.text)}</button>`).join('')
    + (editable ? `<button type="button" class="shop-link-btn shop-chip-edit">${chipEditing ? '完成' : '整理'}</button>` : '');
}

function renderList() {
  const pending = pendingItems();
  const done = items.filter(it => it.done);
  shopListEl.innerHTML = pending.length
    ? pending.map(itemRowHtml).join('')
    : `<div class="shop-empty">清單是空的。打字${shopVoiceBtn.hidden ? '' : '或按 🎤 用說的'}記下要買的東西，打開地圖就會標出附近哪裡買得到。</div>`;
  shopDoneSectionEl.hidden = !done.length;
  shopDoneSummaryEl.textContent = `已買 ${done.length} 項`;
  shopDoneListEl.innerHTML = done.map(itemRowHtml).join('');
  shopModeCountEl.textContent = String(pending.length);
  shopModeCountEl.hidden = !pending.length;
  renderChips();
  justAddedIds = new Set();
}

// ── 輸入 ──

function submitInput() {
  const text = shopInputEl.value;
  if (!text.trim()) {
    shopInputEl.focus();
    return;
  }
  // 沒認出任何品項時保留原文，讓使用者自己改
  if (addFromText(text)) shopInputEl.value = '';
}

shopInputEl.addEventListener('keydown', (e) => {
  // 注音／拼音選字時按的 Enter 是在確認候選字，不能當成送出
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  submitInput();
});

shopAddBtn.addEventListener('click', () => {
  submitInput();
  shopInputEl.focus();
});

// 從 LINE、備忘錄貼上一整串清單（多行）時直接拆開加入；單行的照一般貼上
shopInputEl.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') || '';
  if (!/[\n\r]/.test(text.trim())) return;
  e.preventDefault();
  addFromText(text);
});

// 語音輸入：瀏覽器支援 Web Speech API 才顯示 🎤（Chrome、Safari 14.1+）。
// 不支援的話手機鍵盤上的麥克風一樣可以用，說完按 Enter 也會自動拆開
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function setListening(on) {
  shopVoiceBtn.classList.toggle('is-listening', on);
  shopVoiceBtn.setAttribute('aria-label', on ? '停止聆聽' : '用說的加入');
  shopInputEl.placeholder = on ? '請說要買的東西，例如「牛奶、雞蛋跟衛生紙」' : DEFAULT_PLACEHOLDER;
}

function toggleVoice() {
  if (recognition) {
    recognition.stop();
    return;
  }
  const rec = new SpeechRecognitionCtor();
  recognition = rec;
  rec.lang = 'zh-TW';
  rec.interimResults = true;
  rec.continuous = false;
  const before = shopInputEl.value;
  let finalText = '';
  let latest = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    latest = finalText + interim;
    shopInputEl.value = latest;
  };
  rec.onerror = (e) => {
    const messages = {
      'not-allowed': '沒有麥克風權限，請到瀏覽器設定允許',
      'service-not-allowed': '這個瀏覽器不能用語音輸入，可以改用鍵盤上的麥克風',
      'no-speech': '沒聽到聲音，再按一次 🎤 試試',
      'audio-capture': '找不到麥克風',
      network: '語音辨識需要網路連線'
    };
    if (messages[e.error]) showToast(messages[e.error]);
  };
  rec.onend = () => {
    recognition = null;
    setListening(false);
    // 有些瀏覽器結束時最後一段還沒標成 final，就用最後一次聽到的內容
    const text = (finalText || latest).trim();
    if (!text) {
      shopInputEl.value = before;
      return;
    }
    shopInputEl.value = '';
    addFromText(text, { voice: true });
  };
  try {
    rec.start();
    setListening(true);
  } catch (err) {
    console.warn('語音輸入啟動失敗：', err);
    recognition = null;
    showToast('語音輸入啟動失敗');
  }
}

if (SpeechRecognitionCtor) {
  shopVoiceBtn.hidden = false;
  shopInputNoteEl.textContent = '一次可以加好幾樣，用頓號、逗號或換行隔開；按 🎤 直接用說的';
  shopVoiceBtn.addEventListener('click', toggleVoice);
}

// ── 清單上的點擊 ──

function onListClick(e) {
  const editorEl = e.target.closest('.shop-cat-editor');
  if (editorEl) {
    const option = e.target.closest('.shop-cat-option');
    if (option) {
      const on = !option.classList.contains('selected');
      option.classList.toggle('selected', on);
      option.setAttribute('aria-pressed', String(on));
    } else if (e.target.closest('.shop-cat-save')) {
      saveCategories(editorEl.dataset.for, [...editorEl.querySelectorAll('.shop-cat-option.selected')].map(b => b.dataset.cat));
    } else if (e.target.closest('.shop-cat-reset')) {
      resetCategories(editorEl.dataset.for);
    }
    return;
  }
  const row = e.target.closest('.shop-item');
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('.shop-check')) {
    toggleDone(id);
  } else if (e.target.closest('.shop-del')) {
    deleteItem(id);
  } else if (e.target.closest('.shop-cat-btn')) {
    editingId = editingId === id ? null : id;
    renderList();
  } else if (e.target.closest('.shop-item-hint[data-store-id]')) {
    focusStore(e.target.closest('.shop-item-hint').dataset.storeId);
  }
}

shopListEl.addEventListener('click', onListClick);
shopDoneListEl.addEventListener('click', onListClick);
shopClearDoneBtn.addEventListener('click', clearDone);

shopChipsEl.addEventListener('click', (e) => {
  if (e.target.closest('.shop-chip-edit')) {
    chipEditing = !chipEditing;
    renderChips();
    return;
  }
  const chip = e.target.closest('.shop-chip');
  if (!chip) return;
  if (chipEditing) {
    delete memory.history[chip.dataset.key];
    saveMemory();
    renderChips();
    return;
  }
  announceAdded(addTexts([chip.dataset.text]));
});

// ── 跟採買地圖、模式切換串起來 ──

configureShopNearby({
  getItems: () => pendingItems().map(item => {
    const resolution = resolutionOf(item);
    return { id: item.id, text: item.text, resolution, awaitingAi: isAwaitingAi(resolution) };
  }),
  onUpdate: renderList,
  markBought: markBoughtFromStore
});

// 捷徑／Siri 用網址加入：?add=牛奶,雞蛋（可以重複帶好幾個 add）。內容多半是 Siri 聽寫的，
// 跟 🎤 一樣用字典切開沒有標點的長串
let pendingWelcome = null;
const addParams = new URLSearchParams(location.search).getAll('add').filter(s => s.trim());
if (addParams.length) {
  const texts = addParams.flatMap(p => splitItems(p, { voice: true, memory }));
  const { added, dupes } = addTexts(texts);
  requestInitialMode('shop');
  pendingWelcome = added.length
    ? `已從捷徑加入：${summarizeNames(added.map(it => it.text))}`
    : (dupes.length ? `「${dupes[0]}」已經在清單上了` : null);
}

onAppModeChange(mode => {
  if (mode === 'shop') {
    renderList();
    activateShopLayer();
    if (pendingWelcome) {
      showToast(pendingWelcome);
      pendingWelcome = null;
    }
    // 桌機直接可以開始打字；手機不自動跳鍵盤，免得只是想看地圖還得先收鍵盤
    if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) shopInputEl.focus();
  } else {
    editingId = null;
    deactivateShopLayer();
  }
});

renderList();
scheduleAi();
