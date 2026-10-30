import { ref, get, update, remove, serverTimestamp } from 'firebase/database';
import { db } from '../firebase';

export async function getRelationType(uid, fid) {
  const [a, b, c] = await Promise.all([
    get(ref(db, `friendships/${uid}/${fid}`)),
    get(ref(db, `friend_req/recieved/${uid}/${fid}`)),
    get(ref(db, `friend_req/sent/${uid}/${fid}`)),
  ]);
  return { is_friend: a.exists(), recieved: b.exists(), sent: c.exists() };
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
  const s = await get(ref(db, `following/${uid}/${fid}`));
  return s.exists();
}

export async function follow(uid, fid) {
  await update(ref(db, 'following/' + uid), { [fid]: serverTimestamp() });
  await update(ref(db, 'followers/' + fid), { [uid]: serverTimestamp() });
}

export async function unfollow(uid, fid) {
  await remove(ref(db, `followers/${fid}/${uid}`));
  await remove(ref(db, `following/${uid}/${fid}`));
}
