# detour-bites

一個純前端的 Google Maps 工具：輸入起點與目的地，沿路線每隔固定距離取樣，搜尋附近餐廳，並在地圖上標示、依評分排序列出結果。目的地可留空，這時會改成搜尋起點附近的餐廳。

另外有一個「🛒 採買清單」：隨手記下要買的東西，打開地圖就會標出附近哪裡買得到、建議跑哪幾間可以一次買齊（見下方[採買清單](#採買清單)）。

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

## 採買清單

側邊欄最上面切到「🛒 要買的」。上次停在哪個模式會記住；網址帶 `?mode=shop`（例如 `https://yuxing-lee.github.io/detour-bites/?mode=shop`）會直接打開採買清單，可以另外加一個主畫面捷徑專門記東西。

### 記錄：越省事越好

- **打字按 Enter**：輸入框會留著焦點，可以一直打下去。一次打好幾樣用頓號、逗號或換行隔開（「牛奶、雞蛋，衛生紙」→ 三項）；空白也可以，但只有每一段都是認得的品項時才會拆開，所以「洗衣精 補充包」「AA 電池」「iPhone 充電線」不會被拆壞。數量（「牛奶 2瓶」「兩瓶牛奶」）會留在文字上，比對時自動忽略。
- **🎤 用說的**（瀏覽器支援 Web Speech API 時才會出現，Chrome、Safari 都有）：說「我要買牛奶、雞蛋還有衛生紙」，說完自動拆成三項加入；語音常常沒有標點（「牛奶雞蛋衛生紙」），會用內建字典切開。不支援的瀏覽器一樣可以用手機鍵盤上的麥克風，說完按 Enter。
- **貼上整串清單**：從 LINE、備忘錄複製多行清單貼進輸入框，會直接拆開加入。
- **常買**：打勾買過的東西會出現在輸入框下面那排，點一下就加回來（「整理」可以移掉不要的）。
- **iPhone 捷徑／Siri**：網址帶 `?add=牛奶,雞蛋`（可以帶好幾個 `add`）打開就會加入清單，見下方捷徑設定。
- 加入、刪除之後底部有「復原」；打勾的東西移到「已買」，點一下就能改回來，一天後自動清掉。
- **清單很長時**：還沒買的有 6 項以上，就依「去哪裡買」分組（便利商店、超市、藥局…），每組一行一項、可以收合，收起來也會列出裡面有什麼；「全部收合」一眼看完整份清單，「附近哪裡買 ↓」直接跳到建議路線。新加的東西進到收起來的組，那組會自動打開。

### 判斷「去哪裡買」：準確度怎麼來

不用自己選類別，每個品項依序這樣判斷（實作在 `src/shopCatalog.js`、`src/shopMatch.js`）：

1. **你改過的**：點品項下面的類別就能改（例如把某樣東西改成「寵物用品」），會記住，之後同一樣東西、甚至「大包貓砂」這種包含它的品項都會套用。
2. **連鎖店名**：寫「全聯」「去好市多」「IKEA」，就只找那家連鎖店，不會拿一般超市充數。
3. **內建字典**：約一千五百個台灣常見品項 → 可以去哪幾類店買（「牛奶」→ 便利商店、超市；「感冒藥」→ 藥局）。同一個品項對到多個詞時最長的優先，所以「貓罐頭」是寵物用品、不會因為含「罐頭」被當成超市，「鳳梨酥」是麵包店不是水果行。
4. **AI**（有設定 `VITE_GEMINI_API_KEY` 時）：字典沒收錄的品項整批交給 Gemini 判斷，只能從固定的類別裡挑，結果存在本機，同一樣東西不會再問第二次。
5. **都判斷不出來**：直接用品名在地圖上搜尋，畫面上會標示「用品名找」。字典只能用單字猜的會標「猜的」、AI 判斷的標「AI」，讓你知道哪些要留意。

改了 `src/shopCatalog.js` 的字典之後可以跑 `npm test`，確認常見品項的分類、輸入拆分沒有被改壞。

找店時也盡量避免「類別對了但店不對」：

- 有對應 Google 店家類型的，用 Nearby Search 的**主要類型**（`includedPrimaryTypes`）過濾，例如找超市只算主要類型是超市的店，不會把旁邊順便賣雜貨的店算進來。
- **藥局跟藥妝店**在 Google 上常常混標（屈臣氏可能被標成藥局），所以兩類一起查，再用店名分開：買感冒藥只會推薦真的藥局，不會叫你去屈臣氏。
- Google 沒有對應類型的（文具店、傳統市場、水果行、眼鏡行、機車行…）改用中文關鍵字文字搜尋，再濾掉混進來的餐廳、學校這類不是商店的地點。
- 已經歇業的店直接排除；每間店標出「營業中・22:00 關」「快打烊」「已打烊・明天 08:00 開」，打烊的店不列入建議路線。
- 店名對得上台灣常見連鎖店時，補上它實際有賣的類別（寶雅也賣居家雜貨跟文具、家樂福也賣家電），「一間買齊」的建議才會準。
- 類別定義裡有幾個是 Google 比較新的店家類型（例如 `hypermarket`、`cosmetics_store`），萬一 Places API 還不認得，Google 回 400 時會只拿掉被拒絕的那個類型重查，並記住一週，不會整個類別查不到。

### 附近哪裡買

- 依清單需要的**類別**各查一次附近的店（不是每個品項各查一次）。每個品項先查最常買到的前兩類（電池先找便利商店、超市），其他類別常常已經因為別的品項查過、一樣算數；附近真的找不到有開的店，才補查剩下的類別。一般 5 樣日用品的清單大約查 3～4 次。
- 某一類在 1.5 公里內一間都沒有時，自動放大到 5 公里再查一次，至少告訴你最近的在哪。
- **建議路線**：每一步挑「能買到最多還沒買的東西、又不用走太遠」的店（多買到一樣大約值得多走一公里），再依最近順序排好，可以一鍵在 Google 地圖依序導航（最多 4 站）。
- 每個品項旁邊顯示最近、有開的店；地圖上拖到別的地方會出現「🔍 搜尋這一帶」。
- 在店裡買到了：點店家卡片或地圖資訊窗裡的品項就會打勾。

### API 用量

- 跟餐廳搜尋一樣走 Places API (New)，不需要另外啟用其他 API。
- 每個類別的結果快取 30 分鐘、位置移動 250 公尺內直接沿用，重新整理網頁也不會重查；營業中／打烊用 `nextOpenTime`、`nextCloseTime` 依當下時間校正，快取期間跨過打烊時間也不會顯示錯。
- 為了顯示營業狀態會抓 `currentOpeningHours`，這讓請求落在 Enterprise 計費級距（跟餐廳搜尋同一級）。想省免費額度的話把 `src/config.js` 的 `SHOP_FETCH_OPENING_HOURS` 改成 `false`，會降到 Pro 級距，只是看不到有沒有開。
- 不知道類別、只能用品名搜尋的品項每項要多查一次，一次最多查 5 項（`SHOP_MAX_NAME_SEARCHES`）。

### iPhone 捷徑：用 Siri 加進清單

```
1. 要求輸入（文字，可以用說的）  → 「要買什麼？」
2. URL：https://yuxing-lee.github.io/detour-bites/?add=［提供的輸入］
3. 打開 URL
```

把捷徑取名「加到採買清單」，就可以說「嘿 Siri，加到採買清單」→ 說「牛奶跟衛生紙」。說的內容會自動拆成好幾項，沒有標點的「牛奶雞蛋衛生紙」也會用字典切開。

注意：清單存在瀏覽器的 localStorage，只在這台裝置、這個瀏覽器裡。iOS 上「加入主畫面」的網頁 App 跟 Safari 的資料是分開的，而捷徑的「打開 URL」會用 Safari 開，所以捷徑加的東西會出現在 Safari 那份清單；如果要用 Siri 加，平常也用 Safari 開這個網頁看清單。

## 建置與預覽

```bash
npm run build
npm run preview
```

`npm run build` 產生的 `dist/` 可以部署到任何靜態主機（GitHub Pages、Netlify、Vercel 等）。`npm run preview` 只是本機驗證用，不是正式的 production server。

## 部署到 GitHub Pages

這個 repo 對應 `https://github.com/yuxing-lee/detour-bites`，屬於「專案頁」（非帳號根網域頁），所以 `vite.config.js` 已設定 `base: '/detour-bites/'`，發布網址會是 `https://yuxing-lee.github.io/detour-bites/`。

部署流程（[.github/workflows/deploy.yml](.github/workflows/deploy.yml)）已寫好，push 到 `main`/`master` 就會自動建置並發布，你只需要做兩件事：

1. **設定 GitHub Secret**：repo 的 Settings → Secrets and variables → Actions → New repository secret，新增 `VITE_GOOGLE_MAPS_API_KEY`，值填你的 Google Maps API key。若要啟用 AI 摘要/AI 解析功能，同樣新增一個 `VITE_GEMINI_API_KEY` secret，值填你的 Gemini API key（選填，留空則 AI 功能不會出現）。另外可以選填 `VITE_GOOGLE_MAP_ID`（在 Google Cloud Console → Google Maps Platform → 地圖管理建立，類型選 JavaScript／向量，且要跟 API key 同一個專案），設定後地圖會改用 Advanced Markers（依店家類型顯示美食圖示）；留空則維持原本的數字圓點標記。
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
| `sort` | ✗ | `"route"`（順路優先：同側在前、對向在後，有 `destination` 時預設）／`"rating"`（評分高到低，沒有 `destination` 時預設）／`"price"`（便宜到貴） |
| `limit` | ✗ | 最多回傳幾間，預設 15，上限 30 |
| `sameSideOnly` | ✗ | `true` 則只回傳行進方向右側（同側）的店；只在有 `destination` 時有作用 |

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
      "oppositeSide": false,
      "navUrl": "https://www.google.com/maps/dir/?api=1&...",
      "websiteUri": "https://..."
    }
  ]
}
```

有 `destination` 時跟網頁版一樣：沿路取樣間距至少 3km、一次最多 12 個取樣點；起點後方（已經開過頭）的店會直接排除；`oppositeSide: true` 代表店在行進方向左側（對向），路寬的話可能要迴轉。沒有 `destination` 時 `route` 是 `null`，`routeDistanceM` 改成離 `origin` 多遠，`oppositeSide` 一律是 `false`。錯誤回應：`400`（缺 `origin`）、`401`（`X-API-Key` 錯誤或缺漏）、`405`（不是 `POST`）、`502`（Google API 端錯誤，例如地址解析失敗、路線規劃失敗）。

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
