import React, { useEffect, useState, useCallback } from 'react';
import { FlatList, View, Alert, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { get as dbGet } from 'firebase/database';
import { firestore, db, auth } from '../firebase';
import { safeRef, safeOnValue, isValidKey, reportError } from '../safe';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Avatar, Row, Button, Loading, Empty } from '../components/ui';
import { getUser, findUidByUsername } from '../services/users';
import { renderHellocatString } from '../services/hellocatString';
import { THEMES } from '../theme/themes';
import { getRelationType, sendFriendRequest, cancelFriendRequest, acceptFriendRequest, rejectFriendRequest, unfriendUser, isFollowing, follow, unfollow } from '../services/friends';
import { userDisplayName, formatNumber, timeAgo } from '../utils';
import { BlogCard } from './BlogComponents';
import ErrorBoundary from '../components/ErrorBoundary';


const MOJO_PALETTE = [
  [0, ''], [100, '#1565C0'], [500, '#42A5F5'], [1e3, '#26A69A'], [5e3, '#66BB6A'], [1e4, '#9CCC65'],
  [2.5e4, '#FDD835'], [5e4, '#FB8C00'], [1e5, '#F4511E'], [2.5e5, '#E91E63'], [5e5, '#8E24AA'],
  [1e6, '#673AB7'], [5e6, '#3F51B5'], [1e7, '#00BCD4'], [5e7, '#4CAF50'], [1e8, '#CDDC39'],
  [5e8, '#FFEB3B'], [1e9, '#FFC107'], [5e9, '#FF9800'], [1e10, '#FF5722'], [5e10, '#E53935'],
  [1e11, '#C62828'], [5e11, '#AD1457'], [1e12, '#D500F9'], [Infinity, '#FF00FF'],
];
const mojoColor = (m) => (MOJO_PALETTE.find(([lim]) => m < lim) || MOJO_PALETTE[MOJO_PALETTE.length - 1])[1];

const fmtDate = (ts) => {
  const n = Number(ts);
  if (!n || !isFinite(n)) return '';
  try { return new Date(n).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return ''; }
};

const RANK_ICON = { vip: ['diamond', '#f5b301'], artist: ['color-palette', '#e91e63'], user: ['person-circle', '#5d8ffc'] };

// keys of a database node: one-time get, with an HTTPS fallback
async function fetchKeys(path, uid) {
  const r = safeRef(path, uid);
  if (!r) return [];
  try {
    const snap = await dbGet(r);
    const keys = [];
    snap.forEach((c) => { keys.push(c.key); });
    return keys;
  } catch (e) {
    const user = auth.currentUser;
    const token = user ? await user.getIdToken() : null;
    const base = db.app.options.databaseURL;
    const res = await fetch(`${base}/${path}/${encodeURIComponent(uid)}.json?shallow=true${token ? `&auth=${token}` : ''}`);
    if (!res.ok) throw new Error('REST ' + res.status);
    const v = await res.json();
    return v && typeof v === 'object' ? Object.keys(v) : [];
  }
}

function InfoRow({ label, value, color }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 5 }}>
      <AppText muted size={13}>{label}</AppText>
      <AppText size={13} bold style={color ? { color } : null}>{value}</AppText>
    </Row>
  );
}

function Stat({ label, value }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <AppText bold size={18}>{formatNumber(value)}</AppText>
      <AppText size={12} muted>{label}</AppText>
    </View>
  );
}

export default function ProfileScreen({ route, navigation }) {
  const { uid: myUid } = useAuth();
  const { theme } = useTheme();
  const uid = (route.params && route.params.uid) || myUid;
  const own = uid === myUid;
  const [user, setUser] = useState(undefined);
  const [online, setOnline] = useState(false);
  const [rel, setRel] = useState(null);
  const [following, setFollowing] = useState(false);
  const [counts, setCounts] = useState({ friends: 0, followers: 0, following: 0 });
  const [posts, setPosts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(null); // {state, last_changed} | false
  const [friends, setFriends] = useState([]); // [{uid, user}]
  const [friendsModal, setFriendsModal] = useState(false);
  const [totals, setTotals] = useState({ views: null, mojo: null });

  const loadRel = useCallback(async () => {
    if (own || !isValidKey(uid)) return;
    try {
      setRel(await getRelationType(myUid, uid));
      setFollowing(await isFollowing(myUid, uid));
    } catch (e) { /* relationship info is optional */ }
  }, [own, myUid, uid]);

  useEffect(() => {
    let alive = true;
    setUser(undefined);
    getUser(uid, true).then((u) => { if (alive) setUser(u || null); }).catch(() => { if (alive) setUser(null); });
    return () => { alive = false; };
  }, [uid]);
  useEffect(() => {
    const r = safeRef('status', uid, 'state');
    if (!r) return undefined;
    const un = safeOnValue(r, (s) => setOnline(s.val() === 'online'));
    return () => { if (typeof un === 'function') un(); };
  }, [uid]);
  useEffect(() => { loadRel(); }, [loadRel]);

  useEffect(() => {
    if (!isValidKey(uid)) return undefined;
    let alive = true;
    const got = {};
    const setCount = (k, n) => {
      if (!alive) return;
      setCounts((c) => ({ ...c, [k === 'friendships' ? 'friends' : k]: n }));
    };
    const countRest = async (k) => {
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : null;
      const base = db.app.options.databaseURL;
      const url = `${base}/${k}/${encodeURIComponent(uid)}.json?shallow=true${token ? `&auth=${token}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('REST ' + res.status);
      const v = await res.json();
      return v && typeof v === 'object' ? Object.keys(v).length : 0;
    };
    const unsubs = ['friendships', 'followers', 'following'].map((k) => {
      const r = safeRef(k, uid);
      if (!r) return null;
      const viaRest = () => countRest(k)
        .then((n) => { if (!got[k]) setCount(k, n); })
        .catch((e) => console.warn('[profile count REST]', k, e && e.message));
      // one-time fetch first (same as the web version), then live updates
      dbGet(r)
        .then((s) => { got[k] = true; setCount(k, s.numChildren()); })
        .catch((e) => { console.warn('[profile count get]', k, e && e.message); viaRest(); });
      return safeOnValue(
        r,
        (s) => {
          if (s && typeof s.numChildren === 'function') { got[k] = true; setCount(k, s.numChildren()); }
        },
        (e) => { console.warn('[profile count listener]', k, e && e.message); viaRest(); }
      );
    });
    return () => {
      alive = false;
      unsubs.forEach((u) => {
        if (typeof u === 'function') {
          try { u(); } catch (e) { /* ignore */ }
        }
      });
    };
  }, [uid]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!uid) return;
      try {
        const q = own
          ? query(collection(firestore, 'blogs'), where('uid', '==', uid))
          : query(collection(firestore, 'blogs'), where('uid', '==', uid), where('visibility', '==', 'public'));
        const snap = await getDocs(q);
        if (!alive) return;
        const items = (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d && typeof d.data === 'function' ? d.data() : {}) }));
        items.sort((a, b) => {
          const aTs = a && a.server_ts && typeof a.server_ts.toMillis === 'function' ? a.server_ts.toMillis() : (a && typeof a.server_ts === 'number' ? a.server_ts : 0);
          const bTs = b && b.server_ts && typeof b.server_ts.toMillis === 'function' ? b.server_ts.toMillis() : (b && typeof b.server_ts === 'number' ? b.server_ts : 0);
          return bTs - aTs;
        });
        setPosts(items);
      } catch (e) {
        if (alive) {
          reportError(e, 'profile-posts');
          setPosts([]);
        }
      }
    })();
    return () => { alive = false; };
  }, [uid, own]);

  // last online (status/{uid})
  useEffect(() => {
    let alive = true;
    setLastSeen(null);
    const r = safeRef('status', uid);
    if (!r) return undefined;
    dbGet(r).then((s) => { if (alive) setLastSeen(s.exists() ? s.val() : false); }).catch(() => { if (alive) setLastSeen(false); });
    return () => { alive = false; };
  }, [uid]);

  // friend list (avatars)
  useEffect(() => {
    let alive = true;
    setFriends([]);
    if (!isValidKey(uid)) return undefined;
    (async () => {
      try {
        const keys = await fetchKeys('friendships', uid);
        const list = await Promise.all(keys.map(async (k) => ({ uid: k, user: await getUser(k).catch(() => null) })));
        if (alive) setFriends(list.filter((f) => f.user));
      } catch (e) { console.warn('[profile friends]', e && e.message); }
    })();
    return () => { alive = false; };
  }, [uid]);

  // total views + mojo (same formula as the web version)
  useEffect(() => {
    let alive = true;
    setTotals({ views: null, mojo: null });
    (async () => {
      let V = 0; let L = 0; let C = 0;
      await Promise.all(posts.map(async (p) => {
        const r = p && p.id ? safeRef('blogs', p.id) : null;
        if (!r) return;
        try {
          const sn = await dbGet(r);
          C += sn.child('comments').numChildren();
          L += sn.child('reacts').numChildren();
          V += Number(sn.child('views').val()) || 0;
        } catch (e) { /* ignore one post */ }
      }));
      if (!alive) return;
      const mojo = Math.round(V * 2 + L * 150 + C * 300 + (L + C) * V * 0.1);
      setTotals({ views: V, mojo });
    })();
    return () => { alive = false; };
  }, [posts]);

  const goProfile = (u) => {
    if (navigation.push) navigation.push('Profile', { uid: u }); else navigation.navigate('Profile', { uid: u });
  };
  const openUserByName = async (username) => {
    try {
      const u = await findUidByUsername(username);
      if (u) goProfile(u);
    } catch (e) { /* ignore */ }
  };
  const openFriend = (fid) => {
    setFriendsModal(false);
    goProfile(fid);
  };

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); await loadRel(); } catch (e) { Alert.alert('Error', (e && e.message) || 'Something went wrong'); }
    setBusy(false);
  };

  useEffect(() => {
    if (own && navigation && typeof navigation.setOptions === 'function') {
      try {
        navigation.setOptions({
          headerRight: () => (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => navigation.navigate('Settings')}
              style={{ padding: 8, marginRight: 4, justifyContent: 'center', alignItems: 'center' }}
            >
              <Ionicons name="settings-outline" size={24} color={theme.primaryText} />
            </TouchableOpacity>
          ),
        });
      } catch (e) { /* ignore */ }
    }
  }, [own, navigation, theme]);

  if (user === undefined) return <Loading />;
  if (user === null) return <Empty text="This profile could not be found." />;

  const renderHeader = () => (
    <View style={{ padding: 18, alignItems: 'center' }}>
      <Avatar user={user} size={96} online={online} />
      <Row style={{ marginTop: 10, alignItems: 'center', justifyContent: 'center' }}>
        <AppText bold size={22}>{userDisplayName(user)}</AppText>
        {user.ranking ? (
          <Ionicons name={(RANK_ICON[user.ranking] || RANK_ICON.user)[0]} size={20} color={(RANK_ICON[user.ranking] || RANK_ICON.user)[1]} style={{ marginLeft: 6 }} />
        ) : null}
      </Row>
      {user.username ? <AppText muted>@{user.username}</AppText> : null}
      {user.bio ? (
        <View style={{ marginTop: 10, alignSelf: 'stretch' }}>
          <AppText style={{ textAlign: 'center' }} numberOfLines={user.bio.length > 255 && !bioOpen ? 5 : undefined}>
            {renderHellocatString(user.bio, {
              linkStyle: { color: theme.link, textDecorationLine: 'underline' },
              hashtagStyle: { color: theme.link, fontWeight: 'bold' },
              userStyle: { color: theme.link, fontWeight: 'bold' },
              onPressUser: openUserByName,
            })}
          </AppText>
          {user.bio.length > 255 && !bioOpen ? (
            <TouchableOpacity onPress={() => setBioOpen(true)} style={{ alignSelf: 'center', paddingVertical: 4 }}>
              <AppText size={13} style={{ color: theme.link }}>Show more</AppText>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      <Row style={{ marginTop: 16, alignSelf: 'stretch' }}>
        <Stat label="Friends" value={counts.friends} />
        <Stat label="Followers" value={counts.followers} />
        <Stat label="Following" value={counts.following} />
      </Row>
      <Row style={{ marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {own ? (
          <Button title="Edit profile" onPress={() => navigation.navigate('SettingsProfile')} secondary />
        ) : rel ? (
          <>
            {rel.is_friend ? <Button title="Unfriend" secondary loading={busy} onPress={() => Alert.alert('Unfriend?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Unfriend', style: 'destructive', onPress: () => act(() => unfriendUser(myUid, uid)) }])} style={{ margin: 4 }} />
              : rel.recieved ? (<>
                <Button title="Accept request" loading={busy} onPress={() => act(() => acceptFriendRequest(myUid, uid))} style={{ margin: 4 }} />
                <Button title="Decline" secondary onPress={() => act(() => rejectFriendRequest(myUid, uid))} style={{ margin: 4 }} />
              </>)
              : rel.sent ? <Button title="Cancel request" secondary loading={busy} onPress={() => act(() => cancelFriendRequest(myUid, uid))} style={{ margin: 4 }} />
              : <Button title="Add friend" loading={busy} onPress={() => act(() => sendFriendRequest(myUid, uid))} style={{ margin: 4 }} />}
            <Button title={following ? 'Following' : 'Follow'} secondary loading={busy} onPress={() => act(() => (following ? unfollow(myUid, uid) : follow(myUid, uid)))} style={{ margin: 4 }} />
            <Button title="Message" onPress={() => navigation.navigate('Chat', { fid: uid })} style={{ margin: 4 }} />
          </>
        ) : null}
      </Row>
      {/* Friends */}
      <View style={{ alignSelf: 'stretch', marginTop: 18 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <AppText bold>Friends : {counts.friends}</AppText>
          {friends.length > 8 ? (
            <TouchableOpacity onPress={() => setFriendsModal(true)}>
              <AppText size={13} style={{ color: theme.link }}>View all</AppText>
            </TouchableOpacity>
          ) : null}
        </Row>
        <Row style={{ flexWrap: 'wrap' }}>
          {friends.slice(0, 8).map((f) => (
            <TouchableOpacity key={f.uid} onPress={() => openFriend(f.uid)} style={{ marginRight: 8, marginBottom: 8 }}>
              <Avatar user={f.user} size={38} />
            </TouchableOpacity>
          ))}
          {friends.length > 8 ? (
            <TouchableOpacity onPress={() => setFriendsModal(true)} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#8884', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
              <AppText size={12} bold>+{friends.length - 8}</AppText>
            </TouchableOpacity>
          ) : null}
        </Row>
      </View>

      {/* Info */}
      <View style={{ alignSelf: 'stretch', marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: theme.card || '#8881' }}>
        <InfoRow label="Total Posts" value={String(posts.length)} />
        <InfoRow label="Total Views" value={totals.views == null ? '...' : formatNumber(totals.views)} />
        <InfoRow label="Mojo" value={totals.mojo == null ? '...' : formatNumber(totals.mojo)} color={totals.mojo == null ? undefined : (mojoColor(totals.mojo) || undefined)} />
        <InfoRow label="Gender" value={user.gender ? String(user.gender).charAt(0).toUpperCase() + String(user.gender).slice(1) : 'Not set'} />
        <InfoRow label="Birthday" value={user.birth ? fmtDate(user.birth) : 'Not set'} />
        <InfoRow label="Joined" value={user.accountCreated ? fmtDate(user.accountCreated) : 'Unknown'} />
        <InfoRow
          label="Last Online"
          value={online ? 'Now' : lastSeen === null ? '...' : lastSeen && lastSeen.last_changed ? timeAgo(Number(lastSeen.last_changed)) || 'Unknown' : 'Unknown'}
        />
        <InfoRow label="Theme" value={(THEMES[user.theme] && THEMES[user.theme].name) || 'Default'} />
        <InfoRow label="Archives" value={String(Array.isArray(user._archive) ? user._archive.length : 0)} />
      </View>

      <AppText bold style={{ alignSelf: 'flex-start', marginTop: 22 }}>Posts</AppText>
    </View>
  );

  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <FlatList
        data={posts}
        keyExtractor={(p, i) => String((p && p.id) || i)}
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => (
          <ErrorBoundary compact name="profile-post">
            <BlogCard post={item} navigation={navigation} showAuthor={false} />
          </ErrorBoundary>
        )}
        ListEmptyComponent={<AppText muted style={{ textAlign: 'center', padding: 20 }}>No posts yet.</AppText>}
        contentContainerStyle={{ paddingBottom: 30 }}
      />
      <Modal visible={friendsModal} transparent animationType="fade" onRequestClose={() => setFriendsModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 }}>
          <View style={{ maxHeight: '80%', borderRadius: 16, backgroundColor: theme.card || '#1f1f23', overflow: 'hidden' }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: theme.border || '#333' }}>
              <AppText bold size={16}>Friends ({friends.length})</AppText>
              <TouchableOpacity onPress={() => setFriendsModal(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </Row>
            <FlatList
              data={friends}
              keyExtractor={(f) => f.uid}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => openFriend(item.uid)} activeOpacity={0.7}>
                  <Row style={{ alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 }}>
                    <Avatar user={item.user} size={40} />
                    <View style={{ marginLeft: 12, flex: 1 }}>
                      <AppText bold numberOfLines={1}>{userDisplayName(item.user)}</AppText>
                      {item.user.username ? <AppText muted size={12}>@{item.user.username}</AppText> : null}
                    </View>
                  </Row>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
