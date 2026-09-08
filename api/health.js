// 不需要驗證的簡單連線測試端點：確認 Vercel function 有部署起來、
// 網路可以打得通，跟環境變數是否有設定完全無關（故意不檢查 API key 存不存在，
// 避免這個端點洩漏 server 設定狀態給沒通過驗證的呼叫端）。
export default function handler(req, res) {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
}
