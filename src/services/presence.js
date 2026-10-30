import { ref, onValue, onDisconnect, set, update, serverTimestamp, push } from 'firebase/database';
import { Platform } from 'react-native';
import { db, APP_VERSION } from '../firebase';

const ua = () => `${APP_VERSION} (${Platform.OS} ${Platform.Version})`;

// Marks the user online while connected, offline on disconnect (same schema as the web app).
export function startPresence(uid) {
  const statusRef = ref(db, 'status/' + uid);
  const off = { state: 'offline', last_changed: serverTimestamp(), ua: ua() };
  const on = { state: 'online', last_changed: serverTimestamp(), ua: ua() };
  const unsub = onValue(ref(db, '.info/connected'), (snap) => {
    if (snap.val() === false) return;
    onDisconnect(statusRef).set(off).then(() => set(statusRef, on)).catch(() => {});
  });
  return () => unsub();
}

export function setOffline(uid) {
  return update(ref(db, 'status/' + uid), { state: 'offline', last_changed: serverTimestamp(), ua: ua() }).catch(() => {});
}

export function logHistory(uid, kind, type) {
  const payload = { timestamp: serverTimestamp(), ua: ua(), hc_version: APP_VERSION, url: 'app://hellocat' };
  if (type) payload.type = type;
  return push(ref(db, `history/${uid}/${kind}`), payload).catch(() => {});
}
