// Server-side config for the /api/* serverless functions.
// Deliberately separate from src/config.js: these read plain process.env
// (server-only secrets, never bundled to the browser), not
// import.meta.env.VITE_* (which is Vite's client-bundle mechanism and
// wouldn't be populated the same way when these functions run under
// Vercel's Node runtime instead of the Vite build).
export const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Shared secret the caller (iPhone Shortcut) must send back in the
// X-API-Key header. Deliberately fails closed (see _lib/auth.js) if unset,
// so forgetting to configure it in Vercel can't silently expose the API.
export const SHORTCUTS_API_KEY = process.env.SHORTCUTS_API_KEY;

export const GEMINI_MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemma-3-27b-it'];

// 沿路取樣 — same as src/config.js. Places 搜尋按次數計費，短路線用至少
// MIN_SAMPLE_INTERVAL_KM 的間距讓涵蓋率夠密，長路線把間距拉大，確保一次最多打 MAX_SAMPLE_POINTS 次
export const MIN_SAMPLE_INTERVAL_KM = 3;
export const MAX_SAMPLE_POINTS = 12;

// 台灣靠右行駛：離路線中心這個距離內的店一律視為同側，超過且在左側才算對向 — same as src/config.js
export const OPPOSITE_SIDE_TOLERANCE_M = 20;
// 投影落在起點後方超過這個距離的店視為「已經開過頭」，順路搜尋直接排除
export const BEHIND_START_TOLERANCE_M = 30;

export const DEFAULT_RADIUS_M = 1200;
export const MIN_RADIUS_M = 100;
export const MAX_RADIUS_M = 5000;

export const DEFAULT_RESULT_LIMIT = 15;
export const MAX_RESULT_LIMIT = 30;

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
  'places.websiteUri'
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

// Same rule-based keyword filter as src/config.js's KEYWORD_FILTER_PATTERNS —
// kept in sync by hand since this module intentionally doesn't import from src/.
export const KEYWORD_FILTER_PATTERNS = [
  { re: /(現在|目前)?(營業中|還在營業|有開著|還有開|有開|開著)/g, flag: 'openNow' },
  { re: /(便宜|划算|平價|俗又大碗|俗擱大碗|cp值高)/gi, flag: 'preferCheap' }
];
