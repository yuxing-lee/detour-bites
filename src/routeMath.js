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

// 沿路徑「開」的共用工具：先算好每個路徑點從起點累積的距離，之後給一個已經開過的距離，
// 就能查出車子目前的座標跟行進方向。查詢距離通常是遞增的（動畫一幀一幀往前），
// 所以記住上次停在哪一段、從那裡往後找；倒退時才從頭找
export function createPathWalker(path) {
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative.push(cumulative[i - 1] + google.maps.geometry.spherical.computeDistanceBetween(path[i - 1], path[i]));
  }
  const total = cumulative[cumulative.length - 1];
  let segIndex = 1;
  function at(distance) {
    const d = Math.min(total, Math.max(0, distance));
    if (cumulative[segIndex - 1] > d) segIndex = 1;
    while (segIndex < cumulative.length - 1 && cumulative[segIndex] < d) segIndex++;
    const A = path[segIndex - 1];
    const B = path[segIndex];
    const segLen = cumulative[segIndex] - cumulative[segIndex - 1];
    const frac = segLen > 0 ? (d - cumulative[segIndex - 1]) / segLen : 1;
    return {
      position: google.maps.geometry.spherical.interpolate(A, B, frac),
      heading: google.maps.geometry.spherical.computeHeading(A, B)
    };
  }
  return { total, at };
}

function normalizeAngleRad(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

const EARTH_RADIUS_M = 6371000;

// 把點 P 投影到路線上的一個線段 A→B，回傳「垂直於路線的距離」、
// 「沿路線方向、從路線起點累積到投影點的距離」、在行進方向的哪一側
// （side：正值 = 右側、負值 = 左側，單位公尺），以及投影點落在線段起點之前多遠（behindA）。
// 用球面三角的 cross-track / along-track 公式，短線段（一個 step 內的路徑點）誤差可忽略。
function projectPointOntoSegment(A, B, P, cumulativeToA, segLen) {
  const headingAB = google.maps.geometry.spherical.computeHeading(A, B);
  const distAP = google.maps.geometry.spherical.computeDistanceBetween(A, P);

  if (distAP < 0.5 || segLen < 0.5) {
    return { distance: distAP, progress: cumulativeToA, side: 0, behindA: 0 };
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
    return { distance: distAP, progress: cumulativeToA, side: crossTrack, behindA: -alongTrack };
  }
  if (alongTrack >= segLen) {
    const distBP = google.maps.geometry.spherical.computeDistanceBetween(B, P);
    return { distance: distBP, progress: cumulativeToA + segLen, side: crossTrack, behindA: 0 };
  }
  return { distance: Math.abs(crossTrack), progress: cumulativeToA + alongTrack, side: crossTrack, behindA: 0 };
}

// 找出點 P 到整條路線最近的位置：真正垂直於路線的距離（順路程度）、
// 沿路線方向從起點累積到那個位置的距離（用來確保排序不會忽前忽後）、
// 店在行進方向的哪一側（side，正 = 右、負 = 左），
// 以及店是否在起點後方（behindStart：最近的位置是第一段路線、而且投影落在起點之前，單位公尺）。
// 用逐步路徑計算可以避免把平行道路上的店算成貼著路線，但路的左右兩側要靠 side 另外判斷。
export function projectPointOntoRoutePath(point, path) {
  let cumulative = 0;
  let best = null;
  let bestIsFirstSegment = false;
  for (let i = 1; i < path.length; i++) {
    const A = path[i - 1];
    const B = path[i];
    const segLen = google.maps.geometry.spherical.computeDistanceBetween(A, B);
    if (segLen > 0) {
      const result = projectPointOntoSegment(A, B, point, cumulative, segLen);
      if (!best || result.distance < best.distance) {
        best = result;
        bestIsFirstSegment = i === 1;
      }
    }
    cumulative += segLen;
  }
  if (!best) {
    const only = path[0];
    return { distance: google.maps.geometry.spherical.computeDistanceBetween(only, point), progress: 0, side: 0, behindStart: 0 };
  }
  return {
    distance: best.distance,
    progress: best.progress,
    side: best.side,
    behindStart: bestIsFirstSegment ? best.behindA : 0
  };
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
