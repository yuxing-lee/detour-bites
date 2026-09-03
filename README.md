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

## 部署到 GitHub Pages

這個 repo 對應 `https://github.com/yuxing-lee/detour-bites`，屬於「專案頁」（非帳號根網域頁），所以 `vite.config.js` 已設定 `base: '/detour-bites/'`，發布網址會是 `https://yuxing-lee.github.io/detour-bites/`。

部署流程（[.github/workflows/deploy.yml](.github/workflows/deploy.yml)）已寫好，push 到 `main`/`master` 就會自動建置並發布，你只需要做兩件事：

1. **設定 GitHub Secret**：repo 的 Settings → Secrets and variables → Actions → New repository secret，新增 `VITE_GOOGLE_MAPS_API_KEY`，值填你的 Google Maps API key。
2. **啟用 GitHub Pages（Actions 來源）**：repo 的 Settings → Pages → Build and deployment → Source 選擇 **GitHub Actions**（不是選分支）。

設定好之後，之後每次 push 到 `main`/`master` 都會觸發 workflow：`npm ci` → `npm run build`（會用剛剛設定的 secret 當環境變數注入）→ 把 `dist/` 部署到 GitHub Pages。也可以在 repo 的 Actions 分頁手動點 **Run workflow** 觸發一次。

別忘了在 Google Cloud Console 把 HTTP referrer 限制加上 `https://yuxing-lee.github.io/*`，否則正式站會因為網域不在允許清單而打不通 API。

## API key 安全性

`VITE_GOOGLE_MAPS_API_KEY` 會在建置時被 Vite 靜態注入前端程式碼、打包進最終產物，任何看得到已發布網頁原始碼的人都拿得到它——這是瀏覽器端地圖應用的正常曝光方式，`.env` 只是開發/建置階段的方便做法，不是金鑰的保密機制。務必在 Google Cloud Console：

- 設定 HTTP referrer 限制，只允許你的正式網域（開發時可另外加 localhost）
- 設定 API restrictions，只允許此專案實際用到的 API
- 建議使用專用 key，並留意配額與帳務，避免被盜用產生費用

## 專案結構

- `index.html` — 唯一的頁面與邏輯（Vite 進入點）
- `.env.example` — 環境變數範本
