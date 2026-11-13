// Hellocat posts data layer - port of the web PostsDB (Realtime Database only).
//   /posts/$pid  /post_comments/$pid/$cid  /post_reacts/$pid/$uid  /post_votes/$pid/$uid
//   /post_reposts/$pid/$uid  /user_reposts/$uid/$pid  /user_saves/$uid/$pid
//   /cats/$slug  /cat_members/$slug/$uid  /user_cats/$uid/$slug  /cat_bans/$slug/$uid  /admins/$uid
import {
  ref, get, set, update, remove, push, query, orderByChild, startAt, endAt, limitToLast,
  runTransaction, onValue, serverTimestamp,
} from 'firebase/database';
import { db, auth } from '../firebase';

const TS_W = 13;
const SCORE_W = 10;
const SCORE_OFFSET = 1000000000;
export const CAT_RE = /^[a-z0-9_]{3,21}$/;

let serverOffset = 0;
let watching = false;
function watchOffset() {
  if (watching) return;
  watching = true;
  try { onValue(ref(db, '.info/serverTimeOffset'), (s) => { serverOffset = s.val() || 0; }); } catch (e) { /* ignore */ }
}
export const now = () => { watchOffset(); return Date.now() + serverOffset; };
const me = () => (auth.currentUser ? auth.currentUser.uid : null);
const pad = (n, w) => String(Math.max(0, Math.floor(n))).padStart(w, '0');
const toArray = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return Object.keys(v).sort((a, b) => a - b).map((k) => v[k]);
};

export const tsKey = (prefix, ts) => `${prefix}_${pad(ts, TS_W)}`;
export const scoreKey = (prefix, score, ts) => `${prefix}_${pad((score || 0) + SCORE_OFFSET, SCORE_W)}_${pad(ts, TS_W)}`;
export function feedKeys(post) {
  const k = {};
  if (post.visibility === 'public') {
    k.all_ts = tsKey('all', post.ts);
    k.all_score = scoreKey('all', post.score || 0, post.ts);
  }
  if (post.cat) {
    k.cat_ts = tsKey(post.cat, post.ts);
    k.cat_score = scoreKey(post.cat, post.score || 0, post.ts);
  }
  k.uid_ts = tsKey(post.uid, post.ts);
  return k;
}

const bump = (path, delta, min) => runTransaction(ref(db, path), (cur) => {
  const n = (cur || 0) + delta;
  if (min !== undefined && n < min) return cur;
  return n;
});

let adminCache = {};
export function isAdmin() {
  const uid = me();
  if (!uid) return Promise.resolve(false);
  if (!adminCache[uid]) adminCache[uid] = get(ref(db, `admins/${uid}`)).then((s) => s.val() === true).catch(() => false);
  return adminCache[uid];
}

// ---- posts ----
export const newPostId = () => push(ref(db, 'posts')).key;
export const getPost = (pid) => get(ref(db, `posts/${pid}`)).then((s) => (s.exists() ? s.val() : null));
export const addView = (pid) => runTransaction(ref(db, `posts/${pid}/views`), (c) => (c || 0) + 1).catch(() => {});

export async function createPost({ pid, caption, visibility, type, cat, attachments }) {
  const uid = me();
  if (!uid) throw new Error('Not signed in');
  const post = {
    uid, caption, ts: now(),
    visibility: cat ? 'public' : (visibility || 'public'),
    type: type === 'vote' ? 'vote' : 'like',
    views: 0, comment_count: 0, repost_count: 0,
  };
  if (post.type === 'vote') post.score = 0; else post.like_count = 0;
  if (cat) post.cat = cat;
  const att = toArray(attachments);
  if (att.length) post.attachments = att;
  Object.assign(post, feedKeys(post));
  const id = pid || newPostId();
  await set(ref(db, `posts/${id}`), post);
  if (cat) bump(`cats/${cat}/post_count`, 1, 0).catch(() => {});
  return id;
}

export async function deletePost(pid, post) {
  const p = post || await getPost(pid);
  const up = {};
  up[`posts/${pid}`] = null;
  up[`post_comments/${pid}`] = null;
  up[`post_reacts/${pid}`] = null;
  up[`post_votes/${pid}`] = null;
  try {
    const rp = await get(ref(db, `post_reposts/${pid}`));
    rp.forEach((c) => { up[`user_reposts/${c.key}/${pid}`] = null; });
  } catch (e) { /* ignore */ }
  up[`post_reposts/${pid}`] = null;
  if (p && p.cat) up[`cats/${p.cat}/pinned/${pid}`] = null;
  await update(ref(db), up);
  if (p && p.cat) bump(`cats/${p.cat}/post_count`, -1, 0).catch(() => {});
}

// ---- like / vote / repost / save ----
export const myLike = (pid) => { const u = me(); return u ? get(ref(db, `post_reacts/${pid}/${u}`)).then((s) => s.exists()).catch(() => false) : Promise.resolve(false); };
export async function toggleLike(pid) {
  const u = me(); if (!u) throw new Error('Not signed in');
  const r = ref(db, `post_reacts/${pid}/${u}`);
  const had = (await get(r)).exists();
  if (had) await remove(r); else await set(r, serverTimestamp());
  const res = await bump(`posts/${pid}/like_count`, had ? -1 : 1, 0);
  return { liked: !had, count: res.snapshot.val() || 0 };
}
export const myVote = (pid) => { const u = me(); return u ? get(ref(db, `post_votes/${pid}/${u}`)).then((s) => s.val() || 0).catch(() => 0) : Promise.resolve(0); };
export async function vote(pid, dir) {
  const u = me(); if (!u) throw new Error('Not signed in');
  const r = ref(db, `post_votes/${pid}/${u}`);
  const prev = (await get(r)).val() || 0;
  const next = prev === dir ? 0 : dir;
  if (next === 0) await remove(r); else await set(r, next);
  const res = await bump(`posts/${pid}/score`, next - prev);
  const score = res.snapshot.val() || 0;
  const post = await getPost(pid);
  if (post) {
    const up = {};
    if (post.visibility === 'public') up.all_score = scoreKey('all', score, post.ts);
    if (post.cat) up.cat_score = scoreKey(post.cat, score, post.ts);
    if (Object.keys(up).length) update(ref(db, `posts/${pid}`), up).catch(() => {});
  }
  return { vote: next, score };
}
export const myRepost = (pid) => { const u = me(); return u ? get(ref(db, `post_reposts/${pid}/${u}`)).then((s) => s.exists()).catch(() => false) : Promise.resolve(false); };
export async function toggleRepost(pid) {
  const u = me(); if (!u) throw new Error('Not signed in');
  const had = await myRepost(pid);
  const up = {};
  up[`post_reposts/${pid}/${u}`] = had ? null : serverTimestamp();
  up[`user_reposts/${u}/${pid}`] = had ? null : { ts: serverTimestamp() };
  await update(ref(db), up);
  const res = await bump(`posts/${pid}/repost_count`, had ? -1 : 1, 0);
  return { reposted: !had, count: res.snapshot.val() || 0 };
}
export const mySave = (pid) => { const u = me(); return u ? get(ref(db, `user_saves/${u}/${pid}`)).then((s) => s.exists()).catch(() => false) : Promise.resolve(false); };
export async function toggleSave(pid) {
  const u = me(); if (!u) throw new Error('Not signed in');
  const r = ref(db, `user_saves/${u}/${pid}`);
  const had = (await get(r)).exists();
  if (had) await remove(r); else await set(r, { ts: serverTimestamp() });
  return !had;
}

// ---- comments ----
export async function addComment(pid, content, replyOf) {
  await push(ref(db, `post_comments/${pid}`), { author: me(), content, ts: serverTimestamp(), reply_of: replyOf || null });
  bump(`posts/${pid}/comment_count`, 1, 0).catch(() => {});
}
export async function deleteComment(pid, cid) {
  await remove(ref(db, `post_comments/${pid}/${cid}`));
  bump(`posts/${pid}/comment_count`, -1, 0).catch(() => {});
}

// ---- feeds ----
// src: {mode: 'all'|'mine'|'cat'|'user'|'saved'|'reposts', cat, uid, sort: 'new'|'top'}
// resolves to {items:[{id,data,extra}], cursor, done}
export function page(src, cursor, limit = 10) {
  if (src.mode === 'mine') return pageMine(cursor, limit);
  if (src.mode === 'saved' || src.mode === 'reposts') return pageIndexed(src, cursor, limit);
  if (src.mode === 'user') return pageUser(src, cursor, limit);
  return pageField(src, cursor, limit);
}

async function pageUser(src, cursor, limit) {
  if (src.uid === me()) return pageField(src, cursor, limit);
  let items = []; let cur = cursor; let done = false;
  while (items.length < limit && !done) {
    const p = await pageField(src, cur, limit);
    items = items.concat(p.items.filter((i) => i.data.visibility === 'public'));
    cur = p.cursor || cur;
    done = p.done;
  }
  return { items, cursor: cur, done };
}

async function pageIndexed(src, cursor, limit) {
  const u = me();
  if (src.mode === 'saved' && !u) return { items: [], cursor: null, done: true };
  const node = src.mode === 'saved' ? `user_saves/${u}` : `user_reposts/${src.uid}`;
  const snap = await get(cursor
    ? query(ref(db, node), orderByChild('ts'), endAt(cursor.ts, cursor.key), limitToLast(limit + 1))
    : query(ref(db, node), orderByChild('ts'), limitToLast(limit + 1)));
  let rows = [];
  snap.forEach((c) => { rows.push({ id: c.key, ts: c.child('ts').val() }); });
  rows.reverse();
  if (cursor) rows = rows.filter((r) => r.id !== cursor.key);
  const more = snap.size >= limit + 1;
  rows = rows.slice(0, limit);
  const posts = await Promise.all(rows.map((r) => getPost(r.id).catch(() => null)));
  const items = [];
  posts.forEach((d, i) => {
    if (!d) return;
    if (d.visibility !== 'public' && d.uid !== u) return;
    items.push({ id: rows[i].id, data: d, extra: src.mode === 'reposts' ? { repostTs: rows[i].ts } : null });
  });
  const last = rows[rows.length - 1];
  return { items, cursor: last ? { ts: last.ts, key: last.id } : null, done: !more || rows.length === 0 };
}

async function pageField(src, cursor, limit) {
  const top = src.sort === 'top';
  let field; let prefix;
  if (src.mode === 'cat') { field = top ? 'cat_score' : 'cat_ts'; prefix = src.cat; }
  else if (src.mode === 'user') { field = 'uid_ts'; prefix = src.uid; }
  else { field = top ? 'all_score' : 'all_ts'; prefix = 'all'; }
  const end = cursor ? endAt(cursor.val, cursor.key) : endAt(`${prefix}_\uf8ff`);
  const snap = await get(query(ref(db, 'posts'), orderByChild(field), startAt(`${prefix}_`), end, limitToLast(limit + 1)));
  let rows = [];
  snap.forEach((c) => { rows.push({ id: c.key, data: c.val(), sortVal: c.child(field).val() }); });
  rows.reverse();
  if (cursor) rows = rows.filter((r) => r.id !== cursor.key);
  const done = rows.length <= limit && snap.size < limit + 1;
  rows = rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    items: rows.map((r) => ({ id: r.id, data: r.data })),
    cursor: last ? { key: last.id, val: last.sortVal } : null,
    done: done || rows.length === 0,
  };
}

async function pageMine(cursor, limit) {
  const u = me();
  if (!u) return { items: [], cursor: null, done: true };
  const ms = await get(ref(db, `user_cats/${u}`));
  const slugs = Object.keys(ms.val() || {}).slice(0, 20);
  if (!slugs.length) return { items: [], cursor: null, done: true };
  const before = cursor ? cursor.ts : Infinity;
  const parts = await Promise.all(slugs.map((slug) => get(query(
    ref(db, 'posts'), orderByChild('cat_ts'), startAt(`${slug}_`),
    endAt(before === Infinity ? `${slug}_\uf8ff` : tsKey(slug, before)), limitToLast(limit + 1),
  ))));
  let rows = [];
  parts.forEach((s) => s.forEach((c) => { rows.push({ id: c.key, data: c.val() }); }));
  rows.sort((a, b) => b.data.ts - a.data.ts);
  if (cursor) rows = rows.filter((r) => r.data.ts < cursor.ts);
  const more = rows.length > limit;
  rows = rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return { items: rows, cursor: last ? { ts: last.data.ts } : null, done: !more };
}

// ---- cats ----
export const getCat = (slug) => get(ref(db, `cats/${slug}`)).then((s) => (s.exists() ? s.val() : null));
export const listCats = (limit = 50) => get(query(ref(db, 'cats'), orderByChild('member_count'), limitToLast(limit))).then((s) => {
  const out = [];
  s.forEach((c) => { out.push({ slug: c.key, ...c.val() }); });
  return out.reverse();
});
export async function myCats() {
  const u = me();
  if (!u) return [];
  const s = await get(ref(db, `user_cats/${u}`));
  const arr = await Promise.all(Object.keys(s.val() || {}).map((slug) => getCat(slug).then((c) => (c ? { slug, ...c } : null)).catch(() => null)));
  return arr.filter(Boolean);
}
export const isMember = (slug) => { const u = me(); return u ? get(ref(db, `cat_members/${slug}/${u}`)).then((s) => s.exists()).catch(() => false) : Promise.resolve(false); };
export const isBanned = (slug) => { const u = me(); return u ? get(ref(db, `cat_bans/${slug}/${u}`)).then((s) => s.exists()).catch(() => false) : Promise.resolve(false); };
export async function joinCat(slug) {
  const u = me(); if (!u) throw new Error('Not signed in');
  const up = {};
  up[`cat_members/${slug}/${u}`] = serverTimestamp();
  up[`user_cats/${u}/${slug}`] = serverTimestamp();
  await update(ref(db), up);
  const r = await bump(`cats/${slug}/member_count`, 1, 0);
  return r.snapshot.val() || 0;
}
export async function leaveCat(slug) {
  const u = me(); if (!u) throw new Error('Not signed in');
  const up = {};
  up[`cat_members/${slug}/${u}`] = null;
  up[`user_cats/${u}/${slug}`] = null;
  await update(ref(db), up);
  const r = await bump(`cats/${slug}/member_count`, -1, 0);
  return r.snapshot.val() || 0;
}
export const pinPost = (slug, pid, pinned) => update(ref(db), { [`cats/${slug}/pinned/${pid}`]: pinned ? true : null, [`posts/${pid}/pinned`]: pinned ? true : null });
