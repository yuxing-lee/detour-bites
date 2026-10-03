import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  splitItems, resolveItem, stripQuantity, itemKey, segmentByDictionary,
  KEYWORD_INDEX, CATEGORY_BY_ID, placeFacts, placeAcceptedFor, chainCatsForPlace,
  storeCovers, planTrip, openStateAt, searchKeysFor, applyStoreFix
} from '../src/shopMatch.js';
import { ITEM_KEYWORD_RULES, SINGLE_CHAR_RULES, CHAINS, SHOP_CATEGORIES } from '../src/shopCatalog.js';

test('catalog only references known categories', () => {
  for (const [cats] of ITEM_KEYWORD_RULES) {
    for (const c of cats.split(/\s+/)) assert.ok(CATEGORY_BY_ID.has(c), `unknown category ${c}`);
  }
  for (const [ch, cats] of Object.entries(SINGLE_CHAR_RULES)) {
    assert.equal([...ch].length, 1, `single char rule ${ch}`);
    for (const c of cats.split(/\s+/)) assert.ok(CATEGORY_BY_ID.has(c), `unknown category ${c}`);
  }
  for (const chain of CHAINS) for (const c of chain.cats) assert.ok(CATEGORY_BY_ID.has(c), `chain ${chain.id} -> ${c}`);
  const ids = SHOP_CATEGORIES.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(KEYWORD_INDEX.size > 800, `keyword count ${KEYWORD_INDEX.size}`);
});

const cats = (text, memory) => resolveItem(text, memory).cats;

test('typed splitting', () => {
  assert.deepEqual(splitItems('牛奶、雞蛋，衛生紙'), ['牛奶', '雞蛋', '衛生紙']);
  assert.deepEqual(splitItems('牛奶\n雞蛋\n\n衛生紙'), ['牛奶', '雞蛋', '衛生紙']);
  assert.deepEqual(splitItems('牛奶 雞蛋 衛生紙'), ['牛奶', '雞蛋', '衛生紙']);
  assert.deepEqual(splitItems('洗衣精 補充包'), ['洗衣精 補充包']);
  assert.deepEqual(splitItems('AA 電池'), ['AA 電池']);
  assert.deepEqual(splitItems('iPhone 充電線'), ['iPhone 充電線']);
  assert.deepEqual(splitItems('牛奶 2瓶 雞蛋 1盒'), ['牛奶 2瓶', '雞蛋 1盒']);
  assert.deepEqual(splitItems('牛奶 x2 雞蛋 x3'), ['牛奶 x2', '雞蛋 x3']);
  assert.deepEqual(splitItems('牛奶跟雞蛋和衛生紙'), ['牛奶', '雞蛋', '衛生紙']);
  assert.deepEqual(splitItems('高跟鞋'), ['高跟鞋']);
  assert.deepEqual(splitItems('和菓子'), ['和菓子']);
  assert.deepEqual(splitItems('我要買牛奶，還要買雞蛋'), ['牛奶', '雞蛋']);
  assert.deepEqual(splitItems('記得買衛生紙喔'), ['衛生紙']);
  assert.deepEqual(splitItems('牛奶沒了'), ['牛奶']);
  assert.deepEqual(splitItems('牛奶，牛奶 2瓶'), ['牛奶'], 'dedupes by item key');
  assert.deepEqual(splitItems('我要買'), []);
  assert.deepEqual(splitItems('  '), []);
  assert.deepEqual(splitItems('買菜'), ['買菜']);
  assert.deepEqual(splitItems('ＡＴＭ領錢'), ['ATM領錢']);
});

test('voice splitting with dictionary segmentation', () => {
  assert.deepEqual(splitItems('牛奶雞蛋衛生紙', { voice: true }), ['牛奶', '雞蛋', '衛生紙']);
  assert.deepEqual(splitItems('我要買牛奶雞蛋還有衛生紙', { voice: true }), ['牛奶', '雞蛋', '衛生紙']);
  assert.deepEqual(splitItems('洗髮精沐浴乳', { voice: true }), ['洗髮精', '沐浴乳']);
  assert.deepEqual(splitItems('牛奶糖', { voice: true }), ['牛奶糖']);
  assert.deepEqual(splitItems('洗衣精補充包', { voice: true }), ['洗衣精補充包']);
  assert.deepEqual(splitItems('牛奶兩瓶雞蛋一盒', { voice: true }), ['牛奶兩瓶', '雞蛋一盒']);
  assert.deepEqual(splitItems('兩瓶牛奶三包衛生紙', { voice: true }), ['兩瓶牛奶', '三包衛生紙']);
  assert.deepEqual(segmentByDictionary('鳳梨酥牛奶', { history: {} }), ['鳳梨酥', '牛奶']);
  // personal history words help segmentation
  assert.deepEqual(splitItems('乖乖桶牛奶', { voice: true, memory: { history: { 乖乖桶: {} } } }), ['乖乖桶', '牛奶']);
});

test('quantity stripping', () => {
  assert.equal(stripQuantity('牛奶 x2'), '牛奶');
  assert.equal(stripQuantity('兩瓶牛奶'), '牛奶');
  assert.equal(stripQuantity('衛生紙 3包'), '衛生紙');
  assert.equal(stripQuantity('半打啤酒'), '啤酒');
  assert.equal(stripQuantity('兩件式雨衣'), '兩件式雨衣');
  assert.equal(stripQuantity('一字起子'), '一字起子');
  assert.equal(stripQuantity('A4紙'), 'A4紙');
  assert.equal(stripQuantity('3號電池'), '3號電池');
  assert.equal(stripQuantity('五花肉'), '五花肉');
  assert.equal(stripQuantity('2瓶'), '2瓶', 'never strips everything');
});

test('dictionary resolution picks sensible categories', () => {
  assert.deepEqual(cats('牛奶'), ['convenience', 'supermarket']);
  assert.equal(cats('感冒藥')[0], 'pharmacy');
  assert.equal(cats('貓罐頭')[0], 'pet', 'longest match beats 罐頭');
  assert.equal(cats('眼藥水')[0], 'pharmacy');
  assert.equal(cats('隱形眼鏡藥水')[0], 'drugstore');
  assert.equal(cats('螺絲起子')[0], 'hardware');
  assert.equal(cats('原子筆')[0], 'stationery');
  assert.equal(cats('充電線')[0], 'electronics');
  assert.equal(cats('衛生紙 3包')[0], 'convenience');
  assert.equal(cats('鳳梨酥')[0], 'bakery', 'not fruit');
  assert.equal(cats('花生')[0], 'convenience', 'not florist');
  assert.equal(cats('花椰菜')[0], 'supermarket', 'not florist');
  assert.equal(cats('雞蛋豆腐')[0], 'supermarket');
  assert.equal(cats('機車雨衣')[0], 'scooter');
  assert.equal(cats('ok繃')[0], 'convenience', 'not OK mart chain');
  assert.equal(resolveItem('OK繃').mode, 'cats');
  assert.equal(cats('繳電話費')[0], 'convenience');
  assert.equal(cats('領錢')[0], 'atm');
  assert.equal(cats('寄包裹')[0], 'post');
  assert.equal(cats('加油')[0], 'gas');
  assert.equal(cats('兩件式雨衣')[0], 'scooter');
  assert.equal(cats('尿布墊')[0], 'pet');
  assert.equal(cats('尿布')[0], 'baby');
  assert.equal(cats('熱狗')[0], 'convenience', 'not pet');
  assert.equal(cats('除濕盒')[0], 'supermarket');
  assert.equal(cats('延長線')[0], 'hardware');
  assert.equal(cats('洗髮精')[0], 'drugstore');
  assert.equal(cats('玫瑰花')[0], 'florist');
  assert.equal(cats('啤酒')[0], 'convenience');
  assert.equal(resolveItem('牛奶').source, 'dict');
});

test('single-char guesses and unknowns', () => {
  const r = resolveItem('魚露');
  assert.equal(r.source, 'guess');
  assert.deepEqual(r.cats, ['supermarket', 'market']);
  assert.equal(resolveItem('止咳糖漿').cats[0], 'pharmacy');
  const none = resolveItem('烏梅汁');
  assert.equal(none.source, 'none');
  assert.equal(none.mode, 'name');
});

test('chains', () => {
  const r = resolveItem('全聯');
  assert.equal(r.mode, 'chain');
  assert.equal(r.chain.id, 'pxmart');
  assert.equal(resolveItem('大全聯').chain.id, 'rtmart');
  assert.equal(resolveItem('去好市多').chain.id, 'costco');
  assert.equal(resolveItem('7-11').chain.id, '711');
  assert.equal(resolveItem('７－１１').chain.id, '711');
  assert.equal(resolveItem('家樂福').chain.id, 'carrefour');
  assert.equal(resolveItem('chocolate').mode !== 'chain', true, 'hola must not match chocolate');
  assert.deepEqual(searchKeysFor(resolveItem('全聯')), ['chain:pxmart']);
});

test('learned overrides and ai cache', () => {
  const memory = { learned: { 貓砂: ['pet'], 牛奶: ['bakery'], 怪東西: [] }, ai: { 烏梅汁: ['convenience'] } };
  assert.deepEqual(cats('牛奶', memory), ['bakery']);
  assert.equal(resolveItem('牛奶', memory).source, 'learned');
  assert.deepEqual(cats('大包貓砂', memory), ['pet'], 'learned applies as substring');
  assert.equal(resolveItem('怪東西', memory).mode, 'name', 'empty learned = name search');
  assert.equal(resolveItem('烏梅汁', memory).source, 'ai');
  assert.deepEqual(searchKeysFor(resolveItem('感冒藥')), ['cat:health']);
  assert.deepEqual(searchKeysFor(resolveItem('洗髮精')), ['cat:health', 'cat:supermarket', 'cat:convenience']);
});

function fakePlace(name, primaryType) {
  return placeFacts({ displayName: { text: name }, primaryType });
}

test('pharmacy vs drugstore classification', () => {
  const watsons = fakePlace('屈臣氏 長春店', 'pharmacy');
  assert.equal(placeAcceptedFor('pharmacy', watsons), false);
  assert.equal(placeAcceptedFor('drugstore', watsons), true);
  const greatTree = fakePlace('大樹藥局 長春店', 'drugstore');
  assert.equal(placeAcceptedFor('pharmacy', greatTree), true);
  assert.equal(placeAcceptedFor('drugstore', greatTree), false);
  const generic = fakePlace('仁愛健康生活館', 'pharmacy');
  assert.equal(placeAcceptedFor('pharmacy', generic), true);
  const cosmed = fakePlace('康是美藥妝店', 'drugstore');
  assert.equal(placeAcceptedFor('drugstore', cosmed), true);
  assert.equal(placeAcceptedFor('pharmacy', cosmed), false);
  const market = fakePlace('民生市場 米粉湯', 'restaurant');
  assert.equal(placeAcceptedFor('market', market), false);
  assert.equal(placeAcceptedFor('market', fakePlace('民生傳統市場', 'market')), true);
  assert.equal(placeAcceptedFor('stationery', fakePlace('文具大學', 'university')), false);
});

test('mislabeled places are rejected by name', () => {
  // 店家自己在 Google 上亂標類型：早餐店標成超市、補習班標成書店、公司辦公室標成五金行
  assert.equal(placeAcceptedFor('supermarket', fakePlace('美而美早餐店', 'grocery_store')), false);
  assert.equal(placeAcceptedFor('book', fakePlace('長春文理補習班', 'book_store')), false);
  assert.equal(placeAcceptedFor('hardware', fakePlace('大成五金 總公司', 'hardware_store')), false);
  assert.equal(placeAcceptedFor('pet', fakePlace('毛孩寵物咖啡廳', 'pet_store')), false);
  // 真的店不受影響
  assert.equal(placeAcceptedFor('supermarket', fakePlace('美廉社 長春店', 'supermarket')), true);
  assert.equal(placeAcceptedFor('hardware', fakePlace('大成五金行', 'hardware_store')), true);
  // 麵包店兼賣早餐、咖啡很正常
  assert.equal(placeAcceptedFor('bakery', fakePlace('吳寶春麥方店 早餐 咖啡館', 'bakery')), true);
  // 連鎖店名對得上就相信它
  assert.equal(placeAcceptedFor('convenience', fakePlace('全家便利商店 早餐店門市', 'convenience_store')), true);
});

test('convenience search only keeps shop-like places', () => {
  assert.equal(placeAcceptedFor('convenience', fakePlace('7-ELEVEN 長春門市', 'convenience_store')), true);
  assert.equal(placeAcceptedFor('convenience', fakePlace('中油 長春站', 'gas_station')), true);
  assert.equal(placeAcceptedFor('convenience', fakePlace('阿明雜貨店', 'store')), true);
  // 類型清單順手勾了便利商店的餐廳、診所
  assert.equal(placeAcceptedFor('convenience', fakePlace('阿財麵線', 'restaurant')), false);
  assert.equal(placeAcceptedFor('convenience', fakePlace('仁愛診所', 'doctor')), false);
  assert.equal(placeAcceptedFor('convenience', fakePlace('某某商行', 'restaurant')), true, 'shop-like name wins');
});

test('user store fixes', () => {
  const s = store('x', '某早餐店', 100, ['supermarket', 'convenience'], { hits: ['name:烏梅汁'] });
  assert.equal(applyStoreFix(s, null), true);
  assert.equal(applyStoreFix(s, { cats: ['supermarket'], names: ['烏梅汁'] }), true);
  assert.deepEqual([...s.cats], ['convenience']);
  assert.equal(storeCovers(s, resolveItem('洗衣精')), false, 'no longer a supermarket');
  assert.equal(storeCovers(s, resolveItem('牛奶')), true, 'still a convenience store');
  assert.equal(s.hits.has('name:烏梅汁'), false);
  assert.equal(applyStoreFix(s, { all: true }), false);
});

test('chain enrichment for places', () => {
  assert.deepEqual(chainCatsForPlace(itemKey('寶雅 POYA 台北長春店')), ['drugstore', 'home', 'stationery']);
  assert.deepEqual(chainCatsForPlace(itemKey('家樂福超市 長春店')), ['supermarket']);
  assert.deepEqual(chainCatsForPlace(itemKey('家樂福 桂林店')), ['supermarket', 'home', 'electronics']);
  assert.deepEqual(chainCatsForPlace(itemKey('7-ELEVEN 長春門市')), ['convenience']);
  assert.deepEqual(chainCatsForPlace(itemKey('Chocolate Factory')), []);
  assert.deepEqual(chainCatsForPlace(itemKey('大全聯 中崙店')), ['supermarket', 'home', 'electronics']);
});

function store(id, name, distance, catsList, { open = 'open', hits = [] } = {}) {
  return {
    id, name, nameKey: itemKey(name), distance,
    lat: 25.05 + distance / 111000, lng: 121.53,
    cats: new Set(catsList), hits: new Set(hits), open: { state: open }
  };
}

test('coverage and trip planning', () => {
  const center = { lat: 25.05, lng: 121.53 };
  const items = ['牛奶', '雞蛋', '衛生紙', '感冒藥'].map((t, i) => ({ id: String(i), resolution: resolveItem(t) }));
  const s711 = store('a', '7-ELEVEN 長春門市', 80, ['convenience']);
  const px = store('b', '全聯 長春店', 400, ['supermarket']);
  const pharm = store('c', '大樹藥局', 300, ['pharmacy']);
  const closedPharm = store('d', '杏一藥局', 100, ['pharmacy'], { open: 'closed' });
  const steps = planTrip(items, [s711, px, pharm, closedPharm], center);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map(s => s.store.id), ['a', 'c'], 'nearest-first order, closed pharmacy skipped');
  assert.deepEqual(steps[0].itemIds, ['0', '1', '2']);
  assert.deepEqual(steps[1].itemIds, ['3']);

  // a one-stop supermarket slightly farther away beats two stops
  const items2 = ['牛奶', '洗衣精'].map((t, i) => ({ id: String(i), resolution: resolveItem(t) }));
  const steps2 = planTrip(items2, [s711, px], center);
  assert.deepEqual(steps2.map(s => s.store.id), ['b']);

  // chain item only covered by that chain
  const chainItem = { id: 'x', resolution: resolveItem('全聯') };
  assert.equal(storeCovers(px, chainItem.resolution), true);
  assert.equal(storeCovers(s711, chainItem.resolution), false);
  // name search item only covered by stores found via that search
  const nameItem = resolveItem('ㄅㄆㄇ');
  const found = store('e', '某店', 500, [], { hits: [`name:${nameItem.key}`] });
  assert.equal(storeCovers(found, nameItem), true);
  assert.equal(storeCovers(px, nameItem), false);
});

test('open state uses next open/close times', () => {
  const now = Date.parse('2026-10-02T13:00:00Z');
  assert.equal(openStateAt(null, now).state, 'unknown');
  assert.equal(openStateAt({ openNow: true, nextCloseTime: '2026-10-02T14:00:00Z' }, now).state, 'open');
  assert.equal(openStateAt({ openNow: true, nextCloseTime: '2026-10-02T12:30:00Z' }, now).state, 'closed', 'closed since cached');
  assert.equal(openStateAt({ openNow: false, nextOpenTime: '2026-10-02T12:00:00Z' }, now).state, 'open', 'opened since cached');
  const closed = openStateAt({ openNow: false, nextOpenTime: '2026-10-03T00:00:00Z' }, now);
  assert.equal(closed.state, 'closed');
  assert.equal(closed.openAt, Date.parse('2026-10-03T00:00:00Z'));
});
