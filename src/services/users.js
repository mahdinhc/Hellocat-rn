import { useEffect, useState } from 'react';
import { get } from 'firebase/database';
import { safeRef, normalizeUser, isValidKey } from '../safe';

const cache = new Map();

export function getUser(uid, force = false) {
  if (!isValidKey(uid)) return Promise.resolve(null);
  if (!force && cache.has(uid)) return cache.get(uid);
  const r = safeRef('users', uid);
  if (!r) return Promise.resolve(null);
  const p = get(r).then((s) => (s.exists() ? normalizeUser(s.val()) : null)).catch(() => { cache.delete(uid); return null; });
  cache.set(uid, p);
  return p;
}

export function invalidateUser(uid) {
  cache.delete(uid);
}

export function useUser(uid) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!uid) { setUser(null); return undefined; }
    getUser(uid).then((u) => { if (alive) setUser(u); }).catch(() => {});
    return () => { alive = false; };
  }, [uid]);
  return user;
}

export async function findUidByUsername(username) {
  const r = safeRef('username', username);
  if (!r) return null;
  const s = await get(r);
  return s.exists() ? s.val() : null;
}
