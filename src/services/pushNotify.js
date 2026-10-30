// Tells the push worker that a message was just sent so it can wake the receiver's phone.
// Fire-and-forget: it can never throw or block sending.
import { auth } from '../firebase';
import { PUSH_WORKER_URL } from '../config';

export function notifyPush(cid, mid) {
  try {
    if (!PUSH_WORKER_URL || !cid || !mid || !auth.currentUser) return;
    auth.currentUser.getIdToken()
      .then((idToken) => fetch(PUSH_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid, mid, idToken }),
      }))
      .catch(() => {});
  } catch (e) { /* ignore */ }
}
