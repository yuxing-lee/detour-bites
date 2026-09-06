// 沿路徑每隔 intervalKm 公里取一個採樣點
export function samplePointsAlongPath(path, intervalKm) {
  const points = [];
  let accumulated = 0;
  points.push(path[0]);
  for (let i = 1; i < path.length; i++) {
    const segDist = google.maps.geometry.spherical.computeDistanceBetween(path[i - 1], path[i]) / 1000;
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

// 把路線每個 leg 的每個 step 的詳細座標串成一條完整、有方向性的路徑
// （比 overview_path 精細很多，而且只包含「你會實際開的那個方向的車道」，
// 不會混到對向車道或平行道路）
export function buildDetailedRoutePath(route) {
  const points = [];
  (route.legs || []).forEach(leg => {
    (leg.steps || []).forEach(step => {
      const stepPath = step.path && step.path.length ? step.path : [step.start_location, step.end_location];
      stepPath.forEach(pt => {
        const last = points[points.length - 1];
        if (!last || !last.equals(pt)) points.push(pt);
      });
    });
  });
  return points.length >= 2 ? points : route.overview_path;
}

function normalizeAngleRad(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

const EARTH_RADIUS_M = 6371000;

// 把點 P 投影到路線上的一個線段 A→B，回傳「垂直於路線的距離」與
// 「沿路線方向、從路線起點累積到投影點的距離」。
// 用球面三角的 cross-track / along-track 公式，短線段（一個 step 內的路徑點）誤差可忽略。
function projectPointOntoSegment(A, B, P, cumulativeToA, segLen) {
  const headingAB = google.maps.geometry.spherical.computeHeading(A, B);
  const distAP = google.maps.geometry.spherical.computeDistanceBetween(A, P);

  if (distAP < 0.5 || segLen < 0.5) {
    return { distance: distAP, progress: cumulativeToA };
  }

  const bearingAB = (headingAB * Math.PI) / 180;
  const bearingAP = (google.maps.geometry.spherical.computeHeading(A, P) * Math.PI) / 180;
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
    const distBP = google.maps.geometry.spherical.computeDistanceBetween(B, P);
    return { distance: distBP, progress: cumulativeToA + segLen };
  }
  return { distance: Math.abs(crossTrack), progress: cumulativeToA + alongTrack };
}

// 找出點 P 到整條路線最近的位置：真正垂直於路線的距離（順路程度），
// 以及沿路線方向從起點累積到那個位置的距離（用來確保排序不會忽前忽後）。
// 因為是用有方向性的逐步路徑計算，天生就不會把對向車道/反方向路段誤判成「順路」。
export function projectPointOntoRoutePath(point, path) {
  let cumulative = 0;
  let best = null;
  for (let i = 1; i < path.length; i++) {
    const A = path[i - 1];
    const B = path[i];
    const segLen = google.maps.geometry.spherical.computeDistanceBetween(A, B);
    if (segLen > 0) {
      const result = projectPointOntoSegment(A, B, point, cumulative, segLen);
      if (!best || result.distance < best.distance) best = result;
    }
    cumulative += segLen;
  }
  if (!best) {
    const only = path[0];
    return { distance: google.maps.geometry.spherical.computeDistanceBetween(only, point), progress: 0 };
  }
  return best;
}

export function summarizeRoute(route) {
  let distanceMeters = 0;
  let durationSeconds = 0;
  route.legs.forEach(leg => {
    distanceMeters += leg.distance ? leg.distance.value : 0;
    durationSeconds += leg.duration ? leg.duration.value : 0;
  });
  const km = (distanceMeters / 1000).toFixed(1);
  const mins = Math.round(durationSeconds / 60);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  const durationText = hours > 0 ? `${hours} 小時 ${remMins} 分` : `${mins} 分`;
  return `${km} 公里・約 ${durationText}`;
}
