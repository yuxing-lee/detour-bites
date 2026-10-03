import {
  GOOGLE_MAPS_API_KEY,
  SHOP_SEARCH_RADIUS_M,
  SHOP_EXPANDED_RADIUS_M,
  SHOP_CHAIN_RADIUS_M,
  SHOP_CACHE_TTL_MS,
  SHOP_CACHE_REUSE_DISTANCE_M,
  SHOP_CACHE_STORAGE_KEY,
  SHOP_UNSUPPORTED_TYPES_STORAGE_KEY,
  SHOP_STORE_FIXES_STORAGE_KEY,
  SHOP_MAX_NAME_SEARCHES,
  SHOP_MAX_STORES_SHOWN,
  SHOP_STORES_PER_ITEM
} from './config.js';
import {
  mapHintEl,
  originInput,
  shopNearbyStatusEl,
  shopRefreshBtn,
  shopPlanEl,
  shopStoreListEl,
  shopMapBarEl,
  shopMapSummaryEl,
  shopMapRefreshBtn,
  shopSearchAreaBtn
} from './dom.js';
import { mapState } from './state.js';
import { escapeHtml, mapWithConcurrency, debounce } from './utils.js';
import { SHOP_CATEGORIES, SAFE_PLACE_TYPES, CHAINS } from './shopCatalog.js';
import {
  CATEGORY_BY_ID,
  itemKey,
  searchKeysFor,
  placeAcceptedFor,
  chainCatsForPlace,
  applyStoreFix,
  storeCovers,
  haversineMeters,
  openStateAt,
  planTrip,
  stripQuantity
} from './shopMatch.js';
import { searchShopsNearby, searchShopsByText } from './placesApi.js';
import { showToast } from './ui.js';
import {
  loadGoogleMapsSDK,
  initMapIfNeeded,
  setMobileView,
  resolveLocationText,
  createShopMarker,
  createUserLocationMarker,
  setShopMarkerHighlighted,
  removeMarker,
  onMarkerClick,
  onMarkerHover,
  openSimpleInfoWindow,
  closeActiveInfoWindow,
  panForInfoWindow
} from './googleMaps.js';
import { hideSearchLayer, restoreSearchLayer } from './searchLayer.js';
import { refreshFlyoverButton } from './flyover.js';
import { exitStampMap } from './stampMap.js';

// 「附近哪裡買」：依清單上每個品項需要的店家類別，各查一次附近的店（同一類只查一次、結果快取），
// 合併成「哪間店買得到哪些東西」，算出建議路線，畫在採買地圖跟側邊欄。
// 清單本身（新增、打勾、改類別）在 shoppingList.js，這裡透過 configureShopNearby 拿品項、回報結果。

const SHOP_MOBILE_QUERY = '(max-width: 860px)';
// 地圖拖離目前搜尋中心這麼遠，才出現「搜尋這一帶」
const AREA_BUTTON_MIN_MOVE_M = 400;
// 定位結果沿用多久（清單一改就要重算，不用每次都重新定位）
const GPS_REUSE_MS = 2 * 60 * 1000;
// 每個品項先只查前兩個最常買到的類別：電池在便利商店就買得到，不用每次都連五金行、3C 一起查；
// 其他類別常常已經因為別的品項查過了（店家只要類別對得上就算數），真的找不到有開的店才補查剩下的
const PRIMARY_CATEGORY_COUNT = 2;
// 對焦時最多放大到這個層級，免得最近的店就在旁邊時整個畫面只剩一條街
const SHOP_FIT_MAX_ZOOM = 17;
const CACHE_MAX_ENTRIES = 40;
// 被 Google 拒絕的類型記多久；過了再試一次，Google 之後開放了就會自動用上
const UNSUPPORTED_TYPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 「標錯了」最多記幾間，超過就丟掉最舊的
const STORE_FIXES_MAX_ENTRIES = 300;

let getItems = () => [];
let onUpdate = () => {};
let markBought = () => {};

let active = false;
let layerEntered = false;
let dragListener = null;
// phase：idle（還沒開始）、nokey、empty（清單是空的）、loading、ready、error
let phase = 'idle';
let loadingText = '';
let errorMessage = '';
let locationFailed = false;
let current = null;
let refreshToken = 0;
let lastGps = null;
// 「搜尋這一帶」選的中心；null 代表用目前位置
let areaCenter = null;
let markers = [];
let meMarker = null;
// Google 回 400 但看不出是哪個類型的搜尋，這次開著網頁期間直接只用 SAFE_PLACE_TYPES 裡的類型
const safeTypeKeys = new Set();
// 同一個 key 同時只送一個請求（清單連續變動觸發好幾次重算時，不重複計費）
const inflight = new Map();

export function configureShopNearby({ getItems: itemsFn, onUpdate: updateFn, markBought: boughtFn }) {
  getItems = itemsFn;
  onUpdate = updateFn;
  markBought = boughtFn;
}

// ── 快取 ──

function loadCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOP_CACHE_STORAGE_KEY) || '{}');
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, e]) => e && Array.isArray(e.places) && now - e.at < SHOP_CACHE_TTL_MS));
  } catch {
    return {};
  }
}

let cache = loadCache();

function saveCache() {
  try {
    localStorage.setItem(SHOP_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('儲存附近店家快取失敗：', err);
  }
}

function getCached(key, center) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.at > SHOP_CACHE_TTL_MS) return null;
  if (haversineMeters(center, entry) > SHOP_CACHE_REUSE_DISTANCE_M) return null;
  return entry;
}

function putCache(entry) {
  cache[entry.key] = entry;
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX_ENTRIES) {
    keys.sort((a, b) => cache[a].at - cache[b].at)
      .slice(0, keys.length - CACHE_MAX_ENTRIES)
      .forEach(k => delete cache[k]);
  }
  saveCache();
}

// ── 不被接受的店家類型 ──
// 類別定義裡有幾個是 2025 年才加的新類型，萬一這把 key 的 Places API 還不認得，Google 會整個請求回 400。
// 從錯誤訊息（Unsupported types: xxx）挑出被拒絕的類型，只拿掉那幾個重查，並記下來，重新整理後也不會再白送一次

function loadUnsupportedTypes() {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOP_UNSUPPORTED_TYPES_STORAGE_KEY) || '{}');
    const now = Date.now();
    return new Map(Object.entries(raw).filter(([, at]) => now - at < UNSUPPORTED_TYPE_TTL_MS));
  } catch {
    return new Map();
  }
}

const unsupportedTypes = loadUnsupportedTypes();

function rememberUnsupportedTypes(types) {
  types.forEach(t => unsupportedTypes.set(t, Date.now()));
  try {
    localStorage.setItem(SHOP_UNSUPPORTED_TYPES_STORAGE_KEY, JSON.stringify(Object.fromEntries(unsupportedTypes)));
  } catch (err) {
    console.warn('儲存不支援的店家類型失敗：', err);
  }
}

function parseUnsupportedTypes(errorText) {
  const match = /unsupported types?:\s*([a-z0-9_,\s]+)/i.exec(errorText || '');
  return match ? match[1].split(/[\s,]+/).filter(Boolean) : [];
}

// ── 使用者回報標錯的店 ──
// Google 上的店家類型是店家自己選的，標錯的店名稱比對也擋不完。使用者在店家卡片按「標錯了？」，
// 選「不是這一類」「沒賣這個」或「整間不要再出現」，記在這裡，之後整理結果時套用（見 shopMatch.js 的 applyStoreFix）

function loadStoreFixes() {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOP_STORE_FIXES_STORAGE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

let storeFixes = loadStoreFixes();
// 狀態列「已排除 N 間」的清單有沒有展開
let fixesOpen = false;

function saveStoreFixes() {
  const ids = Object.keys(storeFixes);
  if (ids.length > STORE_FIXES_MAX_ENTRIES) {
    ids.sort((a, b) => (storeFixes[a].at || 0) - (storeFixes[b].at || 0))
      .slice(0, ids.length - STORE_FIXES_MAX_ENTRIES)
      .forEach(id => delete storeFixes[id]);
  }
  try {
    localStorage.setItem(SHOP_STORE_FIXES_STORAGE_KEY, JSON.stringify(storeFixes));
  } catch (err) {
    console.warn('儲存標錯的店家失敗：', err);
  }
}

// ── 搜尋 ──

function splitKey(key) {
  const i = key.indexOf(':');
  return [key.slice(0, i), key.slice(i + 1)];
}

function categoriesForSearchKey(searchKey) {
  return SHOP_CATEGORIES.filter(c => c.search.key === searchKey);
}

// key 的格式：cat:<類別搜尋 key>、chain:<連鎖店 id>、name:<品項比對鍵>（query 是給人看得懂的品名）
function searchSpecFor(key, query) {
  const [kind, id] = splitKey(key);
  if (kind === 'cat') {
    const s = categoriesForSearchKey(id)[0].search;
    return s.query
      ? { method: 'text', query: s.query, radius: SHOP_SEARCH_RADIUS_M, expandTo: SHOP_EXPANDED_RADIUS_M }
      : { method: 'nearby', types: s.types, primaryTypes: s.primaryTypes, radius: SHOP_SEARCH_RADIUS_M, expandTo: SHOP_EXPANDED_RADIUS_M };
  }
  if (kind === 'chain') {
    const chain = CHAINS.find(c => c.id === id);
    return { method: 'text', query: chain.query, radius: SHOP_CHAIN_RADIUS_M };
  }
  return { method: 'text', query: query || id, radius: SHOP_SEARCH_RADIUS_M, expandTo: SHOP_EXPANDED_RADIUS_M };
}

function typesFor(spec, key) {
  const keep = t => !unsupportedTypes.has(t) && (!safeTypeKeys.has(key) || SAFE_PLACE_TYPES.has(t));
  return { types: spec.types?.filter(keep), primaryTypes: spec.primaryTypes?.filter(keep) };
}

const typeCount = t => (t.types?.length ?? 0) + (t.primaryTypes?.length ?? 0);

async function runSpec(key, spec, center, radius) {
  if (spec.method === 'text') return searchShopsByText({ center, radius, query: spec.query });
  const first = typesFor(spec, key);
  if (!typeCount(first)) return { ok: true, status: 200, places: [] };
  let res = await searchShopsNearby({ center, radius, ...first });
  if (res.ok || res.status !== 400) return res;

  const rejected = parseUnsupportedTypes(res.errorText);
  if (rejected.length) {
    rememberUnsupportedTypes(rejected);
  } else {
    safeTypeKeys.add(key);
  }
  const retry = typesFor(spec, key);
  if (!typeCount(retry) || typeCount(retry) === typeCount(first)) return res;
  console.warn(`「${key}」有 Google 不認得的類型（${rejected.join(', ') || '不明'}），拿掉後重查`);
  return searchShopsNearby({ center, radius, ...retry });
}

// 只留判斷跟顯示要用的欄位（也是存進快取的格式）；歇業的店直接丟掉
function compactPlace(p) {
  if (!p.id || !p.location) return null;
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return null;
  const oh = p.currentOpeningHours;
  return {
    id: p.id,
    name: p.displayName?.text || '(未命名)',
    lat: p.location.latitude,
    lng: p.location.longitude,
    address: p.shortFormattedAddress || '',
    typeLabel: p.primaryTypeDisplayName?.text || '',
    primaryType: p.primaryType || '',
    mapsUri: p.googleMapsUri || '',
    hours: oh && typeof oh.openNow === 'boolean' ? {
      openNow: oh.openNow,
      nextOpenTime: oh.nextOpenTime || null,
      nextCloseTime: oh.nextCloseTime || null,
      // 全年無休 24 小時的店只有一個開始時間、沒有結束時間
      is24h: Array.isArray(oh.periods) && oh.periods.length === 1 && !!oh.periods[0].open && !oh.periods[0].close
    } : null
  };
}

// 這次搜尋結果裡，有幾間是這個 key 真的用得到的（類別有通過 accept、連鎖店名對得上）
function usefulCount(key, places, center, radius) {
  const [kind, id] = splitKey(key);
  // 使用者標過「整間不要」的店不算，附近的都被排除時才會放大範圍找
  const inRange = places.filter(p => haversineMeters(center, p) <= radius && !storeFixes[p.id]?.all);
  if (kind === 'cat') {
    const served = categoriesForSearchKey(id);
    return inRange.filter(p => {
      const facts = { nameKey: itemKey(p.name), primaryType: p.primaryType };
      const notCats = storeFixes[p.id]?.cats || [];
      return served.some(c => !notCats.includes(c.id) && placeAcceptedFor(c.id, facts));
    }).length;
  }
  if (kind === 'chain') {
    const chain = CHAINS.find(c => c.id === id);
    return inRange.filter(p => (chain.placeRe || chain.re).test(itemKey(p.name))).length;
  }
  return inRange.filter(p => !storeFixes[p.id]?.names?.includes(id)).length;
}

async function fetchKey(key, query, center) {
  const spec = searchSpecFor(key, query);
  let radius = spec.radius;
  let res = await runSpec(key, spec, center, radius);
  let places = res.ok ? res.places.map(compactPlace).filter(Boolean) : [];
  // 預設範圍內一間都沒有，放大範圍再找一次：「附近沒有五金行」時至少告訴使用者最近的在哪
  if (res.ok && spec.expandTo && usefulCount(key, places, center, radius) === 0) {
    radius = spec.expandTo;
    res = await runSpec(key, spec, center, radius);
    places = res.ok ? res.places.map(compactPlace).filter(Boolean) : [];
  }
  const entry = { key, lat: center.lat, lng: center.lng, at: Date.now(), radius, places, failed: !res.ok };
  // 失敗的不快取，下次重新整理會再試
  if (res.ok) putCache(entry);
  return entry;
}

function fetchKeyOnce(key, query, center) {
  const flightKey = `${key}@${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
  if (!inflight.has(flightKey)) {
    inflight.set(flightKey, fetchKey(key, query, center).finally(() => inflight.delete(flightKey)));
  }
  return inflight.get(flightKey);
}

// ── 定位 ──

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('這個瀏覽器不支援定位'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

// 搜尋中心：使用者在地圖上選了「搜尋這一帶」就用那裡；否則用目前位置；
// 定位失敗時退回美食搜尋的「起點」欄位（可能是上次的地址），都沒有才放棄
async function resolveCenter(force) {
  if (areaCenter) return { ...areaCenter, source: 'area' };
  if (!force && lastGps && Date.now() - lastGps.at < GPS_REUSE_MS) return { ...lastGps, source: 'gps' };
  try {
    const pos = await getCurrentPosition();
    lastGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
    return { ...lastGps, source: 'gps' };
  } catch (err) {
    const originText = originInput.value.trim();
    if (originText) {
      try {
        const ll = await resolveLocationText(originText);
        return { lat: ll.lat(), lng: ll.lng(), source: 'origin' };
      } catch (geoErr) {
        console.warn('起點欄位的地址解析失敗：', geoErr);
      }
    }
    const e = new Error(err?.code === 1 ? '沒有定位權限，抓不到你在哪' : '目前抓不到你的位置');
    e.locationFailed = true;
    throw e;
  }
}

// ── 整理結果 ──

function storeEmoji(store, items) {
  const tally = new Map();
  items.forEach(it => {
    if (!store.itemIds.includes(it.id)) return;
    it.resolution.cats.forEach(c => {
      if (store.cats.has(c)) tally.set(c, (tally.get(c) || 0) + 1);
    });
  });
  let best = null;
  tally.forEach((n, c) => {
    if (!best || n > best[1]) best = [c, n];
  });
  const catId = best?.[0] || [...store.cats][0];
  return catId ? CATEGORY_BY_ID.get(catId).emoji : '🔎';
}

function buildResult(items, center, entries, skippedKeys) {
  const now = Date.now();
  const stores = new Map();
  const failedKeys = new Set();
  const radiusByKey = new Map();
  entries.forEach(entry => {
    radiusByKey.set(entry.key, entry.radius);
    if (entry.failed) {
      failedKeys.add(entry.key);
      return;
    }
    const [kind, id] = splitKey(entry.key);
    const served = kind === 'cat' ? categoriesForSearchKey(id) : [];
    entry.places.forEach(cp => {
      const distance = haversineMeters(center, cp);
      // 快取可能是在幾百公尺外查的，超出範圍的店不算「附近」
      if (distance > entry.radius + SHOP_CACHE_REUSE_DISTANCE_M) return;
      let store = stores.get(cp.id);
      if (!store) {
        store = { ...cp, nameKey: itemKey(cp.name), distance, cats: new Set(), hits: new Set() };
        stores.set(cp.id, store);
      }
      store.hits.add(entry.key);
      const facts = { nameKey: store.nameKey, primaryType: store.primaryType };
      served.forEach(c => {
        if (placeAcceptedFor(c.id, facts)) store.cats.add(c.id);
      });
    });
  });
  // 連鎖店補上的類別也一樣可以被使用者的修正拿掉（例如某間寶雅其實沒賣文具）
  const all = [...stores.values()].filter(store => {
    chainCatsForPlace(store.nameKey).forEach(c => store.cats.add(c));
    store.open = openStateAt(store.hours, now);
    return applyStoreFix(store, storeFixes[store.id]);
  });

  const searchable = items.filter(it => !it.awaitingAi);
  const coverage = new Map();
  searchable.forEach(it => {
    coverage.set(it.id, all.filter(s => storeCovers(s, it.resolution)).sort((a, b) => a.distance - b.distance));
  });
  all.forEach(store => {
    store.itemIds = searchable.filter(it => coverage.get(it.id).includes(store)).map(it => it.id);
  });
  const candidates = all.filter(s => s.itemIds.length);
  candidates.forEach(store => { store.emoji = storeEmoji(store, searchable); });

  const plan = planTrip(searchable.filter(it => coverage.get(it.id).length), candidates, center);
  const stepOf = new Map(plan.map((step, i) => [step.store.id, i + 1]));

  // 地圖跟清單只放：建議路線上的店，加上每個品項最近幾間有開的店（都打烊的話放最近的那間）
  const shown = new Set(plan.map(step => step.store));
  searchable.forEach(it => {
    const list = coverage.get(it.id);
    const usable = list.filter(s => s.open.state !== 'closed');
    usable.slice(0, SHOP_STORES_PER_ITEM).forEach(s => shown.add(s));
    if (!usable.length && list.length) shown.add(list[0]);
  });
  const shownList = [...shown].sort((a, b) => {
    const sa = stepOf.get(a.id) || Infinity;
    const sb = stepOf.get(b.id) || Infinity;
    if (sa !== sb) return sa - sb;
    if (b.itemIds.length !== a.itemIds.length) return b.itemIds.length - a.itemIds.length;
    return a.distance - b.distance;
  }).slice(0, SHOP_MAX_STORES_SHOWN);
  shownList.forEach(store => { store.step = stepOf.get(store.id) || 0; });

  const itemStatus = new Map();
  items.forEach(it => {
    if (it.awaitingAi) {
      itemStatus.set(it.id, { state: 'classifying' });
      return;
    }
    const keys = searchKeysFor(it.resolution);
    if (keys.every(k => skippedKeys.has(k))) {
      itemStatus.set(it.id, { state: 'skipped' });
      return;
    }
    const list = coverage.get(it.id);
    if (!list.length) {
      const failed = keys.some(k => failedKeys.has(k));
      const radius = Math.max(SHOP_SEARCH_RADIUS_M, ...keys.map(k => radiusByKey.get(k) || 0));
      itemStatus.set(it.id, { state: failed ? 'failed' : 'none', radius });
      return;
    }
    const nearest = list.find(s => s.open.state !== 'closed') || null;
    const store = nearest || list[0];
    // 圖示用「這個品項是靠哪一類買到的」：寶雅同時賣文具跟五金，螺絲起子旁邊應該顯示 🏠 不是 ✏️
    const matchedCat = it.resolution.cats.find(c => store.cats.has(c));
    const emoji = matchedCat ? CATEGORY_BY_ID.get(matchedCat).emoji : store.emoji;
    itemStatus.set(it.id, { state: 'found', nearest, nearestClosed: nearest ? null : list[0], emoji });
  });

  const coveredCount = searchable.filter(it => coverage.get(it.id).some(s => s.open.state !== 'closed')).length;
  return { center, plan, shown: shownList, itemStatus, coveredCount, total: items.length, failedCount: failedKeys.size };
}

// ── 顯示用的小工具 ──

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} 公尺`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} 公里`;
}

const timeFormat = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

function dayPrefix(ts, now) {
  const startOfDay = t => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diffDays = Math.round((startOfDay(ts) - startOfDay(now)) / 86400000);
  if (diffDays <= 0) return '';
  if (diffDays === 1) return '明天 ';
  return `週${'日一二三四五六'[new Date(ts).getDay()]} `;
}

// 營業狀態的文字跟樣式：營業中・22:00 關、快打烊・21:30 關（剩不到 45 分鐘）、已打烊・明天 08:00 開
export function storeOpenLabel(open, now = Date.now()) {
  if (!open || open.state === 'unknown') return { text: '', cls: '' };
  if (open.state === 'open') {
    if (open.is24h) return { text: '24 小時營業', cls: 'open' };
    if (open.closeAt) {
      const soon = open.closeAt - now < 45 * 60 * 1000;
      return { text: `${soon ? '快打烊' : '營業中'}・${dayPrefix(open.closeAt, now)}${timeFormat.format(open.closeAt)} 關`, cls: soon ? 'soon' : 'open' };
    }
    return { text: '營業中', cls: 'open' };
  }
  if (open.openAt) return { text: `已打烊・${dayPrefix(open.openAt, now)}${timeFormat.format(open.openAt)} 開`, cls: 'closed' };
  return { text: '已打烊', cls: 'closed' };
}

function navUrl(stores) {
  const stops = stores.slice(0, 4);
  const last = stops[stops.length - 1];
  const params = new URLSearchParams({ api: '1', destination: `${last.lat},${last.lng}`, destination_place_id: last.id });
  const via = stops.slice(0, -1);
  // 不帶 origin：Google 地圖會從使用者目前位置出發。手機版最多只吃 3 個中途點，所以總共最多 4 站
  if (via.length) {
    params.set('waypoints', via.map(s => `${s.lat},${s.lng}`).join('|'));
    params.set('waypoint_place_ids', via.map(s => s.id).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function itemTextsById() {
  return new Map(getItems().map(it => [it.id, stripQuantity(it.text)]));
}

// ── 「標錯了？」 ──

// 這間店是靠哪些類別、哪些品名搜尋被列進來的，就針對那個說「不是」；最後一定有「整間不要再出現」
function reportOptionsFor(store) {
  const texts = itemTextsById();
  const options = [];
  const seen = new Set();
  getItems().forEach(it => {
    if (!store.itemIds.includes(it.id) || !it.resolution) return;
    const r = it.resolution;
    if (r.mode === 'cats') {
      r.cats.forEach(c => {
        if (!store.cats.has(c) || seen.has(`cat:${c}`)) return;
        seen.add(`cat:${c}`);
        const cat = CATEGORY_BY_ID.get(c);
        options.push({ kind: 'cat', value: c, label: `不是${cat.emoji}${cat.label}` });
      });
    } else if (r.mode === 'name' && store.hits.has(`name:${r.key}`) && !seen.has(`name:${r.key}`)) {
      seen.add(`name:${r.key}`);
      options.push({ kind: 'name', value: r.key, label: `沒賣「${texts.get(it.id)}」` });
    }
  });
  options.push({ kind: 'all', value: '', label: '整間不要再出現' });
  return options;
}

function reportMenuHtml(store) {
  return '<div class="shop-report-title">這間店標錯了？選一個，之後就不會再推薦：</div>'
    + reportOptionsFor(store).map(o => `<button type="button" class="shop-report-opt" data-store-id="${escapeHtml(store.id)}" data-kind="${o.kind}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>`).join('');
}

function describeFix(fix) {
  if (fix.all) return '整間不要';
  const parts = (fix.cats || []).map(c => `不是${CATEGORY_BY_ID.get(c)?.label || c}`)
    .concat((fix.names || []).map(k => `沒賣「${k}」`));
  return parts.join('、');
}

function reportStore(storeId, kind, value) {
  const store = current?.shown.find(s => s.id === storeId);
  if (!store) return;
  const prev = storeFixes[storeId] ? structuredClone(storeFixes[storeId]) : null;
  const fix = { ...(prev || {}), name: store.name, at: Date.now() };
  let message;
  if (kind === 'all') {
    fix.all = true;
    message = `之後不會再列出「${store.name}」`;
  } else if (kind === 'cat') {
    fix.cats = [...new Set([...(fix.cats || []), value])];
    message = `「${store.name}」之後不會再當成${CATEGORY_BY_ID.get(value)?.label || value}`;
  } else {
    fix.names = [...new Set([...(fix.names || []), value])];
    message = `之後找「${value}」不會再列出「${store.name}」`;
  }
  storeFixes[storeId] = fix;
  saveStoreFixes();
  closeActiveInfoWindow();
  showToast(message, {
    actionLabel: '復原',
    onAction: () => {
      if (prev) storeFixes[storeId] = prev;
      else delete storeFixes[storeId];
      saveStoreFixes();
      refreshNearby();
    }
  });
  // 已經查過的類別都在快取裡，重算不會多花 API；排除後附近真的沒有了才會補查其他類別
  refreshNearby();
}

function restoreStoreFix(placeId) {
  if (placeId) delete storeFixes[placeId];
  else storeFixes = {};
  saveStoreFixes();
  if (!Object.keys(storeFixes).length) fixesOpen = false;
  refreshNearby();
}

// ── 側邊欄 ──

function centerLabel(source) {
  if (source === 'area') return '地圖上選的區域';
  if (source === 'origin') return '起點欄位的位置附近';
  return '目前位置附近';
}

function renderStatus() {
  shopRefreshBtn.disabled = phase === 'loading';
  shopMapRefreshBtn.disabled = phase === 'loading';
  let html = '';
  if (phase === 'nokey') {
    html = '要先設定 Google Maps API key 才能找附近的店；清單可以先記著。';
  } else if (phase === 'empty') {
    html = '清單是空的。加入要買的東西後，這裡會列出附近哪裡買得到。';
  } else if (phase === 'loading') {
    html = `<span class="shop-spinner" aria-hidden="true"></span>${escapeHtml(loadingText)}`;
  } else if (phase === 'error') {
    html = `<span class="shop-status-error">${escapeHtml(errorMessage)}</span>`
      + (locationFailed ? '<div class="shop-status-sub">可以把地圖拖到想找的地方，按「🔍 搜尋這一帶」。</div>' : '');
  } else if (phase === 'ready' && current) {
    html = `📍 ${centerLabel(current.center.source)}・${current.coveredCount}/${current.total} 項買得到`;
    if (current.center.source === 'area') html += ' <button type="button" class="shop-link-btn shop-back-to-gps">改回目前位置</button>';
    if (current.failedCount) html += '<div class="shop-status-sub shop-status-error">有些類別查詢失敗，按「重新找」再試一次。</div>';
  }
  html += fixesHtml();
  shopNearbyStatusEl.innerHTML = html;
}

// 「已排除 N 間標錯的店」：展開可以逐間還原
function fixesHtml() {
  if (phase !== 'ready' && phase !== 'loading') return '';
  const entries = Object.entries(storeFixes);
  if (!entries.length) return '';
  let html = `<div class="shop-status-sub">🚫 已排除 ${entries.length} 間標錯的店 <button type="button" class="shop-link-btn shop-fixes-toggle">${fixesOpen ? '收起' : '查看'}</button></div>`;
  if (!fixesOpen) return html;
  html += '<ul class="shop-fix-list">';
  entries.sort(([, a], [, b]) => (b.at || 0) - (a.at || 0)).forEach(([id, fix]) => {
    html += `<li><span class="shop-fix-name">${escapeHtml(fix.name || '(未命名)')}</span><span class="shop-fix-what">${escapeHtml(describeFix(fix))}</span>`
      + `<button type="button" class="shop-link-btn shop-fix-undo" data-place-id="${escapeHtml(id)}">還原</button></li>`;
  });
  html += '</ul>';
  if (entries.length > 1) html += '<button type="button" class="shop-link-btn shop-fix-undo" data-place-id="">全部還原</button>';
  return html;
}

// 重新整理期間（phase 是 loading）繼續顯示上一次的結果，不要每加一樣東西整塊就閃一下
function showingResult() {
  return !!current && (phase === 'ready' || phase === 'loading');
}

function renderPlan() {
  if (!showingResult()) {
    shopPlanEl.innerHTML = '';
    return;
  }
  const texts = itemTextsById();
  const { plan, itemStatus } = current;
  const missing = [];
  const closedOnly = [];
  itemStatus.forEach((status, id) => {
    if (!texts.has(id)) return;
    if (status.state === 'none') missing.push({ text: texts.get(id), radius: status.radius });
    if (status.state === 'found' && !status.nearest) closedOnly.push(texts.get(id));
  });
  const boughtCount = plan.reduce((n, step) => n + step.itemIds.length, 0);
  let html = '';
  if (plan.length) {
    const allDone = boughtCount === current.total;
    const title = allDone
      ? (plan.length === 1 ? '🧭 一間就買齊' : `🧭 跑 ${plan.length} 間就買齊`)
      : `🧭 跑 ${plan.length} 間可以買到 ${boughtCount}/${current.total} 項`;
    html += `<div class="shop-plan"><div class="shop-plan-title">${title}</div><ol class="shop-plan-steps">`;
    plan.forEach((step, i) => {
      const s = step.store;
      const open = storeOpenLabel(s.open);
      html += `<li class="shop-plan-step" data-store-id="${escapeHtml(s.id)}">`
        + `<span class="shop-plan-num">${i + 1}</span>`
        + `<div class="shop-plan-body"><div class="shop-plan-store">${s.emoji} ${escapeHtml(s.name)}</div>`
        + `<div class="shop-plan-meta">${formatDistance(s.distance)}${open.text ? `・<span class="shop-open ${open.cls}">${escapeHtml(open.text)}</span>` : ''}</div>`
        + `<div class="shop-plan-items">${step.itemIds.filter(id => texts.has(id)).map(id => escapeHtml(texts.get(id))).join('、')}</div></div></li>`;
    });
    html += `</ol><a class="shop-plan-nav" href="${escapeHtml(navUrl(plan.map(step => step.store)))}" target="_blank" rel="noopener noreferrer">${plan.length > 1 ? `依序導航 ${Math.min(plan.length, 4)} 站 →` : '導航過去 →'}</a>`;
  } else {
    html += '<div class="shop-plan shop-plan-empty">';
  }
  if (closedOnly.length) html += `<div class="shop-plan-note">附近只找到打烊的店：${closedOnly.map(escapeHtml).join('、')}</div>`;
  if (missing.length) {
    const radius = Math.max(...missing.map(m => m.radius));
    html += `<div class="shop-plan-note">${formatDistance(radius)}內沒找到：${missing.map(m => escapeHtml(m.text)).join('、')}<span class="shop-plan-hint">（點品項旁的類別可以換一類店找）</span></div>`;
  }
  html += '</div>';
  shopPlanEl.innerHTML = plan.length || closedOnly.length || missing.length ? html : '';
}

function renderStoreList() {
  if (!showingResult() || !current.shown.length) {
    shopStoreListEl.innerHTML = '';
    return;
  }
  const texts = itemTextsById();
  shopStoreListEl.innerHTML = '<div class="shop-store-caption">點店家看地圖；在店裡買到了，點品項就會打勾</div>'
    + current.shown.map(s => {
      const open = storeOpenLabel(s.open);
      const itemButtons = s.itemIds
        .filter(id => texts.has(id))
        .map(id => `<button type="button" class="shop-store-item" data-item-id="${escapeHtml(id)}" title="買到了就點一下">${escapeHtml(texts.get(id))}</button>`)
        .join('');
      return `<div class="shop-store${s.step ? ' plan' : ''}${s.open.state === 'closed' ? ' closed' : ''}" data-store-id="${escapeHtml(s.id)}">`
        + `<div class="shop-store-name">${s.step ? `<span class="shop-store-step">${s.step}</span>` : ''}${s.emoji} ${escapeHtml(s.name)}</div>`
        + `<div class="shop-store-meta"><span class="shop-store-dist">${formatDistance(s.distance)}</span>`
        + (s.typeLabel ? `<span>${escapeHtml(s.typeLabel)}</span>` : '')
        + (open.text ? `<span class="shop-open ${open.cls}">${escapeHtml(open.text)}</span>` : '')
        + (s.address ? `<span>${escapeHtml(s.address)}</span>` : '')
        + '</div>'
        + `<div class="shop-store-items">${itemButtons}</div>`
        + `<div class="shop-store-actions"><a class="shop-store-nav" href="${escapeHtml(navUrl([s]))}" target="_blank" rel="noopener noreferrer">導航 →</a>`
        + (s.mapsUri ? `<a class="shop-store-gmaps" href="${escapeHtml(s.mapsUri)}" target="_blank" rel="noopener noreferrer">店家資訊</a>` : '')
        + '<button type="button" class="shop-link-btn shop-store-report">標錯了？</button>'
        + '</div><div class="shop-report-menu" hidden></div></div>';
    }).join('');
}

function renderMapBar() {
  let text = '';
  if (phase === 'nokey') text = '🛒 設定 API key 後會標出附近哪裡買';
  else if (phase === 'empty') text = '🛒 清單是空的，先記下要買的東西';
  else if (phase === 'loading') text = `🛒 ${loadingText}`;
  else if (phase === 'error') text = `🛒 ${errorMessage}`;
  else if (phase === 'ready' && current) {
    text = current.coveredCount
      ? `🛒 ${current.coveredCount}/${current.total} 項附近買得到${current.plan.length ? `・建議跑 ${current.plan.length} 間` : ''}`
      : '🛒 附近沒找到清單上的東西';
  }
  shopMapSummaryEl.textContent = text;
}

function renderAll() {
  renderStatus();
  renderPlan();
  renderStoreList();
  renderMapBar();
  onUpdate();
}

// ── 地圖 ──

function clearShopMarkers() {
  markers.forEach(m => removeMarker(m.marker));
  markers = [];
  if (meMarker) {
    removeMarker(meMarker);
    meMarker = null;
  }
}

function storeInfoHtml(store) {
  const texts = itemTextsById();
  const open = storeOpenLabel(store.open);
  const openColor = { open: '#1a7a4c', soon: '#b36b00', closed: '#b3261e' }[open.cls] || '#5a6180';
  const items = store.itemIds.filter(id => texts.has(id));
  const itemButtons = items.map(id => `<button type="button" class="iw-shop-buy" data-item-id="${escapeHtml(id)}" style="margin:2px 4px 2px 0;width:auto;padding:3px 9px;border-radius:999px;border:1px solid #c9b48a;background:#fff7e6;color:#1b2140;font-size:12px;font-weight:600;cursor:pointer;">${escapeHtml(texts.get(id))}</button>`).join('');
  return `<div style="color:#1b2140;font-size:13px;line-height:1.6;max-width:240px;">`
    + `<div style="font-weight:700;font-size:14px;margin-bottom:2px;">${store.emoji} ${escapeHtml(store.name)}</div>`
    + `<div style="color:#5a6180;">${[formatDistance(store.distance), escapeHtml(store.typeLabel)].filter(Boolean).join('・')}</div>`
    + (open.text ? `<div style="color:${openColor};font-weight:700;">${escapeHtml(open.text)}</div>` : '')
    + (items.length ? `<div style="margin-top:4px;color:#5a6180;font-size:12px;">可以買（買到了就點）：</div><div>${itemButtons}</div>` : '')
    + `<div style="margin-top:6px;"><a href="${escapeHtml(navUrl([store]))}" target="_blank" rel="noopener noreferrer" style="color:#8a5a1f;font-weight:700;text-decoration:underline;">導航 →</a>`
    + (store.mapsUri ? `<a href="${escapeHtml(store.mapsUri)}" target="_blank" rel="noopener noreferrer" style="margin-left:10px;color:#8a5a1f;font-weight:700;text-decoration:underline;">店家資訊</a>` : '')
    + `<button type="button" class="iw-shop-report" style="margin-left:10px;width:auto;padding:0;border:0;background:none;color:#5a6180;font-size:12px;text-decoration:underline;cursor:pointer;">標錯了？</button>`
    + `</div><div class="iw-shop-report-menu"></div></div>`;
}

// 資訊視窗裡的「標錯了？」選項（地圖上的 InfoWindow 吃不到側邊欄的 CSS，樣式寫在行內）
function infoReportMenuHtml(store) {
  return '<div style="margin-top:6px;color:#5a6180;font-size:12px;">這間店標錯了？選一個，之後就不會再推薦：</div>'
    + reportOptionsFor(store).map(o => `<button type="button" class="iw-shop-report-opt" data-kind="${o.kind}" data-value="${escapeHtml(o.value)}" style="margin:3px 4px 0 0;width:auto;padding:3px 9px;border-radius:999px;border:1px solid #d9a3a3;background:#fff1f0;color:#8a2a1f;font-size:12px;font-weight:600;cursor:pointer;">${escapeHtml(o.label)}</button>`).join('');
}

function openStoreInfo(store, marker) {
  const infoWindow = openSimpleInfoWindow(storeInfoHtml(store), marker);
  google.maps.event.addListenerOnce(infoWindow, 'domready', () => {
    document.querySelectorAll('.iw-shop-buy').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.style.textDecoration = 'line-through';
        btn.style.opacity = '0.6';
        markBought(btn.dataset.itemId);
      });
    });
    const reportBtn = document.querySelector('.iw-shop-report');
    const menu = document.querySelector('.iw-shop-report-menu');
    reportBtn?.addEventListener('click', () => {
      reportBtn.hidden = true;
      menu.innerHTML = infoReportMenuHtml(store);
      menu.querySelectorAll('.iw-shop-report-opt').forEach(opt => {
        opt.addEventListener('click', () => reportStore(store.id, opt.dataset.kind, opt.dataset.value));
      });
    });
  });
}

function highlightStore(storeId, isOn) {
  const entry = markers.find(m => m.store.id === storeId);
  if (entry) setShopMarkerHighlighted(entry.marker, isOn, !!entry.store.step);
  shopStoreListEl.querySelector(`.shop-store[data-store-id="${CSS.escape(storeId)}"]`)?.classList.toggle('highlighted', isOn);
}

function renderMarkers() {
  clearShopMarkers();
  closeActiveInfoWindow();
  if (!mapState.map || !current) return;
  if (lastGps) meMarker = createUserLocationMarker({ lat: lastGps.lat, lng: lastGps.lng }, mapState.map);
  current.shown.forEach((store, i) => {
    const marker = createShopMarker({
      position: { lat: store.lat, lng: store.lng },
      title: store.name,
      emoji: store.emoji,
      step: store.step,
      closed: store.open.state === 'closed',
      index: i,
      map: mapState.map
    });
    onMarkerClick(marker, () => openStoreInfo(store, marker));
    onMarkerHover(marker, () => highlightStore(store.id, true), () => highlightStore(store.id, false));
    markers.push({ store, marker });
  });
}

function fitShopView() {
  if (!mapState.map || !current) return;
  const map = mapState.map;
  const focus = current.plan.length ? current.plan.map(step => step.store) : current.shown.slice(0, 5);
  if (!focus.length) {
    map.setCenter({ lat: current.center.lat, lng: current.center.lng });
    map.setZoom(16);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  bounds.extend({ lat: current.center.lat, lng: current.center.lng });
  focus.forEach(s => bounds.extend({ lat: s.lat, lng: s.lng }));
  map.fitBounds(bounds, 60);
  google.maps.event.addListenerOnce(map, 'idle', () => {
    if (map.getZoom() > SHOP_FIT_MAX_ZOOM) map.setZoom(SHOP_FIT_MAX_ZOOM);
  });
}

function onMapDragEnd() {
  if (!active) return;
  const c = mapState.map.getCenter();
  const reference = current?.center || lastGps;
  const moved = reference ? haversineMeters(reference, { lat: c.lat(), lng: c.lng() }) : Infinity;
  shopSearchAreaBtn.hidden = moved < AREA_BUTTON_MIN_MOVE_M;
}

function enterMapLayer() {
  if (layerEntered || !mapState.map) return;
  layerEntered = true;
  // 集章地圖開著的話先收掉（它會把美食標記交還），再把美食那層整個收起來，換成採買地圖
  exitStampMap({ restoreView: false });
  hideSearchLayer({ includeRoute: true });
  mapState.refitOverlayView = fitShopView;
  refreshFlyoverButton();
  dragListener = mapState.map.addListener('dragend', onMapDragEnd);
}

// ── 對外 ──

let savedMapHint = null;

export function activateShopLayer() {
  if (active) return;
  active = true;
  shopMapBarEl.hidden = false;
  if (!mapState.map) {
    savedMapHint = mapHintEl.textContent;
    mapHintEl.textContent = GOOGLE_MAPS_API_KEY
      ? '記下要買的東西，這裡會標出附近哪裡買得到。'
      : '設定 Google Maps API key 後，這裡會標出附近哪裡買得到。';
  }
  enterMapLayer();
  refreshNearby();
}

export function deactivateShopLayer() {
  if (!active) return;
  active = false;
  // 進行中的搜尋作廢，結果回來也不畫
  refreshToken++;
  shopMapBarEl.hidden = true;
  shopSearchAreaBtn.hidden = true;
  clearShopMarkers();
  closeActiveInfoWindow();
  if (savedMapHint !== null) {
    mapHintEl.textContent = savedMapHint;
    savedMapHint = null;
  }
  if (layerEntered) {
    layerEntered = false;
    mapState.refitOverlayView = null;
    dragListener?.remove();
    dragListener = null;
    restoreSearchLayer();
    refreshFlyoverButton();
  }
}

export async function refreshNearby({ force = false } = {}) {
  if (!active) return;
  const token = ++refreshToken;
  const items = getItems();
  locationFailed = false;
  if (!GOOGLE_MAPS_API_KEY) {
    phase = 'nokey';
    renderAll();
    return;
  }
  if (!items.length) {
    phase = 'empty';
    current = null;
    clearShopMarkers();
    closeActiveInfoWindow();
    renderAll();
    return;
  }
  phase = 'loading';
  loadingText = '定位中…';
  renderAll();
  try {
    await loadGoogleMapsSDK();
    if (token !== refreshToken) return;
    initMapIfNeeded();
    enterMapLayer();
    const center = await resolveCenter(force);
    if (token !== refreshToken) return;

    // 同一個 key 只查一次。名稱搜尋（不知道類別的品項）每項都要單獨計費，限制數量
    const searchable = items.filter(it => !it.awaitingAi);
    const fetched = new Map();
    const skippedKeys = new Set();
    let nameCount = 0;
    const fetchRound = async (keysOfItem, label) => {
      const queries = new Map();
      searchable.forEach(it => {
        keysOfItem(it).forEach(key => {
          if (fetched.has(key) || queries.has(key) || skippedKeys.has(key)) return;
          if (key.startsWith('name:')) {
            if (nameCount >= SHOP_MAX_NAME_SEARCHES) {
              skippedKeys.add(key);
              return;
            }
            nameCount++;
          }
          queries.set(key, stripQuantity(it.text));
        });
      });
      const keys = [...queries.keys()];
      if (!keys.length) return;
      let doneCount = 0;
      const updateProgress = () => {
        loadingText = `${label}（${doneCount}/${keys.length}）`;
        renderStatus();
        renderMapBar();
      };
      updateProgress();
      await mapWithConcurrency(keys, 4, async key => {
        const entry = (!force && getCached(key, center)) || await fetchKeyOnce(key, queries.get(key), center);
        fetched.set(key, entry);
        doneCount++;
        if (token === refreshToken) updateProgress();
      });
    };

    // 第一輪：每個品項最常買到的前兩類（使用者自己選的類別全部都查）
    await fetchRound(it => searchKeysFor(it.resolution, it.resolution.source === 'learned' ? Infinity : PRIMARY_CATEGORY_COUNT), '找附近的店…');
    if (token !== refreshToken) return;
    let result = buildResult(items, center, [...fetched.values()], skippedKeys);
    // 第二輪：附近還找不到有開的店的品項，才補查它剩下的類別
    const stillMissing = new Set(searchable.filter(it => {
      const status = result.itemStatus.get(it.id);
      return status.state === 'none' || (status.state === 'found' && !status.nearest);
    }).map(it => it.id));
    if (stillMissing.size) {
      await fetchRound(it => (stillMissing.has(it.id) ? searchKeysFor(it.resolution) : []), '再找其他類型的店…');
      if (token !== refreshToken) return;
      result = buildResult(items, center, [...fetched.values()], skippedKeys);
    }

    current = result;
    phase = 'ready';
    shopSearchAreaBtn.hidden = true;
    renderMarkers();
    fitShopView();
    renderAll();
  } catch (err) {
    if (token !== refreshToken) return;
    console.error(err);
    phase = 'error';
    errorMessage = err.message || '找附近的店失敗';
    locationFailed = !!err.locationFailed;
    if (locationFailed && mapState.map) shopSearchAreaBtn.hidden = false;
    renderAll();
  }
}

// 清單變動（新增、打勾、改類別）後呼叫；連續操作只重算一次。已經查過的類別直接用快取，不會重新計費
export const requestNearbyRefresh = debounce(() => {
  if (active) refreshNearby();
}, 600);

// 給清單上每個品項顯示「最近在哪買」；重新整理期間沿用上一次的結果，新加的品項才顯示「找附近的店…」
export function nearbyInfoForItem(itemId) {
  if (!active) return null;
  if (showingResult() && current.itemStatus.has(itemId)) return current.itemStatus.get(itemId);
  return phase === 'loading' ? { state: 'loading' } : null;
}

// 點清單上的店名／品項提示：手機版切到地圖頁籤，鏡頭移過去並打開那間店的資訊
export function focusStore(storeId) {
  if (!mapState.map || !current) return;
  if (window.matchMedia?.(SHOP_MOBILE_QUERY).matches) setMobileView('map');
  const entry = markers.find(m => m.store.id === storeId);
  const store = entry?.store;
  if (!store) return;
  panForInfoWindow({ lat: store.lat, lng: store.lng }, Math.max(mapState.map.getZoom() || 0, 16));
  openStoreInfo(store, entry.marker);
}

// ── 事件 ──

shopRefreshBtn.addEventListener('click', () => refreshNearby({ force: true }));
shopMapRefreshBtn.addEventListener('click', () => refreshNearby({ force: true }));

shopSearchAreaBtn.addEventListener('click', () => {
  if (!mapState.map) return;
  const c = mapState.map.getCenter();
  areaCenter = { lat: c.lat(), lng: c.lng() };
  shopSearchAreaBtn.hidden = true;
  refreshNearby();
});

shopNearbyStatusEl.addEventListener('click', (e) => {
  if (e.target.closest('.shop-fixes-toggle')) {
    fixesOpen = !fixesOpen;
    renderStatus();
    return;
  }
  const undo = e.target.closest('.shop-fix-undo');
  if (undo) {
    restoreStoreFix(undo.dataset.placeId);
    return;
  }
  if (!e.target.closest('.shop-back-to-gps')) return;
  areaCenter = null;
  refreshNearby();
});

function onStoreAreaClick(e) {
  const itemBtn = e.target.closest('.shop-store-item');
  if (itemBtn) {
    markBought(itemBtn.dataset.itemId);
    return;
  }
  const opt = e.target.closest('.shop-report-opt');
  if (opt) {
    reportStore(opt.dataset.storeId, opt.dataset.kind, opt.dataset.value);
    return;
  }
  const reportBtn = e.target.closest('.shop-store-report');
  if (reportBtn) {
    const card = reportBtn.closest('.shop-store');
    const menu = card.querySelector('.shop-report-menu');
    const store = current?.shown.find(s => s.id === card.dataset.storeId);
    if (!store) return;
    menu.hidden = !menu.hidden;
    if (!menu.hidden) menu.innerHTML = reportMenuHtml(store);
    return;
  }
  if (e.target.closest('.shop-report-menu')) return;
  if (e.target.closest('a')) return;
  const storeEl = e.target.closest('[data-store-id]');
  if (storeEl) focusStore(storeEl.dataset.storeId);
}

shopStoreListEl.addEventListener('click', onStoreAreaClick);
shopPlanEl.addEventListener('click', onStoreAreaClick);
shopStoreListEl.addEventListener('mouseover', (e) => {
  const storeEl = e.target.closest('.shop-store');
  if (storeEl && !storeEl.contains(e.relatedTarget)) highlightStore(storeEl.dataset.storeId, true);
});
shopStoreListEl.addEventListener('mouseout', (e) => {
  const storeEl = e.target.closest('.shop-store');
  if (storeEl && !storeEl.contains(e.relatedTarget)) highlightStore(storeEl.dataset.storeId, false);
});
