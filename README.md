# detour-bites

一個純前端的 Google Maps 工具：輸入起點與目的地，沿路線每隔固定距離取樣，搜尋附近餐廳，並在地圖上標示、依評分排序列出結果。

## 需求

- Node.js 18 / 20 / 22（含）以上版本
- 一組已啟用下列服務的 Google Maps API key：
  - Maps JavaScript API
  - Directions API
  - Places API (New)

## 安裝與啟動

```bash
npm install
cp .env.example .env
# 編輯 .env，填入你的 VITE_GOOGLE_MAPS_API_KEY
npm run dev
```

## 建置與預覽

```bash
npm run build
npm run preview
```

`npm run build` 產生的 `dist/` 可以部署到任何靜態主機（GitHub Pages、Netlify、Vercel 等）。`npm run preview` 只是本機驗證用，不是正式的 production server。

## API key 安全性

`VITE_GOOGLE_MAPS_API_KEY` 會在建置時被 Vite 靜態注入前端程式碼、打包進最終產物，任何看得到已發布網頁原始碼的人都拿得到它——這是瀏覽器端地圖應用的正常曝光方式，`.env` 只是開發/建置階段的方便做法，不是金鑰的保密機制。務必在 Google Cloud Console：

- 設定 HTTP referrer 限制，只允許你的正式網域（開發時可另外加 localhost）
- 設定 API restrictions，只允許此專案實際用到的 API
- 建議使用專用 key，並留意配額與帳務，避免被盜用產生費用

## 專案結構

- `index.html` — 唯一的頁面與邏輯（Vite 進入點）
- `.env.example` — 環境變數範本
