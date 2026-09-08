import { SHORTCUTS_API_KEY } from './config.js';

// 呼叫端（iPhone 捷徑）要在 X-API-Key header 帶上跟 Vercel 環境變數
// SHORTCUTS_API_KEY 相同的字串才放行。刻意 fail-closed：沒設定這個
// 環境變數就一律拒絕，避免忘記設定變成沒驗證的公開 API。
export function isAuthorized(req) {
  if (!SHORTCUTS_API_KEY) return false;
  const key = req.headers['x-api-key'];
  return key === SHORTCUTS_API_KEY;
}
