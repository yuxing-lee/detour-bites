import { isAuthorized } from './_lib/auth.js';
import {
  GOOGLE_MAPS_API_KEY,
  GEMINI_API_KEY,
  SAMPLE_INTERVAL_KM,
  DEFAULT_RADIUS_M,
  MIN_RADIUS_M,
  MAX_RADIUS_M,
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  PRICE_RANK
} from './_lib/config.js';
import { resolveLocation, fetchDirections, buildDetailedRoutePathFromRoute, summarizeRoute } from './_lib/directions.js';
import { samplePointsAlongPath, projectPointOntoRoutePath, haversineDistance, decodePolyline } from './_lib/geo.js';
import { nearbySearch } from './_lib/places.js';
import { localParseKeyword, parseKeywordWithGemini } from './_lib/keyword.js';
import { priceText, buildNavUrl } from './_lib/format.js';

const SORT_VALUES = ['route', 'rating', 'price'];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function toResultView(p, origin, destination) {
  const location = { lat: p.location.latitude, lng: p.location.longitude };
  return {
    id: p.id,
    name: p.displayName?.text || '(未命名)',
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? 0,
    priceLabel: priceText(p) || null,
    address: p.formattedAddress || '',
    openNow: p.currentOpeningHours?.openNow ?? null,
    location,
    routeDistanceM: Math.round(p._routeDistance),
    navUrl: buildNavUrl(location, origin, destination),
    websiteUri: p.websiteUri || null
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed, use POST' });
    return;
  }
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!GOOGLE_MAPS_API_KEY) {
    res.status(500).json({ error: 'Server 未設定 GOOGLE_MAPS_API_KEY' });
    return;
  }

  const body = req.body || {};
  const originText = typeof body.origin === 'string' ? body.origin.trim() : '';
  const destinationText = typeof body.destination === 'string' ? body.destination.trim() : '';
  const rawKeyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
  const radius = clamp(Number.isFinite(body.radius) ? body.radius : DEFAULT_RADIUS_M, MIN_RADIUS_M, MAX_RADIUS_M);
  const sort = SORT_VALUES.includes(body.sort) ? body.sort : (destinationText ? 'route' : 'rating');
  const limit = clamp(Number.isFinite(body.limit) ? body.limit : DEFAULT_RESULT_LIMIT, 1, MAX_RESULT_LIMIT);

  if (!originText) {
    res.status(400).json({ error: '缺少 origin' });
    return;
  }

  try {
    // 關鍵字解析：跟網頁版一樣先跑規則式，有設 GEMINI_API_KEY 才疊加 AI 解析，
    // 讓 Siri 口述「附近便宜的拉麵，現在有開的」也能拆成 keyword + 篩選條件
    let keyword = '';
    let openNow = !!body.openNow;
    let preferCheap = false;
    if (rawKeyword) {
      const local = localParseKeyword(rawKeyword);
      keyword = local.keyword;
      openNow = openNow || local.openNow;
      preferCheap = preferCheap || local.preferCheap;
      if (GEMINI_API_KEY) {
        try {
          const aiParsed = await parseKeywordWithGemini(rawKeyword);
          openNow = openNow || !!aiParsed.openNow;
          preferCheap = preferCheap || !!aiParsed.preferCheap;
          if (aiParsed.keyword?.trim()) keyword = aiParsed.keyword.trim();
        } catch (err) {
          console.warn('Gemini 關鍵字解析失敗，改用本機解析結果：', err);
        }
      }
    }

    let route = null;
    let samplePoints;
    let detailedPath = null;
    let originLocation = null;

    if (destinationText) {
      const googleRoute = await fetchDirections(originText, destinationText);
      detailedPath = buildDetailedRoutePathFromRoute(googleRoute);
      samplePoints = samplePointsAlongPath(decodePolyline(googleRoute.overview_polyline.points), SAMPLE_INTERVAL_KM);
      route = summarizeRoute(googleRoute);
    } else {
      originLocation = await resolveLocation(originText);
      samplePoints = [originLocation];
    }

    // 沿路每個取樣點平行打 Places API（跟網頁版依序打 + 150ms 間隔不同：
    // 語音互動在意的是總延遲，平行呼叫把整體回應時間壓在一兩秒內）
    const perPointResults = await Promise.all(
      samplePoints.map(pt => nearbySearch(pt, radius, keyword, openNow))
    );

    const dedup = new Map();
    perPointResults.flat().forEach(p => {
      if (!p.id || !p.location) return;
      if (!dedup.has(p.id)) dedup.set(p.id, p);
    });
    let results = Array.from(dedup.values());

    results.forEach(p => {
      const placeLatLng = { lat: p.location.latitude, lng: p.location.longitude };
      p._routeDistance = detailedPath
        ? projectPointOntoRoutePath(placeLatLng, detailedPath).distance
        : haversineDistance(originLocation, placeLatLng);
    });

    const priceOf = p => PRICE_RANK[p.priceLevel] || 99;
    const primaryCompare = sort === 'rating'
      ? (a, b) => (b.rating || 0) - (a.rating || 0)
      : sort === 'price'
        ? (a, b) => priceOf(a) - priceOf(b)
        : (a, b) => a._routeDistance - b._routeDistance;

    // preferCheap（口語「便宜」）當成選定排序之外的 tiebreaker，同分/同距離時優先排便宜的，
    // 不整個覆蓋掉使用者選的排序方式（例如 sort=route 時仍以順路優先為主）
    results.sort((a, b) => primaryCompare(a, b) || (preferCheap ? priceOf(a) - priceOf(b) : 0));

    results = results.slice(0, limit).map(p => toResultView(p, originText, destinationText));

    res.status(200).json({ route, count: results.length, results });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message || '搜尋失敗' });
  }
}
