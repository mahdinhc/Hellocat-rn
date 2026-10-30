import React, { useEffect, useState, useCallback } from 'react';
import { FlatList, View, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ref, onValue, get } from 'firebase/database';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, firestore } from '../firebase';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Avatar, Row, Button, Loading, Empty } from '../components/ui';
import { getUser } from '../services/users';
import { getRelationType, sendFriendRequest, cancelFriendRequest, acceptFriendRequest, rejectFriendRequest, unfriendUser, isFollowing, follow, unfollow } from '../services/friends';
import { userDisplayName, formatNumber } from '../utils';
import { BlogCard } from './BlogComponents';

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

  const loadRel = useCallback(async () => {
    if (own) return;
    setRel(await getRelationType(myUid, uid));
    setFollowing(await isFollowing(myUid, uid));
  }, [own, myUid, uid]);

  useEffect(() => { getUser(uid, true).then((u) => setUser(u || null)); }, [uid]);
  useEffect(() => onValue(ref(db, 'status/' + uid + '/state'), (s) => setOnline(s.val() === 'online')), [uid]);
  useEffect(() => { loadRel(); }, [loadRel]);

  useEffect(() => {
    const unsubs = ['friendships', 'followers', 'following'].map((k) =>
      onValue(ref(db, `${k}/${uid}`), (s) => setCounts((c) => ({ ...c, [k === 'friendships' ? 'friends' : k]: s.numChildren() }))));
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  useEffect(() => {
    (async () => {
      try {
        const base = [collection(firestore, 'blogs'), where('uid', '==', uid)];
        if (!own) base.push(where('visibility', '==', 'public'));
        const snap = await getDocs(query(...base));
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a, b) => ((b.server_ts && b.server_ts.toMillis ? b.server_ts.toMillis() : 0) - (a.server_ts && a.server_ts.toMillis ? a.server_ts.toMillis() : 0)));
        setPosts(items);
      } catch (e) { setPosts([]); }
    })();
  }, [uid, own]);

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); await loadRel(); } catch (e) { Alert.alert('Error', e.message); }
    setBusy(false);
  };

  useEffect(() => {
    if (own) {
      navigation.setOptions({ headerRight: () => <TouchableOpacity onPress={() => navigation.navigate('Settings')}><Ionicons name="settings-outline" size={24} color={theme.primaryText} /></TouchableOpacity> });
    }
  }, [own, navigation, theme]);

  if (user === undefined) return <Loading />;
  if (user === null) return <Empty text="This profile could not be found." />;

  const Header = (
    <View style={{ padding: 18, alignItems: 'center' }}>
      <Avatar user={user} size={96} online={online} />
      <AppText bold size={22} style={{ marginTop: 10 }}>{userDisplayName(user)}</AppText>
      {user.username ? <AppText muted>@{user.username}</AppText> : null}
      {user.bio ? <AppText style={{ textAlign: 'center', marginTop: 10 }}>{user.bio}</AppText> : null}
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
      <AppText bold style={{ alignSelf: 'flex-start', marginTop: 22 }}>Posts</AppText>
    </View>
  );

  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={Header}
        renderItem={({ item }) => <BlogCard post={item} navigation={navigation} showAuthor={false} />}
        ListEmptyComponent={<AppText muted style={{ textAlign: 'center', padding: 20 }}>No posts yet.</AppText>}
        contentContainerStyle={{ paddingBottom: 30 }}
      />
    </Screen>
  );
}
