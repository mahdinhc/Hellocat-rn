import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { FlatList, TouchableOpacity, View, Alert } from 'react-native';
import { ref, onValue, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Avatar, Row, Empty, Loading } from '../components/ui';
import { getUser } from '../services/users';
import { removeConversation } from '../services/chat';
import { userDisplayName, timeAgo } from '../utils';

export function previewOf(m, uid) {
  if (!m) return 'No messages yet';
  const mine = m.send_from === uid ? 'You: ' : '';
  if (m.removed) return mine + 'Message removed';
  switch (m.type) {
    case 'text': return mine + (m.data || '');
    case 'code': return mine + '</> code';
    case 'file': return mine + '📎 ' + (m.filename || 'file');
    case 'emoji': return mine + ':' + (m.emoji || '') + ':';
    case 'event': return 'Chat started';
    default: return mine + (m.data || 'Message');
  }
}

function ChatRow({ fid, cid, onOpen, onLongPress, reportTs }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const [user, setUser] = useState(null);
  const [online, setOnline] = useState(false);
  const [last, setLast] = useState(null);

  useEffect(() => { let a = true; getUser(fid).then((u) => a && setUser(u)); return () => { a = false; }; }, [fid]);
  useEffect(() => onValue(ref(db, 'status/' + fid + '/state'), (s) => setOnline(s.val() === 'online')), [fid]);
  useEffect(() => {
    const q = query(ref(db, `chats_data/${cid}/messages`), orderByChild('timestamp'), limitToLast(1));
    return onValue(q, (snap) => {
      let m = null;
      snap.forEach((c) => { m = { key: c.key, ...c.val() }; });
      setLast(m);
      reportTs(fid, m && typeof m.timestamp === 'number' ? m.timestamp : 0);
    });
  }, [cid, fid, reportTs]);

  const unread = last && last.send_to === uid && last.isSeenByReceiver === false && !last.removed;
  return (
    <TouchableOpacity onPress={() => onOpen(fid, cid)} onLongPress={() => onLongPress(fid, user)} activeOpacity={0.7}>
      <Row style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
        <Avatar user={user} size={52} online={online} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText bold numberOfLines={1} style={{ flex: 1 }}>{userDisplayName(user)}</AppText>
            <AppText size={11} muted>{last && typeof last.timestamp === 'number' ? timeAgo(last.timestamp) : ''}</AppText>
          </Row>
          <Row style={{ marginTop: 2 }}>
            <AppText numberOfLines={1} size={13} muted={!unread} bold={unread} style={{ flex: 1 }}>{previewOf(last, uid)}</AppText>
            {unread ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.badge, marginLeft: 8 }} /> : null}
          </Row>
        </View>
      </Row>
    </TouchableOpacity>
  );
}

export default function ChatsScreen({ navigation }) {
  const { uid } = useAuth();
  const [chats, setChats] = useState(null); // { fid: cid }
  const [tsMap, setTsMap] = useState({});

  useEffect(() => onValue(ref(db, 'chats/' + uid), (s) => setChats(s.exists() ? s.val() : {})), [uid]);

  const reportTs = useCallback((fid, ts) => {
    setTsMap((m) => (m[fid] === ts ? m : { ...m, [fid]: ts }));
  }, []);

  const data = useMemo(() => {
    if (!chats) return [];
    return Object.keys(chats).map((fid) => ({ fid, cid: chats[fid] })).sort((a, b) => (tsMap[b.fid] || 0) - (tsMap[a.fid] || 0));
  }, [chats, tsMap]);

  const open = (fid, cid) => navigation.navigate('Chat', { fid, cid });
  const longPress = (fid, user) => {
    Alert.alert(userDisplayName(user), 'Remove this conversation from your list?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeConversation(uid, fid) },
    ]);
  };

  if (!chats) return <Loading />;
  return (
    <Screen>
      {data.length === 0 ? (
        <Empty text={'No conversations yet.\nOpen the Friends tab to find people and start chatting.'} />
      ) : (
        <FlatList data={data} keyExtractor={(i) => i.fid} renderItem={({ item }) => <ChatRow fid={item.fid} cid={item.cid} onOpen={open} onLongPress={longPress} reportTs={reportTs} />} />
      )}
    </Screen>
  );
}
