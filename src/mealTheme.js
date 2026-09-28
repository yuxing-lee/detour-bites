import { MEAL_THEMES } from './config.js';
import { mealBadgeEl } from './dom.js';
import { mapState } from './state.js';

// 用餐時段主題：依現在幾點套用 MEAL_THEMES 裡對應的強調色跟標語。
// 顏色寫進 :root 的 CSS 變數，全站按鈕、地圖標記一起換；地圖路線線條跟舊版 Marker
// 是在 JS 裡上色的，透過 currentMealTheme() 取用。頁面開著跨過時段時每幾分鐘會自動換一次。

function themeForHour(hour) {
  return MEAL_THEMES.find(t => (t.from < t.to ? hour >= t.from && hour < t.to : hour >= t.from || hour < t.to))
    || MEAL_THEMES[1];
}

let current = null;

export function currentMealTheme() {
  return current || themeForHour(new Date().getHours());
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function applyMealTheme(date = new Date()) {
  const theme = themeForHour(date.getHours());
  if (current && current.id === theme.id) return;
  current = theme;

  const root = document.documentElement.style;
  root.setProperty('--amber', theme.amber);
  root.setProperty('--amber-rgb', hexToRgb(theme.amber));
  root.setProperty('--amber-hi', theme.amberHi);
  root.setProperty('--amber-dim', theme.amberDim);
  document.documentElement.dataset.meal = theme.id;

  mealBadgeEl.textContent = `${theme.emoji} ${theme.label}・${theme.tagline}`;
  mealBadgeEl.hidden = false;

  // 路線線條的顏色只在下一次畫路線時生效（DirectionsRenderer 不會重畫已經畫好的線）
  if (mapState.directionsRenderer) {
    mapState.directionsRenderer.setOptions({ polylineOptions: { strokeColor: theme.amber, strokeWeight: 5 } });
  }
}

applyMealTheme();
setInterval(() => applyMealTheme(), 5 * 60 * 1000);
