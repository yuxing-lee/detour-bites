import { APP_MODE_STORAGE_KEY } from './config.js';
import { appTitleEl, appTaglineEl, modeSwitchEl, foodPanelEl, shopPanelEl } from './dom.js';

// 側邊欄最上面的「🍜 找吃的／🛒 要買的」切換。兩個模式共用同一張地圖，
// 切換時由各自的模組（採買清單訂閱 onAppModeChange）把自己的地圖圖層放上去或收起來。
// 上次停在哪個模式會記住，打開網頁直接回到那裡；網址帶 ?mode=shop（或 #shop）也會直接開採買清單，
// 可以另外存一個主畫面捷徑專門記東西

const MODE_TEXT = {
  food: { title: '沿路美食搜尋', tagline: '找附近的餐廳，或填目的地找順路的' },
  shop: { title: '採買清單', tagline: '記下要買的，打開地圖就知道附近哪裡買得到' }
};

let mode = 'food';
let requestedInitialMode = null;
const listeners = [];

export function getAppMode() {
  return mode;
}

export function onAppModeChange(fn) {
  listeners.push(fn);
}

// 網址帶 ?add=（捷徑／Siri 加入品項）時，採買清單模組在載入時呼叫，讓初始化時直接開採買清單
export function requestInitialMode(next) {
  requestedInitialMode = next;
}

function render() {
  const text = MODE_TEXT[mode];
  appTitleEl.textContent = text.title;
  appTaglineEl.textContent = text.tagline;
  foodPanelEl.hidden = mode !== 'food';
  shopPanelEl.hidden = mode !== 'shop';
  modeSwitchEl.querySelectorAll('.mode-tab').forEach(btn => {
    const on = btn.dataset.mode === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
}

export function setAppMode(next) {
  if (next !== 'food' && next !== 'shop') return;
  const changed = next !== mode;
  mode = next;
  render();
  try {
    localStorage.setItem(APP_MODE_STORAGE_KEY, mode);
  } catch (err) {
    console.warn('儲存模式失敗：', err);
  }
  if (changed) listeners.forEach(fn => fn(mode));
}

modeSwitchEl.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => setAppMode(btn.dataset.mode));
});

// main.js 在所有模組都載入（監聽都註冊好）之後呼叫一次
export function initAppMode() {
  const params = new URLSearchParams(location.search);
  let initial = requestedInitialMode;
  if (!initial && (params.get('mode') === 'shop' || location.hash === '#shop')) initial = 'shop';
  if (!initial) {
    try {
      initial = localStorage.getItem(APP_MODE_STORAGE_KEY);
    } catch {
      initial = null;
    }
  }

  // 用過的 mode／add 參數從網址拿掉，重新整理才不會又加一次品項
  if (params.has('mode') || params.has('add') || location.hash === '#shop') {
    params.delete('mode');
    params.delete('add');
    const query = params.toString();
    const hash = location.hash === '#shop' ? '' : location.hash;
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + hash);
  }

  render();
  if (initial === 'shop') setAppMode('shop');
}
