// Defensive helpers: the Firebase database is shared with the web app (and old app versions), so any
// field can be missing, null, or a different type than expected. Everything the UI renders goes through here.
import { ref as fbRef, onValue as fbOnValue } from 'firebase/database';
import { db } from './firebase';

export const str = (v, fallback = '') => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
};

export const num = (v, fallback = 0) => (typeof v === 'number' && isFinite(v) ? v : fallback);

// Only http(s)/data/file URIs are passed to <Image>. Relative web paths like "/res/blank-profile.png" are dropped.
export const safeUri = (v) => (typeof v === 'string' && /^(https?:|data:image|file:|content:)/i.test(v) ? v : null);

// Firebase keys may not contain . # $ [ ] / (or control chars). Passing one to ref() throws synchronously.
export const isValidKey = (k) => typeof k === 'string' && k.length > 0 && !/[.#$\[\]\/\u0000-\u001F\u007F]/.test(k);

export function normalizeUser(u) {
  if (!u || typeof u !== 'object') return null;
  let name = ['', ''];
  if (Array.isArray(u.name)) name = [str(u.name[0]), str(u.name[1])];
  else if (u.name && typeof u.name === 'object') name = [str(u.name[0]), str(u.name[1])];
  else if (typeof u.name === 'string') name = [u.name, ''];
  return {
    ...u,
    name,
    username: str(u.username),
    bio: str(u.bio),
    profile_picture: safeUri(u.profile_picture),
    theme: str(u.theme),
  };
}

export function normalizeMessage(key, raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return {
    key: str(key),
    type: str(m.type, 'text'),
    eventType: str(m.eventType),
    data: typeof m.data === 'string' ? m.data : m.data == null ? '' : str(m.data, ''),
    emoji: str(m.emoji),
    size: num(m.size, 40),
    filename: str(m.filename),
    filetype: str(m.filetype),
    url: safeUri(m.url),
    ext: str(m.ext),
    send_from: str(m.send_from),
    send_to: str(m.send_to),
    timestamp: typeof m.timestamp === 'number' && isFinite(m.timestamp) ? m.timestamp : 0,
    isSeenByReceiver: m.isSeenByReceiver === true,
    reply_of: isValidKey(m.reply_of) ? m.reply_of : null,
    removed: m.removed === true,
    callType: str(m.callType),
    callStatus: str(m.callStatus),
    duration: num(m.duration, 0),
  };
}

// onValue that can never throw: invalid path, listener errors and permission errors are swallowed.
export function safeOnValue(queryOrRef, cb, onError) {
  try {
    return fbOnValue(
      queryOrRef,
      (snap) => { try { cb(snap); } catch (e) { reportError(e, 'listener'); } },
      (err) => { try { if (onError) onError(err); } catch (e) { /* ignore */ } },
    );
  } catch (e) {
    reportError(e, 'onValue');
    return () => {};
  }
}

export function safeRef(...parts) {
  const segs = parts.flatMap((p) => String(p).split('/'));
  if (!segs.every(isValidKey)) return null;
  try { return fbRef(db, segs.join('/')); } catch (e) { return null; }
}

// Central error sink (also used by the ErrorBoundary / global handler).
let lastError = null;
const listeners = new Set();
export function reportError(e, where) {
  lastError = { message: str(e && e.message, String(e)), where: where || '', stack: str(e && e.stack).slice(0, 1500), at: Date.now() };
  // eslint-disable-next-line no-console
  console.warn('[HelloCat error]', where, e);
  listeners.forEach((l) => { try { l(lastError); } catch (x) { /* ignore */ } });
  import('@react-native-async-storage/async-storage')
    .then((m) => m.default.setItem('last-error', JSON.stringify(lastError)))
    .catch(() => {});
}
export const getLastError = () => lastError;
export const onErrorReported = (l) => { listeners.add(l); return () => listeners.delete(l); };
