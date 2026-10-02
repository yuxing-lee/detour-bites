import { statusEl, toastEl } from './dom.js';

export function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

let toastTimer = null;

// 畫面底部的短暫提示，可以帶一顆動作按鈕（例如「復原」）。手機上清單跟地圖分頁切來切去，
// 側邊欄的狀態列常常看不到，加入／刪除品項這類操作的回饋改用這個
export function showToast(message, { actionLabel, onAction, duration = 4500 } = {}) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = '';
  const msgEl = document.createElement('span');
  msgEl.className = 'toast-msg';
  msgEl.textContent = message;
  toastEl.appendChild(msgEl);
  if (actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      hideToast();
      onAction();
    });
    toastEl.appendChild(btn);
  }
  toastEl.hidden = false;
  // 連續觸發時重播彈出動畫，讓使用者看得出是新的訊息
  toastEl.classList.remove('toast-pop');
  void toastEl.offsetWidth;
  toastEl.classList.add('toast-pop');
  toastTimer = setTimeout(hideToast, duration);
}

export function hideToast() {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
}
