// Port of src/gemini.js's keyword-parsing path (rule-based + optional
// Gemini fallback) for the Node runtime. Review-summary / dish-keyword
// semantic matching are intentionally not ported here — /api/search only
// needs "keyword field -> search text + openNow/preferCheap flags".
import { GEMINI_API_KEY, GEMINI_MODEL_CHAIN, KEYWORD_FILTER_PATTERNS } from './config.js';

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
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new Error(`[${model}] Gemini 回傳被 maxOutputTokens 截斷（finishReason: MAX_TOKENS）`);
  }
  if (!schema) return text.trim();
  return JSON.parse(nativeJsonMode ? text : stripJsonCodeFence(text));
}

async function callGemini(prompt, schema) {
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

// 免 AI 的規則式解析：把「現在有開」「便宜」這類口語篩選詞從關鍵字裡挑出來
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

// 語音口述常常比打字更口語（例如「附近便宜的拉麵，現在要有開的」），
// 有設 GEMINI_API_KEY 時用 AI 解析取得比規則式更準的 keyword/openNow/preferCheap
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
