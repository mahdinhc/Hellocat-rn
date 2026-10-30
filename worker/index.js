// HelloCat push worker (Cloudflare Workers, free plan).
// Handles both instant chat message pushes AND incoming call wake-up pushes to Android devices.

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const isKey = (k) => typeof k === 'string' && k.length > 0 && k.length < 200 && !/[.#$\[\]\/]/.test(k);
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (s) => b64url(new TextEncoder().encode(s));

let cached = null;
async function accessToken(env) {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const sa = JSON.parse(env.SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const head = enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = enc(JSON.stringify({ iss: sa.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claim + '.' + b64url(sig),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('token exchange failed');
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

const dbUrl = (env, path, tok) => `${env.DATABASE_URL}/${path}.json?access_token=${tok}`;
const dbGet = async (env, path, tok) => { const r = await fetch(dbUrl(env, path, tok)); return r.ok ? r.json() : null; };

function displayName(u) {
  if (!u || typeof u !== 'object') return 'HelloCat User';
  const n = Array.isArray(u.name) ? u.name : (u.name && typeof u.name === 'object' ? [u.name[0], u.name[1]] : []);
  const full = [n[0], n[1]].filter((x) => typeof x === 'string' && x.trim()).join(' ').trim();
  return full || (typeof u.username === 'string' && u.username) || 'HelloCat User';
}

function bodyFor(m, preview) {
  if (!preview) return 'Sent you a message';
  if (m.type === 'text') return typeof m.data === 'string' && m.data ? m.data.slice(0, 160) : 'Sent you a message';
  if (m.type === 'code') return '</> Sent a code snippet';
  if (m.type === 'file') return typeof m.filetype === 'string' && m.filetype.startsWith('image') ? '📷 Sent a photo' : '📎 ' + (m.filename || 'Sent a file');
  if (m.type === 'emoji' || m.type === 'extramoji') return 'Sent an emoji';
  if (m.type === 'call') return (m.callType === 'video' ? '📹 Video Call' : '📞 Audio Call');
  return 'Sent you a message';
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (status, body) => new Response(JSON.stringify(body || {}), { status, headers: { 'Content-Type': 'application/json', ...cors } });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return reply(405);
    let body;
    try { body = await request.json(); } catch (e) { return reply(400); }
    const { cid, mid, idToken, callId, targetUid, callType } = body || {};
    if (typeof idToken !== 'string') return reply(400);

    // 1. Authenticate caller using Firebase ID token
    const who = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.WEB_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
    });
    const wj = await who.json().catch(() => null);
    const caller = wj && wj.users && wj.users[0] && wj.users[0].localId;
    if (!caller) return reply(401);

    try {
      const tok = await accessToken(env);

      // --- BRANCH A: INCOMING CALL HIGH-PRIORITY WAKEUP ---
      if (callId && targetUid) {
        if (!isKey(callId) || !isKey(targetUid) || targetUid === caller) return reply(400);

        const [tokens, prefs, sender] = await Promise.all([
          dbGet(env, `fcm_tokens/${targetUid}`, tok),
          dbGet(env, `push_prefs/${targetUid}`, tok),
          dbGet(env, `users/${caller}`, tok),
        ]);

        if (prefs && prefs.callsEnabled === false) return reply(200, { skipped: true, reason: 'calls_disabled' });

        const list = tokens && typeof tokens === 'object' ? Object.keys(tokens) : [];
        if (!list.length) return reply(200, { sent: 0, reason: 'no_tokens' });

        const callerName = displayName(sender);
        const isVideo = callType === 'video';
        const title = `Incoming ${isVideo ? 'Video' : 'Audio'} Call`;
        const text = `${callerName} is calling you...`;

        let sent = 0;
        await Promise.all(list.map(async (t) => {
          const r = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                token: t,
                notification: { title, body: text },
                data: {
                  type: 'incoming_call',
                  callId,
                  callerId: caller,
                  callerName,
                  callType: callType || 'audio',
                  cid: cid || '',
                },
                android: {
                  priority: 'HIGH',
                  notification: {
                    channel_id: 'calls',
                    color: '#22c55e',
                    sound: 'default',
                    tag: `call_${callId}`,
                  },
                },
              },
            }),
          });
          if (r.ok) sent++;
          else if (r.status === 404 || r.status === 400) {
            await fetch(dbUrl(env, `fcm_tokens/${targetUid}/${t}`, tok), { method: 'DELETE' });
          }
        }));

        return reply(200, { sent, type: 'call' });
      }

      // --- BRANCH B: CHAT MESSAGE PUSH ---
      if (!isKey(cid) || !isKey(mid)) return reply(400);

      const m = await dbGet(env, `chats_data/${cid}/messages/${mid}`, tok);
      if (!m || typeof m !== 'object' || m.send_from !== caller || !isKey(m.send_to) || m.send_to === caller) return reply(403);
      if (m.type === 'event' || m.removed || m.pushed) return reply(200, { skipped: true });

      const to = m.send_to;
      const [tokens, prefs, sender] = await Promise.all([
        dbGet(env, `fcm_tokens/${to}`, tok),
        dbGet(env, `push_prefs/${to}`, tok),
        dbGet(env, `users/${caller}`, tok),
      ]);

      await fetch(dbUrl(env, `chats_data/${cid}/messages/${mid}/pushed`, tok), { method: 'PUT', body: 'true' });
      if (prefs && prefs.enabled === false) return reply(200, { skipped: true });
      const list = tokens && typeof tokens === 'object' ? Object.keys(tokens) : [];
      if (!list.length) return reply(200, { sent: 0 });

      const title = displayName(sender);
      const text = bodyFor(m, !(prefs && prefs.preview === false));
      let sent = 0;
      await Promise.all(list.map(async (t) => {
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: t,
              notification: { title, body: text },
              data: { fid: caller, cid },
              android: { priority: 'HIGH', notification: { channel_id: 'messages', color: '#5d8ffc' } },
            },
          }),
        });
        if (r.ok) sent++;
        else if (r.status === 404 || r.status === 400) {
          await fetch(dbUrl(env, `fcm_tokens/${to}/${t}`, tok), { method: 'DELETE' });
        }
      }));

      return reply(200, { sent });
    } catch (e) {
      return reply(500);
    }
  },
};
