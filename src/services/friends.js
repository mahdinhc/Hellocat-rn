import { ref, get, update, remove, serverTimestamp } from 'firebase/database';
import { db } from '../firebase';
import { safeRef, isValidKey } from '../safe';

export async function getRelationType(uid, fid) {
  if (!isValidKey(uid) || !isValidKey(fid)) {
    return { is_friend: false, recieved: false, sent: false };
  }
  const rFriend = safeRef('friendships', uid, fid);
  const rRecv = safeRef('friend_req', 'recieved', uid, fid);
  const rSent = safeRef('friend_req', 'sent', uid, fid);
  const [a, b, c] = await Promise.all([
    rFriend ? get(rFriend).catch(() => null) : null,
    rRecv ? get(rRecv).catch(() => null) : null,
    rSent ? get(rSent).catch(() => null) : null,
  ]);
  return {
    is_friend: !!(a && typeof a.exists === 'function' && a.exists()),
    recieved: !!(b && typeof b.exists === 'function' && b.exists()),
    sent: !!(c && typeof c.exists === 'function' && c.exists()),
  };
}

export async function sendFriendRequest(uid, fid) {
  await update(ref(db, 'friend_req/sent/' + uid), { [fid]: serverTimestamp() });
  await update(ref(db, 'friend_req/recieved/' + fid), { [uid]: serverTimestamp() });
}

export async function acceptFriendRequest(uid, fid) {
  await update(ref(db, 'friendships/' + uid), { [fid]: serverTimestamp() });
  await update(ref(db, 'friendships/' + fid), { [uid]: serverTimestamp() });
  await remove(ref(db, `friend_req/sent/${fid}/${uid}`));
  await remove(ref(db, `friend_req/recieved/${uid}/${fid}`));
}

export async function rejectFriendRequest(uid, fid) {
  await remove(ref(db, `friend_req/sent/${fid}/${uid}`));
  await remove(ref(db, `friend_req/recieved/${uid}/${fid}`));
}

export async function cancelFriendRequest(uid, fid) {
  await remove(ref(db, `friend_req/sent/${uid}/${fid}`));
  await remove(ref(db, `friend_req/recieved/${fid}/${uid}`));
}

export async function unfriendUser(uid, fid) {
  await remove(ref(db, `friendships/${fid}/${uid}`));
  await remove(ref(db, `friendships/${uid}/${fid}`));
}

export async function isFollowing(uid, fid) {
  if (!isValidKey(uid) || !isValidKey(fid)) return false;
  const r = safeRef('following', uid, fid);
  if (!r) return false;
  const s = await get(r).catch(() => null);
  return !!(s && typeof s.exists === 'function' && s.exists());
}

export async function follow(uid, fid) {
  await update(ref(db, 'following/' + uid), { [fid]: serverTimestamp() });
  await update(ref(db, 'followers/' + fid), { [uid]: serverTimestamp() });
}

export async function unfollow(uid, fid) {
  await remove(ref(db, `followers/${fid}/${uid}`));
  await remove(ref(db, `following/${uid}/${fid}`));
}
