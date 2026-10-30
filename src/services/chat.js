import { ref, get, update, push, remove, set, serverTimestamp } from 'firebase/database';
import { ref as sref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { makeChatId, randomString } from '../utils';

// Returns the chat id for uid<->fid, creating the conversation if needed.
export async function getOrCreateChat(uid, fid) {
  const existing = await get(ref(db, `chats/${uid}/${fid}`));
  if (existing.exists()) return existing.val();
  const other = await get(ref(db, `chats/${fid}/${uid}`));
  if (other.exists()) {
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
  return push(ref(db, `chats_data/${cid}/messages`), {
    type: 'text', data: text, send_from: uid, send_to: fid,
    timestamp: serverTimestamp(), isSeenByReceiver: false, reply_of: replyOf, style: null,
  });
}

export function sendFileMessage(cid, uid, fid, url, filetype, filename, ext, replyOf = null) {
  return push(ref(db, `chats_data/${cid}/messages`), {
    type: 'file', filetype, filename, url, ext, send_from: uid, send_to: fid,
    timestamp: serverTimestamp(), isSeenByReceiver: false, reply_of: replyOf,
  });
}

export function removeMessage(cid, mid) {
  return update(ref(db, `chats_data/${cid}/messages/${mid}`), { removed: true, data: null, url: null });
}

export function markSeen(cid, mid) {
  return update(ref(db, `chats_data/${cid}/messages/${mid}`), { isSeenByReceiver: true }).catch(() => {});
}

export function setTyping(cid, uid, typing) {
  return set(ref(db, `chats_data/${cid}/typing/${uid}`), typing ? serverTimestamp() : 0).catch(() => {});
}

export function removeConversation(uid, fid) {
  return remove(ref(db, `chats/${uid}/${fid}`));
}

// Uploads a local file (uri) to Firebase Storage and returns its download URL.
export async function uploadLocalFile(path, uri, contentType) {
  const blob = await (await fetch(uri)).blob();
  const r = sref(storage, path);
  await uploadBytes(r, blob, contentType ? { contentType } : undefined);
  return getDownloadURL(r);
}

export async function uploadChatFile(uid, asset) {
  const name = asset.fileName || asset.name || `file_${Date.now()}`;
  const url = await uploadLocalFile(`0xab/${uid}/${randomString(12)}/${name}`, asset.uri, asset.mimeType);
  return { url, name };
}
