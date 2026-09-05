# detour-bites

一個純前端的 Google Maps 工具：輸入起點與目的地，沿路線每隔固定距離取樣，搜尋附近餐廳，並在地圖上標示、依評分排序列出結果。目的地可留空，這時會改成搜尋起點附近的餐廳。

## 需求

- Node.js 18 / 20 / 22（含）以上版本
- 一組已啟用下列服務的 Google Maps API key：
  - Maps JavaScript API
  - Directions API
  - Geocoding API（目的地留空、只搜尋起點附近時，用來把起點文字轉換成經緯度）
  - Places API (New)
- （選填）一組已啟用 Generative Language API 的 Gemini API key，用來開啟 AI 評論摘要 / 關鍵字口語解析功能

## 安裝與啟動

```bash
npm install
cp .env.example .env
# 編輯 .env，填入你的 VITE_GOOGLE_MAPS_API_KEY（必填）
# 選填：填入 VITE_GEMINI_API_KEY 開啟 AI 功能，留空則兩個 AI 按鈕會自動隱藏
npm run dev
```

## AI 功能（選填，需要 Gemini API key）

有設定 `VITE_GEMINI_API_KEY` 時，會多兩個功能：

- **✨ AI 摘要**：在餐廳卡片點這顆按鈕，會抓該店的 Google 評論丟給 Gemini，生成一段整體評價／推薦菜色／注意事項的摘要。
- **✨ AI 解析**（關鍵字欄位旁）：關鍵字欄位可以打口語一點的描述，例如「便宜、現在有開的」，按下 AI 解析後會拆成「搜尋關鍵字」＋自動勾選「只顯示營業中」／切成「價格低到高」排序。

兩個功能都會依序嘗試 `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemma-3-27b-it`（見 `index.html` 的 `GEMINI_MODEL_CHAIN`）。這幾個 model 在 Google 那邊的免費額度是分開算的，前面的額度用完或暫時出錯時會自動換下一個，藉此把每天可用的免費呼叫次數疊加起來；全部都失敗才會顯示錯誤訊息。

沒有設定這組 key 的話，這兩顆按鈕會自動隱藏，其餘功能不受影響。

## 建置與預覽

```bash
npm run build
npm run preview
```

`npm run build` 產生的 `dist/` 可以部署到任何靜態主機（GitHub Pages、Netlify、Vercel 等）。`npm run preview` 只是本機驗證用，不是正式的 production server。

## 部署到 GitHub Pages

這個 repo 對應 `https://github.com/yuxing-lee/detour-bites`，屬於「專案頁」（非帳號根網域頁），所以 `vite.config.js` 已設定 `base: '/detour-bites/'`，發布網址會是 `https://yuxing-lee.github.io/detour-bites/`。

部署流程（[.github/workflows/deploy.yml](.github/workflows/deploy.yml)）已寫好，push 到 `main`/`master` 就會自動建置並發布，你只需要做兩件事：

1. **設定 GitHub Secret**：repo 的 Settings → Secrets and variables → Actions → New repository secret，新增 `VITE_GOOGLE_MAPS_API_KEY`，值填你的 Google Maps API key。若要啟用 AI 摘要/AI 解析功能，同樣新增一個 `VITE_GEMINI_API_KEY` secret，值填你的 Gemini API key（選填，留空則 AI 功能不會出現）。
2. **啟用 GitHub Pages（Actions 來源）**：repo 的 Settings → Pages → Build and deployment → Source 選擇 **GitHub Actions**（不是選分支）。

設定好之後，之後每次 push 到 `main`/`master` 都會觸發 workflow：`npm ci` → `npm run build`（會用剛剛設定的 secret 當環境變數注入）→ 把 `dist/` 部署到 GitHub Pages。也可以在 repo 的 Actions 分頁手動點 **Run workflow** 觸發一次。

別忘了在 Google Cloud Console 把 HTTP referrer 限制加上 `https://yuxing-lee.github.io/*`，否則正式站會因為網域不在允許清單而打不通 API。

## API key 安全性

`VITE_GOOGLE_MAPS_API_KEY`（以及選填的 `VITE_GEMINI_API_KEY`）都會在建置時被 Vite 靜態注入前端程式碼、打包進最終產物，任何看得到已發布網頁原始碼的人都拿得到它——這是瀏覽器端應用的正常曝光方式，`.env` 只是開發/建置階段的方便做法，不是金鑰的保密機制。務必在 Google Cloud Console：

- 設定 HTTP referrer 限制，只允許你的正式網域（開發時可另外加 localhost）
- 設定 API restrictions，只允許此專案實際用到的 API（Gemini key 就只勾 Generative Language API）
- 建議每組用途各用專用 key，並留意配額與帳務，避免被盜用產生費用

## 專案結構

- `index.html` — 唯一的頁面與邏輯（Vite 進入點）
- `.env.example` — 環境變數範本
