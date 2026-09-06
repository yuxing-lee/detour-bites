import { GEMINI_API_KEY, GEMINI_MODEL_CHAIN, KEYWORD_FILTER_PATTERNS } from './config.js';
import { reviewText } from './reviews.js';

// gemma 系列目前不支援 responseSchema 的原生 JSON mode，要它輸出 JSON 只能用文字指令要求，
// 且回傳常會被包一層 ```json ... ``` code fence，這裡都一併處理掉
function isGemmaModel(model) {
  return model.startsWith('gemma-');
}

function stripJsonCodeFence(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
}

async function callGeminiModel(model, prompt, schema) {
  const nativeJsonMode = schema && !isGemmaModel(model);
  const finalPrompt = (schema && !nativeJsonMode)
    ? `${prompt}\n\n請「只」回傳一個符合以下 JSON schema 的物件本身，不要加任何說明文字、也不要用 markdown code fence 包起來：\n${JSON.stringify(schema)}`
    : prompt;
  // gemini-2.5 系列預設會開 thinking，thinking 用掉的 token 跟 maxOutputTokens 是同一個額度，
  // 若沒關掉，300 tokens 常常整包被 thinking 吃光，導致回傳文字被腰斬甚至整段空白，
  // 因此非 gemma 的 model 一律把 thinkingBudget 設 0（gemma 沒有 thinking 參數，設了會出錯）
  const disableThinking = !isGemmaModel(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {};
  const generationConfig = nativeJsonMode
    ? { responseMimeType: 'application/json', responseSchema: schema, ...disableThinking }
    : { maxOutputTokens: 800, ...disableThinking };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: finalPrompt }] }],
      generationConfig
    })
  });

  if (!res.ok) {
    throw new Error(`[${model}] Gemini API 回傳非 OK：${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`[${model}] Gemini 沒有回傳內容（finishReason: ${candidate?.finishReason}）`);
  // finishReason 是 MAX_TOKENS 代表輸出被 maxOutputTokens 腰斬，text 只是半截句子，
  // 不能當成功結果用；丟錯讓 callGemini 換下一個 model 重試，而不是把殘句顯示給使用者看
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new Error(`[${model}] Gemini 回傳被 maxOutputTokens 截斷（finishReason: MAX_TOKENS）`);
  }
  if (!schema) return text.trim();
  return JSON.parse(nativeJsonMode ? text : stripJsonCodeFence(text));
}

// 依 GEMINI_MODEL_CHAIN 的順序依序嘗試；某個 model 失敗（額度用完、暫時性錯誤、
// 或 gemma 沒把 JSON 格式輸出對）就換下一個，全部都失敗才把最後一個錯誤丟出去給呼叫端。
export async function callGemini(prompt, schema) {
  let lastErr;
  for (const model of GEMINI_MODEL_CHAIN) {
    try {
      return await callGeminiModel(model, prompt, schema);
    } catch (err) {
      console.warn(`Gemini model「${model}」呼叫失敗，換下一個 model：`, err);
      lastErr = err;
    }
  }
  throw lastErr || new Error('沒有可用的 Gemini model');
}

// 把一間店的評論丟給 Gemini，生成一段自然語言摘要（整體評價、常被稱讚的菜色、需注意的缺點）
export async function summarizePlaceReviews(placeName, reviews) {
  if (!reviews.length) return '目前沒有評論資料可供摘要。';

  const reviewsText = reviews.slice(0, 10).map((r, i) => {
    const rating = r.rating ? `${r.rating}★` : '無評分';
    return `${i + 1}. [${rating}] ${reviewText(r).slice(0, 300)}`;
  }).join('\n');

  const prompt = `你是美食評論摘要助手。以下是「${placeName}」這間餐廳在 Google 地圖上的顧客評論，請用繁體中文寫一段 100 字以內的摘要，包含：整體評價傾向、常被提到的推薦菜色或特色，以及需要注意的缺點（如果有的話）。直接寫成一段自然的話，不要條列、不要加標題。\n\n評論：\n${reviewsText}`;

  try {
    return await callGemini(prompt);
  } catch (err) {
    console.warn('Gemini 評論摘要失敗：', err);
    return null;
  }
}

export function localParseKeyword(rawText) {
  let keyword = rawText;
  let openNow = false;
  let preferCheap = false;
  KEYWORD_FILTER_PATTERNS.forEach(({ re, flag }) => {
    if (re.test(keyword)) {
      if (flag === 'openNow') openNow = true;
      if (flag === 'preferCheap') preferCheap = true;
      keyword = keyword.replace(re, '');
    }
  });
  keyword = keyword.replace(/[，,、]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { keyword, openNow, preferCheap };
}

// 把使用者在關鍵字欄位打的口語文字，解析成搜尋關鍵字 + 是否只看營業中 + 是否偏好便宜
export async function parseKeywordWithGemini(rawText) {
  const prompt = `你是餐廳搜尋助手。使用者在「關鍵字」欄位輸入了以下文字，裡面可能包含料理名稱、店名，也可能夾雜口語化的篩選需求（例如想要便宜、想要現在還有營業）。請解析成三個欄位：
1. keyword：純粹用來做地圖文字搜尋的關鍵字（料理名稱、店名或菜色，去掉篩選類的敘述）；如果整句都只是篩選需求、沒有指定料理或店名，回傳空字串。
2. openNow：使用者是否表達想要「現在營業中／還有開」的意思，true 或 false。
3. preferCheap：使用者是否表達想要「便宜／划算／平價」的意思，true 或 false。

原始輸入：「${rawText}」`;

  return callGemini(prompt, {
    type: 'OBJECT',
    properties: {
      keyword: { type: 'STRING' },
      openNow: { type: 'BOOLEAN' },
      preferCheap: { type: 'BOOLEAN' }
    },
    required: ['keyword', 'openNow', 'preferCheap']
  });
}

// 「想吃的餐點」的 AI 備援：只有在同義詞擴充比對完全找不到符合的店家時才會呼叫，
// 一次把所有候選店家的評論摘錄丟給 Gemini 做語意判斷（而不是每間店各呼叫一次），
// 藉此在不大量增加 API 用量的前提下，也能應付「氣氛好」「約會」這類同義詞庫涵蓋不到的模糊描述
export async function semanticMatchDishKeyword(dishKeyword, candidates) {
  const entries = candidates.map((c, i) => {
    const snippets = (c._reviews || [])
      .slice(0, 5)
      .map(r => reviewText(r).slice(0, 150))
      .filter(Boolean)
      .join(' / ');
    return `${i}. ${c.displayName?.text || '(未命名)'}：${snippets || '（無評論內容）'}`;
  }).join('\n');

  const prompt = `你是餐廳評論比對助手。使用者想找「${dishKeyword}」，可能是具體菜色，也可能是氣氛、價位、場合等比較抽象的描述。以下是候選餐廳的編號、店名跟幾則評論摘錄，請判斷哪些餐廳的評論內容顯示這間店符合使用者想找的東西（不需要逐字比對，語意相符即可），回傳符合的餐廳編號陣列（從 0 開始）；都不符合就回傳空陣列。\n\n${entries}`;

  return callGemini(prompt, {
    type: 'OBJECT',
    properties: {
      matchedIndexes: { type: 'ARRAY', items: { type: 'INTEGER' } }
    },
    required: ['matchedIndexes']
  });
}
