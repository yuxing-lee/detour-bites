// Port of src/placesApi.js's textSearch/nearbySearch for the Node runtime:
// same request shapes, but distance filtering uses geo.js's haversine
// helper instead of google.maps.geometry.spherical (no `google` global here).
import { GOOGLE_MAPS_API_KEY, PLACE_FIELD_MASK } from './config.js';
import { haversineDistance } from './geo.js';

export async function textSearch(location, radius, keyword, openNow) {
  const body = {
    textQuery: keyword,
    maxResultCount: 20,
    locationBias: {
      circle: { center: { latitude: location.lat, longitude: location.lng }, radius }
    },
    rankPreference: 'DISTANCE',
    languageCode: 'zh-TW'
  };
  if (openNow) body.openNow = true;

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
    console.warn('searchText 回傳非 OK：', res.status, await res.text());
    return [];
  }

  const data = await res.json();
  const places = data.places || [];
  return places.filter(p => {
    if (!p.location) return false;
    const dist = haversineDistance(location, { lat: p.location.latitude, lng: p.location.longitude });
    return dist <= radius;
  });
}

export async function nearbySearch(location, radius, keyword, openNow) {
  if (keyword) return textSearch(location, radius, keyword, openNow);

  const body = {
    includedTypes: ['restaurant'],
    maxResultCount: 20,
    locationRestriction: {
      circle: { center: { latitude: location.lat, longitude: location.lng }, radius }
    },
    rankPreference: 'POPULARITY',
    languageCode: 'zh-TW'
  };

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
    console.warn('searchNearby 回傳非 OK：', res.status, await res.text());
    return [];
  }

  const data = await res.json();
  return data.places || [];
}
