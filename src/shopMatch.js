// 採買清單的純邏輯：把輸入拆成品項、判斷每個品項可以去哪類店買、判斷店家屬於哪一類、
// 算出「跑哪幾間可以買齊」。不碰 DOM、不 import config.js，node 可以直接載入測試。
import { SHOP_CATEGORIES, ITEM_KEYWORD_RULES, SINGLE_CHAR_RULES, CHAINS, NOT_A_SHOP_NAME_RE } from './shopCatalog.js';

export const CATEGORY_BY_ID = new Map(SHOP_CATEGORIES.map(c => [c.id, c]));

// 一次輸入最多拆成幾項，避免不小心貼上一整篇文章
const MAX_ITEMS_PER_INPUT = 30;

// 全形英數轉半形、轉小寫（NFKC 會把 ＡＴＭ、７－１１ 這類全形字轉回一般字元）
export function normalizeText(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase();
}

// 拿掉空白跟標點符號後的比對鍵：「7-11」「７－１１」「7 11」都會變成 711
export function itemKey(text) {
  return normalizeText(text).replace(/[\s\p{P}\p{S}]+/gu, '');
}

const NUM = '(?:[0-9]+(?:\\.[0-9]+)?|[一二兩三四五六七八九十百半]+)';
const UNIT = '(?:公斤|公克|毫升|公升|瓶|罐|包|袋|盒|箱|顆|個|條|支|枝|片|卷|捲|打|斤|克|升|入|組|份|雙|件|本|張|台|臺|隻|塊|串|把|副|套|桶|粒|kg|g|ml|l|cc)';
const TRAILING_QTY_RE = new RegExp(`\\s*(?:[x×*]\\s*${NUM}|${NUM}\\s*${UNIT}裝?|\\s[0-9]+)\\s*$`, 'i');
// 「兩件式雨衣」「一字起子」的開頭不是數量，量詞後面接「式」「型」「字」時不拆
const LEADING_QTY_RE = new RegExp(`^\\s*${NUM}\\s*${UNIT}(?![式型字])\\s*`, 'i');
const QTY_ONLY_RE = new RegExp(`^(?:[x×*]?\\s*[0-9]+|${NUM}\\s*${UNIT}裝?)$`, 'i');
const QTY_AT_START_RE = new RegExp(`^${NUM}${UNIT}(?![式型字])`, 'i');

// 「牛奶 x2」「兩瓶牛奶」「衛生紙 3包」→ 品項本體。數量留在畫面上的文字裡，
// 只是比對類別、記錄常買時用本體，「牛奶」跟「牛奶 2瓶」才會被當成同一樣東西
export function stripQuantity(text) {
  const s = String(text ?? '').normalize('NFKC').trim();
  const stripped = s.replace(TRAILING_QTY_RE, '').replace(LEADING_QTY_RE, '').trim();
  return stripped || s;
}

function splitCats(str) {
  return str.split(/\s+/).filter(Boolean);
}

function mergeCats(a, b) {
  const out = a.slice();
  b.forEach(c => { if (!out.includes(c)) out.push(c); });
  return out;
}

// 關鍵字 → 類別，啟動時從 ITEM_KEYWORD_RULES 建一次
export const KEYWORD_INDEX = (() => {
  const index = new Map();
  for (const [catsStr, words] of ITEM_KEYWORD_RULES) {
    const cats = splitCats(catsStr);
    for (const word of words.split(/\s+/)) {
      const k = itemKey(word);
      if (k.length < 2) continue;
      index.set(k, mergeCats(index.get(k) || [], cats));
    }
  }
  return index;
})();

const SINGLE_CHAR_INDEX = new Map(Object.entries(SINGLE_CHAR_RULES).map(([ch, cats]) => [ch, splitCats(cats)]));

function validCats(cats) {
  return (Array.isArray(cats) ? cats : []).filter(c => CATEGORY_BY_ID.has(c));
}

export function findChainForItem(key) {
  return CHAINS.find(chain => chain.re.test(key)) || null;
}

export function chainMatchesPlace(chain, nameKey) {
  return (chain.placeRe || chain.re).test(nameKey);
}

// 找出品項裡出現的所有關鍵字，挑不重疊、最長的那些。learned（使用者自己改過的品項）
// 也當成關鍵字一起比，而且優先：改過「貓砂」之後，「大包貓砂」也會套用
function pickKeywordMatches(key, learned) {
  const found = [];
  const scan = (entries, fromLearned) => {
    for (const [kw, cats] of entries) {
      if (!kw || !cats.length) continue;
      let from = 0;
      let idx;
      while ((idx = key.indexOf(kw, from)) !== -1) {
        found.push({ start: idx, end: idx + kw.length, cats, learned: fromLearned });
        from = idx + 1;
      }
    }
  };
  scan(KEYWORD_INDEX, false);
  if (learned) {
    scan(Object.entries(learned).map(([k, cats]) => [k, validCats(cats)]), true);
  }
  found.sort((a, b) => (b.learned - a.learned) || ((b.end - b.start) - (a.end - a.start)) || (a.start - b.start));
  const picked = [];
  for (const m of found) {
    if (picked.some(p => m.start < p.end && p.start < m.end)) continue;
    picked.push(m);
  }
  return picked;
}

function guessBySingleChar(key) {
  for (let i = key.length - 1; i >= 0; i--) {
    const cats = SINGLE_CHAR_INDEX.get(key[i]);
    if (cats) return cats.slice();
  }
  return [];
}

// 判斷一個品項要怎麼找店：
//   mode 'cats'  → 依類別找附近的店（cats 依常見程度排序）
//   mode 'chain' → 品項本身就是連鎖店名，只找那一家
//   mode 'name'  → 沒有任何類別資訊，直接拿品項名稱去地圖搜尋
// source 說明這個判斷從哪來：learned（使用者改過）、chain、dict（關鍵字）、ai、guess（單字猜的）、none
// memory 是 { learned, ai }，都是「品項比對鍵 → 類別陣列」；learned 是空陣列代表使用者選了「直接用名稱搜尋」
export function resolveItem(text, memory = {}) {
  const key = itemKey(stripQuantity(text)) || itemKey(text);
  const learned = memory.learned || {};
  if (Object.hasOwn(learned, key)) {
    const cats = validCats(learned[key]);
    return { key, source: 'learned', mode: cats.length ? 'cats' : 'name', cats };
  }
  const chain = findChainForItem(key);
  if (chain) return { key, source: 'chain', mode: 'chain', cats: chain.cats.slice(), chain };

  const picked = pickKeywordMatches(key, learned);
  if (picked.length) {
    const cats = picked.reduce((acc, m) => mergeCats(acc, m.cats), []);
    return { key, source: picked.some(m => m.learned) ? 'learned' : 'dict', mode: 'cats', cats };
  }
  const ai = memory.ai?.[key];
  if (Array.isArray(ai)) {
    const cats = validCats(ai);
    return { key, source: 'ai', mode: cats.length ? 'cats' : 'name', cats };
  }
  const guess = guessBySingleChar(key);
  // 整個品項就只有一個字（「米」「鹽」「藥」）時，單字規則就是精確的答案，不算用猜的
  if (guess.length) return { key, source: key.length === 1 ? 'dict' : 'guess', mode: 'cats', cats: guess };
  return { key, source: 'none', mode: 'name', cats: [] };
}

// 字典對不到、只能用單字猜或完全沒頭緒的品項，有 AI 時交給 AI 判斷
export function needsAiClassification(resolution) {
  return resolution.source === 'guess' || resolution.source === 'none';
}

// 這個品項是不是「認得的東西」：拿來決定空白要不要當成分隔
function isKnownPiece(piece, memory) {
  const key = itemKey(stripQuantity(piece));
  if (!key) return false;
  if (memory.learned && Object.hasOwn(memory.learned, key)) return true;
  if (memory.history && Object.hasOwn(memory.history, key)) return true;
  if (findChainForItem(key)) return true;
  return pickKeywordMatches(key, null).length > 0;
}

// 「牛奶跟雞蛋」要拆，「高跟鞋」「和菓子」不能拆：連接詞兩邊都至少兩個字才當成分隔
function splitOnConjunctions(chunk) {
  const parts = chunk.split(/([跟和與及])/);
  const out = [parts[0]];
  for (let i = 1; i < parts.length; i += 2) {
    const conj = parts[i];
    const next = parts[i + 1] ?? '';
    const last = out[out.length - 1];
    if (last.trim().length >= 2 && next.trim().length >= 2) out.push(next);
    else out[out.length - 1] = last + conj + next;
  }
  return out;
}

// 只講了「我要買」、沒說買什麼的片段直接丟掉
const FILLER_ONLY_RE = /^(?:幫我|請|記得|我要|我想|要|需要|還要|順便|去|再)*(?:買|購買|加入|新增)$/;

// 口語開頭（我要買、記得買、幫我加）跟結尾（沒了、喔）不是品項的一部分
function cleanChunk(chunk) {
  return chunk
    .replace(/^\s*(?:幫我|請|麻煩|記得|我要|我想|要|需要|還要|順便|去|再)+\s*(?:買|購買)(?=\S)/, '')
    .replace(/^\s*(?:幫我)?(?:加入|新增)(?=\S)/, '')
    .replace(/(?:快?沒了|快?用完了|用光了|沒有了)\s*$/, '')
    .replace(/\s*(?:喔|哦|啊|吧|唷|呦|呀)\s*$/, '')
    .trim();
}

// 空白要不要當分隔：「牛奶 雞蛋 衛生紙」要拆，「洗衣精 補充包」「AA 電池」「iPhone 充電線」不能拆。
// 規則：純數量的片段（2瓶、x3）先黏回前一段；有英文字母的不拆（型號、品牌常跟中文名詞連在一起）；
// 其他情況每一段都是認得的品項才拆
function splitBySpaces(chunk, memory) {
  const raw = chunk.trim().split(/\s+/).filter(Boolean);
  if (raw.length < 2) return [chunk.trim()];
  const pieces = [];
  raw.forEach(p => {
    if (pieces.length && QTY_ONLY_RE.test(p)) pieces[pieces.length - 1] += ' ' + p;
    else pieces.push(p);
  });
  if (pieces.length < 2) return [pieces.join(' ')];
  if (pieces.some(p => /[a-z]/i.test(stripQuantity(p)))) return [raw.join(' ')];
  return pieces.every(p => isKnownPiece(p, memory)) ? pieces : [raw.join(' ')];
}

function dictionaryWords(memory) {
  const words = new Set(KEYWORD_INDEX.keys());
  CHAINS.forEach(chain => words.add(itemKey(chain.label)));
  Object.keys(memory.learned || {}).forEach(k => words.add(k));
  Object.keys(memory.history || {}).forEach(k => words.add(k));
  return words;
}

// 語音辨識常常整串沒有標點（「牛奶雞蛋衛生紙」），用字典把它切開：
// 整串剛好能被認得的詞（至少兩個字）完整切開才切，段數越少越好（偏好長詞），切不完整就整串當一項。
// 數量（兩瓶、3包）可以夾在中間：第一段就是數量的話黏到後一個詞（兩瓶牛奶），否則黏到前一個詞（牛奶兩瓶）
export function segmentByDictionary(piece, memory = {}) {
  const s = itemKey(piece);
  if (s.length < 4) return [piece.trim()];
  const words = dictionaryWords(memory);
  const n = s.length;
  // best[i]：把 s[0..i) 切開的最佳結果 { tokens, wordCount }
  const best = new Array(n + 1).fill(null);
  best[0] = { tokens: [], wordCount: 0 };
  const better = (cand, cur) => !cur || cand.wordCount < cur.wordCount
    || (cand.wordCount === cur.wordCount && cand.tokens.length < cur.tokens.length);
  for (let i = 0; i < n; i++) {
    if (!best[i]) continue;
    const qty = s.slice(i).match(QTY_AT_START_RE);
    if (qty) {
      const j = i + qty[0].length;
      const cand = { tokens: best[i].tokens.concat({ text: qty[0], qty: true }), wordCount: best[i].wordCount };
      if (better(cand, best[j])) best[j] = cand;
    }
    for (let len = Math.min(12, n - i); len >= 2; len--) {
      const w = s.slice(i, i + len);
      if (!words.has(w)) continue;
      const cand = { tokens: best[i].tokens.concat({ text: w, qty: false }), wordCount: best[i].wordCount + 1 };
      if (better(cand, best[i + len])) best[i + len] = cand;
    }
  }
  const result = best[n];
  if (!result || result.wordCount < 2) return [piece.trim()];

  const qtyFirst = result.tokens[0]?.qty;
  const items = [];
  let pendingQty = '';
  result.tokens.forEach(tok => {
    if (tok.qty) {
      if (qtyFirst) pendingQty += tok.text;
      else if (items.length) items[items.length - 1] += tok.text;
      return;
    }
    items.push(pendingQty + tok.text);
    pendingQty = '';
  });
  if (pendingQty && items.length) items[items.length - 1] += pendingQty;
  return items;
}

// 把一次輸入拆成多個品項：換行、逗號、頓號、分號、「還有」「跟」等都算分隔，
// voice 為 true（語音辨識的結果）時再多用字典切開沒有標點的長串。
// memory 是 { learned, history }，用來認得使用者自己的品項
export function splitItems(rawText, { voice = false, memory = {} } = {}) {
  const text = String(rawText ?? '').normalize('NFKC');
  const chunks = text
    .split(/[\n\r,;。、!?]+/)
    .flatMap(c => c.split(/\s*[+/]\s*/))
    .flatMap(c => c.split(/還有|以及|然後|再來|另外|加上|再加/))
    .flatMap(splitOnConjunctions)
    .map(cleanChunk)
    .filter(c => c && !FILLER_ONLY_RE.test(c));

  const items = [];
  const seen = new Set();
  for (const chunk of chunks) {
    for (const piece of splitBySpaces(chunk, memory)) {
      const parts = voice ? segmentByDictionary(piece, memory) : [piece];
      for (const part of parts) {
        const trimmed = part.trim();
        const key = itemKey(stripQuantity(trimmed));
        if (!key || seen.has(key)) continue;
        seen.add(key);
        items.push(trimmed);
      }
    }
  }
  return items.slice(0, MAX_ITEMS_PER_INPUT);
}

// ── 店家端 ──

// 從 Places API 的回應整理出判斷類別需要的欄位（accept 函式用 nameKey、primaryType）
export function placeFacts(place) {
  return {
    nameKey: itemKey(place.displayName?.text || place.name || ''),
    primaryType: place.primaryType || '',
    types: place.types || []
  };
}

// 一間店在某個類別的搜尋結果裡出現時，是不是真的算那一類（藥局／藥妝店要靠店名再分一次）。
// 店名一看就是餐廳、補習班、辦公室的，不管 Google 上標成什麼類型都不算；認得的連鎖店例外
export function placeAcceptedFor(categoryId, facts) {
  const cat = CATEGORY_BY_ID.get(categoryId);
  if (!cat) return false;
  if (!cat.foodNamesOk && NOT_A_SHOP_NAME_RE.test(facts.nameKey) && !chainCatsForPlace(facts.nameKey).length) return false;
  return cat.accept ? cat.accept(facts) : true;
}

// 店名對得上的連鎖店，補上它實際有賣的類別
export function chainCatsForPlace(nameKey) {
  let cats = [];
  CHAINS.forEach(chain => {
    if (chainMatchesPlace(chain, nameKey)) cats = mergeCats(cats, chain.cats);
  });
  return cats;
}

// 使用者回報「這間店標錯了」的修正（存在 localStorage，key 是 Google 的 place id）：
//   all   → 整間都不要再出現
//   cats  → 這間店其實不是這幾類（例如被標成超市的早餐店）
//   names → 用品名搜尋找到、但其實沒賣的品項比對鍵
// store 是 buildResult 裡的 { cats: Set, hits: Set }，會直接改掉；回傳 false 代表整間拿掉
export function applyStoreFix(store, fix) {
  if (!fix) return true;
  if (fix.all) return false;
  (fix.cats || []).forEach(c => store.cats.delete(c));
  (fix.names || []).forEach(k => store.hits.delete(`name:${k}`));
  return true;
}

// 店家 store 是否買得到品項（resolution 是 resolveItem 的結果）。
// store：{ nameKey, cats: Set, hits: Set }，hits 記錄這間店是被哪些搜尋找到的（chain:xxx、name:xxx）
export function storeCovers(store, resolution) {
  if (resolution.mode === 'chain') {
    return store.hits.has(`chain:${resolution.chain.id}`) || chainMatchesPlace(resolution.chain, store.nameKey);
  }
  if (resolution.mode === 'name') return store.hits.has(`name:${resolution.key}`);
  return resolution.cats.some(c => store.cats.has(c));
}

// 一個品項要做哪幾次搜尋（同一個 key 會被所有品項共用、也是快取的單位）。
// catLimit 只看前幾個（最常買到的）類別
export function searchKeysFor(resolution, catLimit = Infinity) {
  if (resolution.mode === 'chain') return [`chain:${resolution.chain.id}`];
  if (resolution.mode === 'name') return [`name:${resolution.key}`];
  return [...new Set(resolution.cats.slice(0, catLimit).map(c => `cat:${CATEGORY_BY_ID.get(c).search.key}`))];
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 依「現在」判斷有沒有開：快取的結果可能是半小時前查的，用 nextCloseTime / nextOpenTime 校正，
// 不用為了營業狀態重查 API。回傳 { state: 'open' | 'closed' | 'unknown', closeAt, openAt }（毫秒時間戳）
export function openStateAt(hours, now = Date.now()) {
  if (!hours || typeof hours.openNow !== 'boolean') return { state: 'unknown' };
  const closeAt = hours.nextCloseTime ? Date.parse(hours.nextCloseTime) : NaN;
  const openAt = hours.nextOpenTime ? Date.parse(hours.nextOpenTime) : NaN;
  let open = hours.openNow;
  if (open && Number.isFinite(closeAt) && now >= closeAt) open = false;
  else if (!open && Number.isFinite(openAt) && now >= openAt) open = true;
  if (open) {
    return { state: 'open', closeAt: Number.isFinite(closeAt) && closeAt > now ? closeAt : null, is24h: !!hours.is24h };
  }
  return { state: 'closed', openAt: Number.isFinite(openAt) && openAt > now ? openAt : null };
}

// 建議怎麼買：每一步挑「能買到最多還沒買的東西」的店，但每多走一公里扣一分
// （多買到一樣東西大約值得多走一公里），打烊的店不列入。挑完再從目前位置用最近鄰排出順序，
// 然後依這個順序重新分配：每一站買下所有它買得到、前面還沒買到的東西（沒東西可買的站就拿掉）。
// items：[{ id, resolution }]；stores：[{ id, lat, lng, distance, open: { state }, ... }]
export function planTrip(items, stores, center) {
  const usable = stores.filter(s => s.open?.state !== 'closed');
  const coverMap = new Map(usable.map(s => [s.id, new Set(items.filter(it => storeCovers(s, it.resolution)).map(it => it.id))]));
  const remaining = new Set(items.map(it => it.id).filter(id => usable.some(s => coverMap.get(s.id).has(id))));
  const chosen = [];
  while (remaining.size) {
    let best = null;
    for (const s of usable) {
      if (chosen.includes(s)) continue;
      let count = 0;
      coverMap.get(s.id).forEach(id => { if (remaining.has(id)) count++; });
      if (!count) continue;
      const score = count - s.distance / 1000;
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && s.distance < best.store.distance)) {
        best = { store: s, score };
      }
    }
    if (!best) break;
    chosen.push(best.store);
    coverMap.get(best.store.id).forEach(id => remaining.delete(id));
  }

  // 最近鄰排序：從目前位置出發，每次走到最近的下一間
  const ordered = [];
  let here = center;
  const left = chosen.slice();
  while (left.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    left.forEach((s, i) => {
      const d = here ? haversineMeters(here, s) : s.distance;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    const [next] = left.splice(bestIdx, 1);
    ordered.push(next);
    here = next;
  }

  const bought = new Set();
  const steps = [];
  ordered.forEach(store => {
    const itemIds = items.map(it => it.id).filter(id => !bought.has(id) && coverMap.get(store.id).has(id));
    if (!itemIds.length) return;
    itemIds.forEach(id => bought.add(id));
    steps.push({ store, itemIds });
  });
  return steps;
}
