// Message notifications for HelloCat.
//
// Two layers:
//  1. Push (works when the app is in the background or fully closed): this device registers its FCM token
//     under fcm_tokens/{uid}/{token}; a Cloud Function (see /functions) sends a push on every new message.
//     Needs google-services.json at build time - without it the app silently falls back to layer 2.
//  2. Local (fallback): while the app process is alive we listen to the newest message of each conversation
//     and raise a system notification ourselves.
// Notifications can be switched off in Settings. Nothing in here is allowed to throw.
// Nothing in here is allowed to throw - notifications are a convenience, never a reason to crash.
import { Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { query, limitToLast, set, remove, serverTimestamp } from 'firebase/database';
import { safeRef, safeOnValue, normalizeMessage, isValidKey, reportError } from '../safe';
import { getUser } from './users';
import { userDisplayName } from '../utils';

const SETTINGS_KEY = 'notif-settings-v1';
const CHANNEL_ID = 'messages';
const DEFAULTS = { enabled: true, preview: true, sound: true, vibrate: true };

let Notifications = null;
try { Notifications = require('expo-notifications'); } catch (e) { Notifications = null; }

let settings = { ...DEFAULTS };
let loaded = false;
let activeChat = null;
let currentUid = null;
let pushActive = false; // true once this device has a registered push token
let currentToken = null;
const subs = new Set();

export const setActiveChat = (cid) => { activeChat = cid || null; };

// ---------- settings ----------
export async function loadNotificationSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object') settings = { ...DEFAULTS, ...pickBooleans(v) };
    }
  } catch (e) { /* keep defaults */ }
  loaded = true;
  return settings;
}

function pickBooleans(v) {
  const out = {};
  Object.keys(DEFAULTS).forEach((k) => { if (typeof v[k] === 'boolean') out[k] = v[k]; });
  return out;
}

export const getNotificationSettings = () => settings;

export async function saveNotificationSettings(patch) {
  settings = { ...settings, ...pickBooleans(patch || {}) };
  try { await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  subs.forEach((f) => { try { f(settings); } catch (e) { /* ignore */ } });
  syncPushPrefs();
  if (!settings.enabled) { try { await clearDelivered(); } catch (e) { /* ignore */ } }
  return settings;
}

export const subscribeNotificationSettings = (f) => { subs.add(f); return () => subs.delete(f); };

// ---------- OS setup ----------
export async function setupNotifications() {
  if (!Notifications) return false;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        // A push that arrives while the app is open is already covered by the local listener (and it must
        // not interrupt the chat that is on screen), so only show pushes when the app is not active.
        const trig = notification && notification.request && notification.request.trigger;
        const isPush = !!trig && (trig.type === 'push' || !!trig.remoteMessage);
        if (isPush && AppState.currentState === 'active') {
          return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false };
        }
        return {
          shouldShowAlert: true, // also used by newer SDKs as banner
          shouldPlaySound: !!settings.sound,
          shouldSetBadge: false,
        };
      },
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: settings.vibrate ? [0, 200, 120, 200] : [0],
        lightColor: '#5d8ffc',
        sound: settings.sound ? 'default' : null,
        enableVibrate: !!settings.vibrate,
      });
    }
    return true;
  } catch (e) {
    reportError(e, 'setupNotifications');
    return false;
  }
}

export async function hasPermission() {
  if (!Notifications) return false;
  try { const p = await Notifications.getPermissionsAsync(); return !!p.granted; } catch (e) { return false; }
}

// Asks for the Android 13+/iOS runtime permission if needed. Returns true when notifications may be shown.
export async function requestPermission() {
  if (!Notifications) return false;
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain === false) return false;
    const res = await Notifications.requestPermissionsAsync();
    return !!res.granted;
  } catch (e) { return false; }
}

export async function clearDelivered() {
  if (!Notifications) return;
  try { await Notifications.dismissAllNotificationsAsync(); } catch (e) { /* ignore */ }
}

// ---------- push (background / closed app) ----------
function syncPushPrefs() {
  try {
    if (!currentUid) return;
    const r = safeRef('push_prefs', currentUid);
    if (r) set(r, { enabled: !!settings.enabled, preview: !!settings.preview }).catch(() => {});
  } catch (e) { /* ignore */ }
}

async function storeToken(uid, token) {
  if (!isValidKey(uid) || !isValidKey(token)) return false;
  const r = safeRef('fcm_tokens', uid, token);
  if (!r) return false;
  await set(r, { platform: Platform.OS, updated: serverTimestamp() });
  currentToken = token;
  return true;
}

// Gets this phone's FCM token and files it under the signed-in user. Safe to call repeatedly.
export async function registerPush(uid) {
  if (!Notifications || Platform.OS !== 'android' || !isValidKey(uid)) return false;
  try {
    if (!(await requestPermission())) return false;
    const t = await Notifications.getDevicePushTokenAsync(); // throws if the build has no google-services.json
    const token = t && typeof t.data === 'string' ? t.data : null;
    if (!token) return false;
    const ok = await storeToken(uid, token);
    pushActive = ok;
    syncPushPrefs();
    return ok;
  } catch (e) {
    pushActive = false; // no FCM in this build: local notifications keep working
    return false;
  }
}

// Called on sign-out so a phone stops receiving the previous user's messages.
export async function unregisterPush(uid) {
  try {
    if (currentToken && isValidKey(uid)) {
      const r = safeRef('fcm_tokens', uid, currentToken);
      if (r) await remove(r);
    }
  } catch (e) { /* ignore */ }
  pushActive = false;
  currentToken = null;
}

async function present(title, body, data) {
  if (!Notifications || !settings.enabled) return;
  if (!(await hasPermission())) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: data || {}, sound: settings.sound ? 'default' : false, color: '#5d8ffc' },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch (e) { reportError(e, 'present-notification'); }
}

export async function sendTestNotification() {
  const ok = await requestPermission();
  if (!ok) return false;
  await setupNotifications();
  const prev = settings.enabled;
  settings = { ...settings, enabled: true };
  await present('HelloCat', 'Notifications are working 🐱', {});
  settings = { ...settings, enabled: prev };
  return true;
}

function bodyFor(m, showPreview) {
  if (!showPreview) return 'Sent you a message';
  if (m.removed) return 'Message removed';
  switch (m.type) {
    case 'text': return m.data ? m.data.slice(0, 160) : 'Sent you a message';
    case 'code': return '</> Sent a code snippet';
    case 'file': return m.filetype && m.filetype.startsWith('image') ? '📷 Sent a photo' : '📎 ' + (m.filename || 'Sent a file');
    case 'emoji':
    case 'extramoji': return 'Sent an emoji';
    default: return m.data ? m.data.slice(0, 160) : 'Sent you a message';
  }
}

// ---------- listener ----------
// Returns a stop() function. Call once per signed-in user.
export function startMessageNotifications(uid) {
  if (!isValidKey(uid)) return () => {};
  currentUid = uid;
  if (!loaded) loadNotificationSettings();
  setupNotifications().then(() => registerPush(uid)).catch(() => {});
  let tokenSub = null;
  try {
    if (Notifications && Notifications.addPushTokenListener) {
      tokenSub = Notifications.addPushTokenListener((t) => {
        const token = t && typeof t.data === 'string' ? t.data : null;
        if (token) storeToken(uid, token).then((ok) => { pushActive = ok; }).catch(() => {});
      });
    }
  } catch (e) { /* ignore */ }

  const startedAt = Date.now();
  const chatUnsubs = new Map(); // cid -> unsubscribe
  const lastNotified = new Map(); // cid -> message key
  let firstChatsSnapshot = true;
  let stopped = false;

  const watchChat = (fid, cid, baseline) => {
    const r = safeRef('chats_data', cid, 'messages');
    if (!r) return;
    let first = true;
    const unsub = safeOnValue(query(r, limitToLast(1)), (snap) => {
      let m = null;
      snap.forEach((c) => { m = normalizeMessage(c.key, c.val()); });
      const isFirst = first;
      first = false;
      if (!m || stopped) return;
      if (isFirst && baseline) { lastNotified.set(cid, m.key); return; } // already existed when the app started
      if (lastNotified.get(cid) === m.key) return;
      lastNotified.set(cid, m.key);
      if (m.type === 'event' || m.removed) return;
      if (m.send_to !== uid || m.send_from === uid || m.isSeenByReceiver) return;
      if (!baseline && m.timestamp && m.timestamp < startedAt - 60000) return; // old message of a chat discovered late
      if (!settings.enabled) return;
      if (activeChat && activeChat === cid) return; // the user is looking at this chat
      if (pushActive && AppState.currentState !== 'active') return; // the push notification covers this one
      getUser(m.send_from || fid).then((u) => present(userDisplayName(u), bodyFor(m, settings.preview), { fid, cid })).catch(() => {});
    });
    chatUnsubs.set(cid, unsub);
  };

  const chatsRef = safeRef('chats', uid);
  const stopChats = chatsRef ? safeOnValue(chatsRef, (s) => {
    const raw = s.exists() ? s.val() : {};
    const wanted = new Map();
    if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach((fid) => { if (isValidKey(fid) && isValidKey(raw[fid])) wanted.set(raw[fid], fid); });
    }
    const baseline = firstChatsSnapshot;
    firstChatsSnapshot = false;
    wanted.forEach((fid, cid) => { if (!chatUnsubs.has(cid)) watchChat(fid, cid, baseline); });
    chatUnsubs.forEach((unsub, cid) => {
      if (!wanted.has(cid)) { try { unsub(); } catch (e) { /* ignore */ } chatUnsubs.delete(cid); }
    });
  }) : () => {};

  return () => {
    stopped = true;
    try { if (tokenSub) tokenSub.remove(); } catch (e) { /* ignore */ }
    try { stopChats(); } catch (e) { /* ignore */ }
    chatUnsubs.forEach((u) => { try { u(); } catch (e) { /* ignore */ } });
    chatUnsubs.clear();
  };
}

// ---------- tapping a notification ----------
// onOpenChat({fid, cid}) is provided by App (it owns the navigation ref).
export function listenForNotificationTaps(onOpenChat) {
  if (!Notifications) return () => {};
  const handle = (resp) => {
    try {
      const req = resp && resp.notification && resp.notification.request;
      let d = req && req.content && req.content.data;
      if ((!d || !d.fid) && req && req.trigger && req.trigger.remoteMessage && req.trigger.remoteMessage.data) d = req.trigger.remoteMessage.data; // raw FCM push
      if (d && isValidKey(d.fid)) onOpenChat({ fid: d.fid, cid: isValidKey(d.cid) ? d.cid : undefined });
    } catch (e) { /* ignore */ }
  };
  let sub = null;
  try {
    sub = Notifications.addNotificationResponseReceivedListener(handle);
    // app was launched by tapping a notification
    Notifications.getLastNotificationResponseAsync().then((r) => { if (r) handle(r); }).catch(() => {});
  } catch (e) { /* ignore */ }
  return () => { try { if (sub) sub.remove(); } catch (e) { /* ignore */ } };
}
