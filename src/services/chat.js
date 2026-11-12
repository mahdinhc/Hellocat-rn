import { ref, get, update, push, remove, set, serverTimestamp } from 'firebase/database';
import { db } from '../firebase';
import { makeChatId, randomString } from '../utils';
import { notifyPush } from './pushNotify';
import { uploadFile, uploadChatAsset } from './storage';

// push() returns a promise-like ref; once the server has the message, ask the worker to send the push.
export function pushAndNotify(cid, data) {
  const p = push(ref(db, `chats_data/${cid}/messages`), data);
  p.then(() => notifyPush(cid, p.key)).catch(() => {});
  return p;
}

// Returns the chat id for uid<->fid, creating the conversation if needed.
export async function getOrCreateChat(uid, fid) {
  const existing = await get(ref(db, `chats/${uid}/${fid}`));
  if (existing.exists() && typeof existing.val() === 'string') return existing.val();
  const other = await get(ref(db, `chats/${fid}/${uid}`));
  if (other.exists() && typeof other.val() === 'string') {
    await update(ref(db, 'chats/' + uid), { [fid]: other.val() });
    return other.val();
  }
  const cid = makeChatId(uid, fid);
  await update(ref(db, 'chats/' + uid), { [fid]: cid });
  await update(ref(db, 'chats/' + fid), { [uid]: cid });
  await update(ref(db, 'chats_data/' + cid), { user_0: uid, user_1: fid, conversation_started: serverTimestamp() });
  await push(ref(db, `chats_data/${cid}/messages`), {
    type: 'event', eventType: 'chat-started', send_from: uid, send_to: fid,
    timestamp: serverTimestamp(), isSeenByReceiver: false,
  });
  return cid;
}

export function sendTextMessage(cid, uid, fid, text, replyOf = null) {
  return pushAndNotify(cid, {
    type: 'text', data: text, send_from: uid, send_to: fid,
    timestamp: serverTimestamp(), isSeenByReceiver: false, reply_of: replyOf, style: null,
  });
}

export function sendFileMessage(cid, uid, fid, url, filetype, filename, ext, replyOf = null) {
  return pushAndNotify(cid, {
    type: 'file', filetype, filename, url, ext, send_from: uid, send_to: fid,
    timestamp: serverTimestamp(), isSeenByReceiver: false, reply_of: replyOf,
  });
}

export function removeMessage(cid, mid) {
  return update(ref(db, `chats_data/${cid}/messages/${mid}`), { removed: true, data: null, url: null });
}

export function reactToMessage(cid, mid, uid, type = 'u2764') {
  return update(ref(db, `chats_data/${cid}/messages/${mid}/reacts`), {
    [uid]: {
      timestamp: serverTimestamp(),
      type: type,
    },
  });
}

export function unreactMessage(cid, mid, uid) {
  return remove(ref(db, `chats_data/${cid}/messages/${mid}/reacts/${uid}`));
}


export function saveMessageDoodle(cid, mid, dataUrl, pos = { top: 0, left: 0, width: 220, height: 180 }) {
  return update(ref(db, `chats_data/${cid}/messages/${mid}`), {
    doodle: { url: dataUrl, pos: pos },
  });
}

export function deleteMessageDoodle(cid, mid) {
  return remove(ref(db, `chats_data/${cid}/messages/${mid}/doodle`));
}

export function markSeen(cid, mid) {
  return update(ref(db, `chats_data/${cid}/messages/${mid}`), { isSeenByReceiver: true, seenByReceiverAt: serverTimestamp() }).catch(() => {});
}

export function setTyping(cid, uid, typing) {
  return set(ref(db, `chats_data/${cid}/typing/${uid}`), typing ? serverTimestamp() : 0).catch(() => {});
}

export function removeConversation(uid, fid) {
  return remove(ref(db, `chats/${uid}/${fid}`));
}

// Uploads a local file (uri) to the active storage provider (ImageKit or Firebase)
export async function uploadLocalFile(path, uri, contentType) {
  const fileName = path.split('/').pop() || `file_${Date.now()}`;
  const dirPath = path.substring(0, path.lastIndexOf('/')) || 'uploads';
  return uploadFile(uri, { path: dirPath, fileName, contentType });
}

export async function uploadChatFile(uid, asset) {
  return uploadChatAsset(uid, asset);
}
