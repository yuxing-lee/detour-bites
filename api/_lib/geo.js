// Pure-JS port of src/routeMath.js for the Node/Vercel runtime, which has
// no `google` global (no Maps JS SDK loaded). Same haversine / cross-track
// projection math, just spelled out by hand instead of calling
// google.maps.geometry.spherical.*. Points are plain {lat, lng} objects
// instead of google.maps.LatLng.

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function normalizeAngleRad(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function haversineDistance(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function initialBearingRad(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.atan2(y, x);
}

// Decodes a Google encoded polyline string into [{lat, lng}, ...]
// (standard Google polyline algorithm — https://developers.google.com/maps/documentation/utilities/polylinealgorithm)
export function decodePolyline(encoded) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const points = [];

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

// 沿路徑每隔 intervalKm 公里取一個採樣點 — same as src/routeMath.js
export function samplePointsAlongPath(path, intervalKm) {
  const points = [];
  let accumulated = 0;
  points.push(path[0]);
  for (let i = 1; i < path.length; i++) {
    const segDist = haversineDistance(path[i - 1], path[i]) / 1000;
    accumulated += segDist;
    if (accumulated >= intervalKm) {
      points.push(path[i]);
      accumulated = 0;
    }
  }
  const last = path[path.length - 1];
  if (points[points.length - 1] !== last) points.push(last);
  return points;
}

function projectPointOntoSegment(A, B, P, cumulativeToA, segLen) {
  const bearingAB = initialBearingRad(A, B);
  const distAP = haversineDistance(A, P);

  if (distAP < 0.5 || segLen < 0.5) {
    return { distance: distAP, progress: cumulativeToA };
  }

  const bearingAP = initialBearingRad(A, P);
  const dr = distAP / EARTH_RADIUS_M;
  const bearingDiff = normalizeAngleRad(bearingAP - bearingAB);

  const crossTrack = Math.asin(Math.sin(dr) * Math.sin(bearingDiff)) * EARTH_RADIUS_M;
  let alongTrackRatio = Math.cos(dr) / Math.cos(crossTrack / EARTH_RADIUS_M);
  alongTrackRatio = Math.max(-1, Math.min(1, alongTrackRatio));
  let alongTrack = Math.acos(alongTrackRatio) * EARTH_RADIUS_M;
  if (Number.isNaN(alongTrack)) alongTrack = 0;
  if (Math.abs(bearingDiff) > Math.PI / 2) alongTrack = -alongTrack;

  if (alongTrack <= 0) {
    return { distance: distAP, progress: cumulativeToA };
  }
  if (alongTrack >= segLen) {
    const distBP = haversineDistance(B, P);
    return { distance: distBP, progress: cumulativeToA + segLen };
  }
  return { distance: Math.abs(crossTrack), progress: cumulativeToA + alongTrack };
}

// 找出點 P 到整條路線最近的位置（垂直距離）與沿路線累積進度 — same as src/routeMath.js
export function projectPointOntoRoutePath(point, path) {
  let cumulative = 0;
  let best = null;
  for (let i = 1; i < path.length; i++) {
    const A = path[i - 1];
    const B = path[i];
    const segLen = haversineDistance(A, B);
    if (segLen > 0) {
      const result = projectPointOntoSegment(A, B, point, cumulative, segLen);
      if (!best || result.distance < best.distance) best = result;
    }
    cumulative += segLen;
  }
  if (!best) {
    return { distance: haversineDistance(path[0], point), progress: 0 };
  }
  return best;
}
