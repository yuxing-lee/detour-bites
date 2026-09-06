import { GOOGLE_MAPS_API_KEY, PLACE_FIELD_MASK } from './config.js';

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
