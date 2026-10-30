import React, { useEffect, useState, useMemo } from 'react';
import { FlatList, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ref, get } from 'firebase/database';
import { db } from '../firebase';
import { safeRef, safeOnValue, normalizeUser } from '../safe';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Avatar, Row, Input, Empty, Loading, Button } from '../components/ui';
import { useUser } from '../services/users';
import { acceptFriendRequest, rejectFriendRequest, cancelFriendRequest } from '../services/friends';
import { userDisplayName } from '../utils';

function UserRow({ uid: fid, data, navigation, right }) {
  const fetched = useUser(data ? null : fid);
  const user = data || fetched;
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const r = safeRef('status', fid, 'state');
    if (!r) return undefined;
    return safeOnValue(r, (s) => setOnline(s.val() === 'online'));
  }, [fid]);
  return (
    <TouchableOpacity onPress={() => navigation.navigate('Profile', { uid: fid })} activeOpacity={0.7}>
      <Row style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <Avatar user={user} size={46} online={online} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <AppText bold numberOfLines={1}>{userDisplayName(user)}</AppText>
          {user && user.username ? <AppText size={12} muted>@{user.username}</AppText> : null}
        </View>
        {right}
      </Row>
    </TouchableOpacity>
  );
}

function useKeys(path) {
  const [keys, setKeys] = useState(null);
  useEffect(() => {
    const r = safeRef(path);
    if (!r) { setKeys([]); return undefined; }
    return safeOnValue(r, (s) => { const v = s.val(); setKeys(v && typeof v === 'object' ? Object.keys(v) : []); }, () => setKeys((k) => k || []));
  }, [path]);
  return keys;
}

export default function FriendsScreen({ navigation }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const [tab, setTab] = useState('friends');
  const friends = useKeys('friendships/' + uid);
  const received = useKeys('friend_req/recieved/' + uid);
  const sent = useKeys('friend_req/sent/' + uid);
  const [allUsers, setAllUsers] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (tab === 'find' && !allUsers) {
      get(ref(db, 'users')).then((s) => {
        const out = {};
        if (s.exists()) s.forEach((c) => { const u = normalizeUser(c.val()); if (u) out[c.key] = u; });
        setAllUsers(out);
      }).catch(() => setAllUsers({}));
    }
  }, [tab, allUsers]);

  const results = useMemo(() => {
    if (!allUsers) return [];
    const t = q.trim().toLowerCase();
    return Object.keys(allUsers)
      .filter((id) => id !== uid)
      .map((id) => ({ id, u: allUsers[id] }))
      .filter(({ u }) => u && (!t || userDisplayName(u).toLowerCase().includes(t) || u.username.toLowerCase().includes(t)))
      .slice(0, 60);
  }, [allUsers, q, uid]);

  const Tab = ({ id, label, badge }) => (
    <TouchableOpacity onPress={() => setTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: tab === id ? theme.link : 'transparent' }}>
      <AppText bold={tab === id} style={{ color: tab === id ? theme.link : theme.text }}>{label}{badge ? ` (${badge})` : ''}</AppText>
    </TouchableOpacity>
  );

  const chatBtn = (fid) => (
    <TouchableOpacity onPress={() => navigation.navigate('Chat', { fid })} style={{ padding: 8 }}>
      <Ionicons name="chatbubble-ellipses-outline" size={24} color={theme.link} />
    </TouchableOpacity>
  );

  let body;
  if (tab === 'friends') {
    body = friends === null ? <Loading /> : friends.length === 0 ? <Empty text="No friends yet. Use Find to search for people." /> : (
      <FlatList data={friends} keyExtractor={(i) => i} renderItem={({ item }) => <UserRow uid={item} navigation={navigation} right={chatBtn(item)} />} />
    );
  } else if (tab === 'requests') {
    const items = [...(received || []).map((id) => ({ id, kind: 'in' })), ...(sent || []).map((id) => ({ id, kind: 'out' }))];
    body = received === null || sent === null ? <Loading /> : items.length === 0 ? <Empty text="No pending friend requests." /> : (
      <FlatList
        data={items}
        keyExtractor={(i) => i.kind + i.id}
        renderItem={({ item }) => (
          <UserRow
            uid={item.id}
            navigation={navigation}
            right={item.kind === 'in' ? (
              <Row>
                <Button title="Accept" small onPress={() => acceptFriendRequest(uid, item.id)} />
                <Button title="✕" small secondary onPress={() => rejectFriendRequest(uid, item.id)} style={{ marginLeft: 6 }} />
              </Row>
            ) : <Button title="Cancel" small secondary onPress={() => cancelFriendRequest(uid, item.id)} />}
          />
        )}
      />
    );
  } else {
    body = (
      <View style={{ flex: 1 }}>
        <View style={{ padding: 12, paddingBottom: 2 }}><Input placeholder="Search by name or username" value={q} onChangeText={setQ} /></View>
        {!allUsers ? <Loading /> : results.length === 0 ? <Empty text="No users found." /> : (
          <FlatList data={results} keyExtractor={(i) => i.id} keyboardShouldPersistTaps="handled" renderItem={({ item }) => <UserRow uid={item.id} data={item.u} navigation={navigation} />} />
        )}
      </View>
    );
  }

  return (
    <Screen>
      <Row style={{ backgroundColor: theme.navBg }}>
        <Tab id="friends" label="Friends" />
        <Tab id="requests" label="Requests" badge={received && received.length ? received.length : 0} />
        <Tab id="find" label="Find" />
      </Row>
      {body}
    </Screen>
  );
}
