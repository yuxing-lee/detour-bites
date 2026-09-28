export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
// 選填：有設定才會改用 Advanced Markers + 雲端樣式；沒設定就維持舊版 Marker + 程式內的 JSON 樣式
export const GOOGLE_MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;
// 依序嘗試的 model 清單：每個 model 在 Google 那邊是各自獨立的免費額度，
// 前面的 model 額度用完（或暫時出錯）就自動換下一個，盡量把整體可用額度疊加起來。
// gemma 系列跟 Gemini 系列的免費配額是分開算的，所以放在清單最後面當保底。
export const GEMINI_MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemma-3-27b-it'];
// 沿路取樣：Places 搜尋是按「次數」計費（跟半徑大小無關），取樣點越多越耗免費額度。
// 短路線用至少 MIN_SAMPLE_INTERVAL_KM 的間距讓涵蓋率夠密，長路線則把間距拉大，
// 確保一次順路搜尋最多只打 MAX_SAMPLE_POINTS 次
export const MIN_SAMPLE_INTERVAL_KM = 3;
export const MAX_SAMPLE_POINTS = 12;
// 填了「評論要提到的餐點」時，最多對幾間候選店家查評論（每間一次 Place Details 計費）
export const MAX_REVIEW_CANDIDATES = 20;
// 同時送出的 Places 請求數上限，平行查詢比逐一查詢快很多，但不要一次全部丟出去
export const PLACES_CONCURRENCY = 6;
// 點卡片/marker 開 InfoWindow 時會強制 zoom 到這個層級（見 panForInfoWindow），
// clusterer 的 maxZoom 必須小於這個值，不然開窗當下那顆 marker 還可能被收進 cluster
// 隱藏掉，變成 InfoWindow 指著一顆數字圓點而不是實際的店家 marker
export const PLACE_INFO_ZOOM = 15;
export const CLUSTER_MAX_ZOOM = PLACE_INFO_ZOOM - 1;

// 台灣靠右行駛：行進方向右側的店可以直接彎進去，左側（對向）的店在寬的路上要迴轉。
// 店家座標常標在建築物中心甚至路中間，離路線中心這個距離內的店一律視為同側，避免誤判
export const OPPOSITE_SIDE_TOLERANCE_M = 20;
// 投影落在起點後方超過這個距離的店視為「已經開過頭」，順路搜尋直接排除
export const BEHIND_START_TOLERANCE_M = 30;

export const SEARCH_STORAGE_KEY = 'detour-bites:lastSearch';
export const EATEN_STORAGE_KEY = 'detour-bites:eatenPlaces';

// Place Photo Media 端點是額外計費的 SKU（跟抓 photos 欄位本身的 metadata 不同），
// 每次「查看照片」點擊最多只載入這麼多張，避免使用者連點或店家照片很多時一次觸發大量計費請求
export const PLACE_PHOTO_MAX_COUNT = 8;
// 縮圖寬度：夠清楚辨認內容即可，不需要原尺寸，減少流量
export const PLACE_PHOTO_WIDTH_PX = 480;

export const PLACE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.priceRange',
  'places.currentOpeningHours.openNow',
  'places.websiteUri',
  // 地圖標記依店家類型顯示美食圖示用；上面的 rating / currentOpeningHours 已經是最高計費級距，
  // 多這個欄位不會讓 Text Search / Nearby Search 的計費再往上跳
  'places.primaryType'
].join(',');

export const PRICE_LABELS = {
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$'
};

export const PRICE_RANK = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4
};

// websiteUri 常見的網域是這些線上訂位平台本身（餐廳沒自架官網、直接把訂位頁當「網站」登記），
// 這種情況可以比對網域先告訴使用者「這是訂位連結」；比對不到的話沒辦法知道網址底下有沒有訂位頁面
// （例如官網自己架、藏在某個子頁面），只能顯示中性的「官方網站」讓使用者自己找
export const RESERVATION_PLATFORM_DOMAINS = [
  'inline.app',
  'eztable.com',
  'tablecheck.com',
  'opentable.com',
  'resy.com',
  'quandoo.com',
  'chope.co',
  'sevenrooms.com',
  'zenchef.com',
  'formitable.com'
];

// 免 AI 的同義詞擴充：把「想吃的餐點」拆成多個詞，每個詞再對照下面的同義詞群組展開，
// 只要評論裡出現任何一個展開後的詞就算比對到，緩解使用者打法跟評論用字不一致的問題
// （例如打「便宜」也能比對到寫「划算」「平價」的評論）。清單不求全，之後真的比對不到再交給 AI。
export const DISH_SYNONYM_GROUPS = [
  ['便宜', '划算', '平價', '俗又大碗', '俗擱大碗', 'cp值高', 'CP值高'],
  ['甜點', '甜食', '甜的', '甜品', '飯後甜點'],
  ['辣', '麻辣', '辣味', '夠辣'],
  ['早餐', '早午餐', 'brunch', 'Brunch'],
  ['消夜', '宵夜'],
  ['約會', '氣氛好', '氛圍佳', '浪漫'],
  ['特別', '特色', '招牌', '必點', '推薦菜'],
  ['清淡', '不辣', '養生'],
  ['份量大', '份量足', '吃得飽', '大碗']
];

// 免 AI、每次搜尋都會自動跑一遍的關鍵字清理：用固定的規則把常見的口語篩選詞
// （現在有開、便宜等）從關鍵字裡挑出來變成篩選條件，剩下的文字才拿去做地圖文字搜尋，
// 避免這些字混在 textQuery 裡稀釋掉真正的料理名稱/店名關鍵字。跟 parseKeywordWithGemini
// 回傳同一種格式，方便共用下游邏輯；規則涵蓋不到的說法（更抽象的口語）才會交給 AI 解析。
export const KEYWORD_FILTER_PATTERNS = [
  { re: /(現在|目前)?(營業中|還在營業|有開著|還有開|有開|開著)/g, flag: 'openNow' },
  { re: /(便宜|划算|平價|俗又大碗|俗擱大碗|cp值高)/gi, flag: 'preferCheap' }
];

// 地圖標記的美食圖示：primaryType（例如 ramen_restaurant、wine_bar）拆成單字後，
// 從左到右第一個對得上的字決定圖示，所以 wine_bar 會是 🍷 而不是 🍺、steak_house 不會誤判成 tea。
// 對不到的（一般 restaurant、food 等）用 FOOD_EMOJI_DEFAULT
export const FOOD_EMOJI_BY_TYPE_WORD = {
  ramen: '🍜', noodle: '🍜', sushi: '🍣', japanese: '🍱', korean: '🍲', chinese: '🥢', taiwanese: '🥢',
  thai: '🍛', indian: '🍛', vietnamese: '🍜', italian: '🍝', pizza: '🍕', mexican: '🌮', french: '🥖',
  hamburger: '🍔', burger: '🍔', fast: '🍟', sandwich: '🥪', chicken: '🍗', dumpling: '🥟',
  steak: '🥩', barbecue: '🍖', seafood: '🦐', pot: '🍲', vegan: '🥗', vegetarian: '🥗',
  breakfast: '🍳', brunch: '🥞', bakery: '🥐', bagel: '🥯', donut: '🍩', dessert: '🍰',
  cake: '🍰', confectionery: '🍬', chocolate: '🍫', ice: '🍦', cream: '🍦', juice: '🧃',
  cafe: '☕', coffee: '☕', tea: '🧋', wine: '🍷', bar: '🍺', pub: '🍺'
};
export const FOOD_EMOJI_DEFAULT = '🍽️';

export const EATEN_GOOD_RATING_THRESHOLD = 4;
// 勾選「包含吃過的高評價餐廳」時，固定有這個比例的機率會從舊愛裡抽，其餘機率抽新店，
// 不受這次搜尋路線上剛好有幾間舊餐廳影響（避免路線上舊愛一多就蓋過新店機會，或一間都沒有時 checkbox 形同虛設）
export const OLD_FAVORITE_RATIO = 0.25;
