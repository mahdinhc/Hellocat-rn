// Local message notifications for HelloCat.
//
// How it works: while the app process is alive (foreground, or in the background until Android freezes it)
// we keep a lightweight listener on the newest message of each conversation and raise a system notification
// when a NEW message addressed to this user arrives. Notifications can be switched off in Settings.
// Nothing in here is allowed to throw - notifications are a convenience, never a reason to crash.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { query, limitToLast } from 'firebase/database';
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
  if (!settings.enabled) { try { await clearDelivered(); } catch (e) { /* ignore */ } }
  return settings;
}

export const subscribeNotificationSettings = (f) => { subs.add(f); return () => subs.delete(f); };

// ---------- OS setup ----------
export async function setupNotifications() {
  if (!Notifications) return false;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true, // also used by newer SDKs as banner
        shouldPlaySound: !!settings.sound,
        shouldSetBadge: false,
      }),
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
  if (!loaded) loadNotificationSettings();
  setupNotifications();

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
      const d = resp && resp.notification && resp.notification.request && resp.notification.request.content && resp.notification.request.content.data;
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
