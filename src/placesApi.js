import { GOOGLE_MAPS_API_KEY, PLACE_FIELD_MASK, SHOP_FETCH_OPENING_HOURS } from './config.js';

// 有填關鍵字時：改用 Text Search (New)，比對更接近 Google Maps 打字搜尋的語意/相關性
// locationBias 只是「軟性」偏好、不是硬性邊界，所以另外用實際距離過濾回半徑內
export async function textSearch(location, radius, keyword, openNow) {
  const body = {
    textQuery: keyword,
    maxResultCount: 20,
    locationBias: {
      circle: {
        center: { latitude: location.lat(), longitude: location.lng() },
        radius: radius
      }
    },
    rankPreference: 'DISTANCE',
    languageCode: 'zh-TW'
  };
  if (openNow) body.openNow = true;

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': PLACE_FIELD_MASK
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('searchText 回傳非 OK：', res.status, errText);
      return [];
    }

    const data = await res.json();
    const places = data.places || [];

    return places.filter(p => {
      if (!p.location) return false;
      const dist = google.maps.geometry.spherical.computeDistanceBetween(
        location,
        new google.maps.LatLng(p.location.latitude, p.location.longitude)
      );
      return dist <= radius;
    });
  } catch (err) {
    console.warn('searchText 發生錯誤：', err);
    return [];
  }
}

// 沒填關鍵字時：單純找附近餐廳，用 searchNearby 的硬性半徑限制
export async function nearbySearch(location, radius, keyword, openNow) {
  if (keyword) return textSearch(location, radius, keyword, openNow);

  const body = {
    includedTypes: ['restaurant'],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: location.lat(), longitude: location.lng() },
        radius: radius
      }
    },
    rankPreference: 'POPULARITY',
    languageCode: 'zh-TW'
  };
  // 注意：Nearby Search (New) 的 request schema 沒有 openNow 這個欄位，
  // Google 官方沒有提供這條路徑的伺服器端過濾，只能靠前端事後過濾

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': PLACE_FIELD_MASK
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('searchNearby 回傳非 OK：', res.status, errText);
      return [];
    }

    const data = await res.json();
    return data.places || [];
  } catch (err) {
    console.warn('searchNearby 發生錯誤：', err);
    return [];
  }
}

// 用 Place Details (New) 只抓 reviews 欄位；只在使用者點開單一店家、
// 或有填「想吃的餐點」需要逐間比對評論時才呼叫，避免每次搜尋都白白多打一堆 API
export async function fetchPlaceReviews(placeId) {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=zh-TW`, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'reviews'
      }
    });
    if (!res.ok) {
      console.warn('取得評論失敗：', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.reviews || [];
  } catch (err) {
    console.warn('取得評論發生錯誤：', err);
    return null;
  }
}

// 用 Place Details (New) 只抓 photos 欄位（metadata：name/寬高/攝影者署名，不含圖片本身）；
// 跟 fetchPlaceReviews 一樣只在使用者點開「查看照片」時才呼叫，避免每次搜尋都白白多打 API。
// 真正的圖片是另外用 photo.name 打 Place Photo Media 端點取得（見 utils.js 的 placePhotoMediaUrl），
// 那個端點才是計費的 SKU，這裡拿到的 metadata 本身不會額外收費
export async function fetchPlacePhotos(placeId) {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=zh-TW`, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'photos'
      }
    });
    if (!res.ok) {
      console.warn('取得照片失敗：', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.photos || [];
  } catch (err) {
    console.warn('取得照片發生錯誤：', err);
    return null;
  }
}

// 集章地圖用：舊版「吃過」清單只存了店名跟評分，沒有座標，第一次打開集章地圖時
// 用 Place Details (New) 只抓 location 補上（Essentials 等級，最便宜的一檔），補到就存回清單，之後不會再查
export async function fetchPlaceLocation(placeId) {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'location'
      }
    });
    if (!res.ok) {
      console.warn('取得店家座標失敗：', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.location ? { lat: data.location.latitude, lng: data.location.longitude } : null;
  } catch (err) {
    console.warn('取得店家座標發生錯誤：', err);
    return null;
  }
}

// ── 採買地圖 ──
// 只抓判斷「這間店賣不賣清單上的東西」跟「現在去買得到嗎」需要的欄位：
// primaryType / types 判斷店家類別、primaryTypeDisplayName 顯示給使用者看（例如「超市」）、
// businessStatus 濾掉歇業的店、googleMapsUri 讓使用者點去看店家頁面。
// currentOpeningHours 會讓請求落在 Enterprise 級距，見 config.js 的 SHOP_FETCH_OPENING_HOURS
function shopFieldMask() {
  const fields = [
    'places.id',
    'places.displayName',
    'places.location',
    'places.primaryType',
    'places.primaryTypeDisplayName',
    'places.types',
    'places.shortFormattedAddress',
    'places.businessStatus',
    'places.googleMapsUri'
  ];
  if (SHOP_FETCH_OPENING_HOURS) fields.push('places.currentOpeningHours');
  return fields.join(',');
}

// 回傳 { ok, status, errorText, places }：呼叫端要靠 status、errorText 判斷是不是 400（類型名稱不被接受），
// 決定要拿掉哪個類型重查
async function postShopSearch(method, body) {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places:${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': shopFieldMask()
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`${method}（採買）回傳非 OK：`, res.status, errorText);
      return { ok: false, status: res.status, errorText, places: [] };
    }
    const data = await res.json();
    return { ok: true, status: res.status, places: data.places || [] };
  } catch (err) {
    console.warn(`${method}（採買）發生錯誤：`, err);
    return { ok: false, status: 0, errorText: '', places: [] };
  }
}

// 依店家類型找 center 附近的店，由近到遠。types 是「任一類型符合」、primaryTypes 是「主要類型符合」
export function searchShopsNearby({ center, radius, types, primaryTypes }) {
  const body = {
    maxResultCount: 20,
    locationRestriction: {
      circle: { center: { latitude: center.lat, longitude: center.lng }, radius }
    },
    rankPreference: 'DISTANCE',
    languageCode: 'zh-TW'
  };
  if (types?.length) body.includedTypes = types;
  if (primaryTypes?.length) body.includedPrimaryTypes = primaryTypes;
  return postShopSearch('searchNearby', body);
}

// Google 沒有對應類型的店（文具店、傳統市場）、連鎖店名、或完全不知道類別的品項，用文字找。
// locationBias 只是偏好，不保證在範圍內，呼叫端要自己用距離過濾
export function searchShopsByText({ center, radius, query }) {
  return postShopSearch('searchText', {
    textQuery: query,
    pageSize: 20,
    locationBias: {
      circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radius, 50000) }
    },
    rankPreference: 'DISTANCE',
    languageCode: 'zh-TW'
  });
}
