import { useEffect, useState } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '../firebase';

const cache = new Map();

export function getUser(uid, force = false) {
  if (!uid) return Promise.resolve(null);
  if (!force && cache.has(uid)) return cache.get(uid);
  const p = get(ref(db, 'users/' + uid)).then((s) => (s.exists() ? s.val() : null)).catch(() => null);
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
    getUser(uid).then((u) => { if (alive) setUser(u); });
    return () => { alive = false; };
  }, [uid]);
  return user;
}

export async function findUidByUsername(username) {
  const s = await get(ref(db, 'username/' + username));
  return s.exists() ? s.val() : null;
}
