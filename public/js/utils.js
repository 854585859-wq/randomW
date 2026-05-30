// API helper
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Modal helper
function showModal(title, content, onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <button class="modal-close">&times;</button>
    <h3>${escHtml(title)}</h3>
    <div class="modal-body">${content}</div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close').onclick = () => { overlay.remove(); if (onClose) onClose(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); if (onClose) onClose(); } });
  return overlay.querySelector('.modal-body');
}

// XSS safe
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Alert message
function showAlert(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  return el;
}

// Format date
function formatDate(d) {
  const parts = d.split('-');
  return `${parts[1]}月${parts[2]}日`;
}

// Share page
async function sharePage() {
  const title = 'Concert Info · Korea Concert Calendar';
  const url = location.href;
  const text = '韩国演唱会日程日历，查档期超方便 👀';
  if (navigator.share) {
    try { await navigator.share({ title, url, text }); } catch {}
  } else {
    try { await navigator.clipboard.writeText(url); alert('链接已复制，可以分享啦 ✨'); }
    catch { prompt('复制这个链接分享：', url); }
  }
}
