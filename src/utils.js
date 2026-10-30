import CryptoJS from 'crypto-js';

export function formatName(a = '', b = '') {
  const x = typeof a === 'string' ? a.trim() : '';
  const y = typeof b === 'string' ? b.trim() : '';
  if (!y) return x;
  if (!x) return y;
  return x + ' ' + y;
}

export function userDisplayName(u) {
  if (!u || typeof u !== 'object') return 'Unknown';
  const n = Array.isArray(u.name) ? u.name : (u.name && typeof u.name === 'object' ? [u.name[0], u.name[1]] : []);
  const un = typeof u.username === 'string' ? u.username : '';
  return formatName(n[0], n[1]) || un || 'Unknown';
}

export function randomString(length) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let r = '';
  for (let i = 0; i < length; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
  return r;
}

// Same rule as the web app
export function validateUsername(u) {
  return /^(?!.*--)[^\W-][\w-]{0,29}$/.test(u);
}

export function validateName(n) {
  return n.length > 0 && n.length < 19 && /^[^(<>/\\{}`*)]*$/.test(n);
}

export function autoUserID(first, last) {
  const base = (first + last).replace(/[^\w]/g, '').toLowerCase() || 'user';
  return (base + randomString(5)).slice(0, 30);
}

// Same chat id scheme as the web app (md5 of uid + fid)
export function makeChatId(uid, fid) {
  return CryptoJS.MD5(uid + fid).toString();
}

export function timeAgo(ts) {
  if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo + 'mo ago';
  return Math.floor(mo / 12) + 'y ago';
}

export function formatClock(ts) {
  if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + m + ' ' + ap;
}

export function formatDateTime(ts) {
  if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return '';
  try { return new Date(ts).toLocaleString(); } catch (e) { return ''; }
}

export function formatNumber(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function snapshotToList(snap) {
  const out = [];
  snap.forEach((c) => {
    const v = c.val();
    out.push({ key: c.key, ...(v && typeof v === 'object' ? v : { value: v }) });
  });
  return out;
}

export function isImageType(t) {
  return typeof t === 'string' && t.startsWith('image');
}

export function bytesToLabel(b) {
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i];
}
