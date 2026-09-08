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

## API（部署到 Vercel，給 iPhone 捷徑 / Siri 用）

`api/` 底下是一組獨立的 Vercel Serverless Functions，跟上面的靜態網站是分開的兩件事：網站給人用瀏覽器開，這組 API 給 iPhone 捷徑（Shortcuts）程式化呼叫，讓你可以用 Siri 一來一回地找餐廳，例如「Hey Siri，幫我找餐廳」→ 口述想吃什麼 → Siri 唸出推薦餐廳 → 說「換一間」或「導航」。

搜尋邏輯（沿路取樣、順路距離計算、關鍵字口語解析）跟網頁版共用同一套演算法，只是移植成不依賴瀏覽器 `google.maps` JS SDK 的版本（見 `api/_lib/`），改用 Directions / Geocoding / Places 的 REST 端點。

### 部署

1. 到 [vercel.com](https://vercel.com) 用同一個 GitHub 帳號登入，New Project 選這個 repo（`detour-bites`）。Build 設定保持預設即可——`vercel.json` 已經設定成**不要**在 Vercel 上跑 Vite 前端 build（只部署 `api/` 底下的 serverless functions；根目錄 `https://<your-app>.vercel.app/` 會看到一個小提示頁）。這是刻意的：`vite.config.js` 的 `base: '/detour-bites/'` 是配合 GitHub Pages「專案頁」網址（`.../detour-bites/`）寫死的，如果讓 Vercel 也跑 `npm run build` 並把 `dist/` 部署到網域根目錄，所有 CSS/JS 的路徑都會指向不存在的 `/detour-bites/...` 而 404，畫面會直接跑版——網站本體只在 GitHub Pages 上，Vercel 這邊純粹是 API。GitHub Pages 的部署流程完全不受影響，繼續照舊。
2. Vercel Project → Settings → Environment Variables，新增：
   - `GOOGLE_MAPS_API_KEY`：**另外開一組新的** Google Maps API key（**不要**沿用 `VITE_GOOGLE_MAPS_API_KEY`）。這組 key 只會留在 Vercel 伺服器端，不會被打包進任何前端程式碼，所以不能用 HTTP referrer 限制（伺服器對伺服器的請求沒有 referrer），改成在 Google Cloud Console 用 **API restrictions** 只允許 Directions API、Geocoding API、Places API (New) 這三個，並考慮設定每日配額上限。
   - `GEMINI_API_KEY`（選填）：同樣另開一組（不要沿用 `VITE_GEMINI_API_KEY`），用來讓 API 也支援口語關鍵字解析（例如「附近便宜的拉麵，現在有開的」）。留空則只用免 AI 的規則式解析。
   - `SHORTCUTS_API_KEY`：你自己隨機產生的一組密鑰字串（例如 `openssl rand -hex 24`），呼叫端（捷徑）要在 `X-API-Key` header 帶上同樣的值才能通過驗證，用來擋掉知道網址但沒有這把密鑰的陌生人，避免被盜用消耗你的 Google API 額度與費用。**這個變數沒設定的話 `/api/search` 會直接全部拒絕（401），不會變成沒驗證的公開 API。**
3. 存好環境變數後觸發一次部署（Deployments 頁手動 Redeploy，或隨便 push 一個 commit）。之後可以用你的 Vercel 網域測試：

   ```bash
   curl -s https://<your-app>.vercel.app/api/health
   # {"ok":true,"time":"..."}

   curl -s -X POST https://<your-app>.vercel.app/api/search \
     -H "Content-Type: application/json" \
     -H "X-API-Key: <你的 SHORTCUTS_API_KEY>" \
     -d '{"origin":"25.0330,121.5654","keyword":"拉麵","sort":"rating"}'
   ```

### `POST /api/search`

Request body（JSON）：

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `origin` | ✅ | `"緯度,經度"`（例如 iPhone「取得目前位置」給的座標）或地址文字（會用 Geocoding API 解析） |
| `destination` | ✗ | 地址文字；留空＝只搜 `origin` 附近（跟網頁版目的地留空時行為一致） |
| `keyword` | ✗ | 料理/店名，可以是口語（「便宜的拉麵，現在有開」），會先跑規則式解析，有設 `GEMINI_API_KEY` 再疊加 AI 解析 |
| `radius` | ✗ | 搜尋半徑（公尺），預設 1200，範圍 100–5000 |
| `openNow` | ✗ | `true` 則只看營業中（跟從 `keyword` 解析出的口語 openNow 是「或」的關係） |
| `sort` | ✗ | `"route"`（順路優先，有 `destination` 時預設）／`"rating"`（評分高到低，沒有 `destination` 時預設）／`"price"`（便宜到貴） |
| `limit` | ✗ | 最多回傳幾間，預設 15，上限 30 |

Response 200（JSON）：

```json
{
  "route": { "distanceText": "12.3 公里", "durationText": "23 分" },
  "count": 8,
  "results": [
    {
      "id": "places/xxx",
      "name": "一風堂拉麵",
      "rating": 4.5,
      "userRatingCount": 320,
      "priceLabel": "$$",
      "address": "台北市...",
      "openNow": true,
      "location": { "lat": 25.03, "lng": 121.56 },
      "routeDistanceM": 340,
      "navUrl": "https://www.google.com/maps/dir/?api=1&...",
      "websiteUri": "https://..."
    }
  ]
}
```

沒有 `destination` 時 `route` 是 `null`，`routeDistanceM` 改成離 `origin` 多遠。錯誤回應：`400`（缺 `origin`）、`401`（`X-API-Key` 錯誤或缺漏）、`405`（不是 `POST`）、`502`（Google API 端錯誤，例如地址解析失敗、路線規劃失敗）。

### `GET /api/health`

不需要驗證的連線測試端點，回傳 `{"ok":true,"time":"..."}`，用來確認 function 有部署起來、網路打得通。

### 用 iPhone 捷徑（Shortcuts）串成 Siri 一來一回

「換一間」刻意設計成不用再打一次 API：`/api/search` 一次回傳排序好的候選清單，捷徑本機從清單裡换下一筆，語音互動才夠即時。

```
1. Get Current Location                       → 存成變數 Origin（"緯度,經度"）
2. Ask for Input（文字，允許口述）              → 「想吃什麼？沒特別想吃就說『附近』」→ Keyword
3. Ask for Input（可選）                        → 「要去哪附近？沒有就留空」→ Destination
4. Get Contents of URL
     方法：POST
     URL：https://<your-app>.vercel.app/api/search
     Headers：Content-Type: application/json、X-API-Key: <你的密鑰>
     Body（JSON）：{"origin": Origin, "destination": Destination, "keyword": Keyword, "sort": "rating"}
5. Get Dictionary from Input → 取出 results
6. Get Item from List（index 0）                → Picked
7. Speak Text
     「幫你找到 Picked.name，評分 Picked.rating 分，Picked.address。要導航嗎？」
8. Choose from Menu：「導航」／「換一間」／「不用了」
     導航   → Open URLs Picked.navUrl（直接開 Google Maps 導航）
     換一間 → Remove Picked from results，回到步驟 6 取下一筆（本機切換，不用再打 API）
     不用了 → 結束
```

把這個捷徑加上一句 Siri 語音短句（例如「幫我找餐廳」），就能整段用語音一來一回完成，只有第一次呼叫 API 有網路延遲，之後「換一間」是瞬間反應。

## 專案結構

- `index.html` — 唯一的頁面與邏輯（Vite 進入點）
- `.env.example` — 環境變數範本
- `api/` — Vercel Serverless Functions，給 iPhone 捷徑 / Siri 呼叫的 API（見上一節），跟靜態網站是獨立部署的兩件事
