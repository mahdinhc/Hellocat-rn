import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { FlatList, TouchableOpacity, View, Alert } from 'react-native';
import { query, limitToLast } from 'firebase/database';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Avatar, Row, Empty, Loading } from '../components/ui';
import ErrorBoundary from '../components/ErrorBoundary';
import { getUser } from '../services/users';
import { removeConversation } from '../services/chat';
import { userDisplayName, timeAgo } from '../utils';
import { safeRef, safeOnValue, normalizeMessage, isValidKey, str } from '../safe';
import { cacheUserChats, getCachedUserChats } from '../services/offlineStorage';

// m must be a normalized message (see safe.normalizeMessage) or null
export function previewOf(m, uid) {
  if (!m) return 'No messages yet';
  const mine = m.send_from && m.send_from === uid ? 'You: ' : '';
  if (m.removed) return mine + 'Message removed';
  const oneLine = (t) => str(t).split('\n')[0];
  switch (m.type) {
    case 'text': return mine + oneLine(m.data);
    case 'code': return mine + '</> code';
    case 'file': return mine + '📎 ' + (m.filename || 'file');
    case 'emoji':
    case 'extramoji': return mine + ':' + (m.emoji || '') + ':';
    case 'event': return 'Chat started';
    default: return mine + (oneLine(m.data) || m.filename || m.emoji || 'Message');
  }
}

function ChatRow({ fid, cid, onOpen, reportTs }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const [user, setUser] = useState(null);
  const [online, setOnline] = useState(false);
  const [last, setLast] = useState(null);

  useEffect(() => { let a = true; getUser(fid).then((u) => a && setUser(u)).catch(() => {}); return () => { a = false; }; }, [fid]);

  useEffect(() => {
    const r = safeRef('status', fid, 'state');
    if (!r) return undefined;
    return safeOnValue(r, (s) => setOnline(s.val() === 'online'));
  }, [fid]);

  useEffect(() => {
    const r = safeRef('chats_data', cid, 'messages');
    if (!r) return undefined;
    // Ordered by push-key (which is chronological) so the server only sends ONE message.
    // The old orderByChild('timestamp') needs an index; without it the client downloads every message of every chat.
    return safeOnValue(query(r, limitToLast(1)), (snap) => {
      let m = null;
      snap.forEach((c) => { m = normalizeMessage(c.key, c.val()); });
      setLast(m);
      reportTs(fid, m ? m.timestamp : 0);
    });
  }, [cid, fid, reportTs]);

  const unread = !!(last && last.send_to === uid && !last.isSeenByReceiver && !last.removed && last.type !== 'event');
  return (
    <TouchableOpacity onPress={() => onOpen(fid, cid)} activeOpacity={0.7}>
      <Row style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
        <Avatar user={user} size={52} online={online} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText bold numberOfLines={1} style={{ flex: 1 }}>{userDisplayName(user)}</AppText>
            <AppText size={11} muted>{last ? timeAgo(last.timestamp) : ''}</AppText>
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

  useEffect(() => {
    if (!uid) return;
    getCachedUserChats(uid).then((cached) => {
      if (cached && Object.keys(cached).length) {
        setChats((curr) => (!curr || !Object.keys(curr).length ? cached : curr));
      }
    }).catch(() => {});
  }, [uid]);

  useEffect(() => {
    const r = safeRef('chats', uid);
    if (!r) { setChats({}); return undefined; }
    return safeOnValue(
      r,
      (s) => {
        const raw = s.exists() ? s.val() : {};
        const clean = {};
        if (raw && typeof raw === 'object') {
          Object.keys(raw).forEach((fid) => {
            const cid = raw[fid];
            // ignore malformed entries instead of crashing on them
            if (isValidKey(fid) && isValidKey(cid)) clean[fid] = cid;
          });
        }
        setChats(clean);
        cacheUserChats(uid, clean);
      },
      () => setChats((c) => c || {}),
    );
  }, [uid]);

  const reportTs = useCallback((fid, ts) => {
    setTsMap((m) => (m[fid] === ts ? m : { ...m, [fid]: ts }));
  }, []);

  const data = useMemo(() => {
    if (!chats) return [];
    return Object.keys(chats).map((fid) => ({ fid, cid: chats[fid] })).sort((a, b) => (tsMap[b.fid] || 0) - (tsMap[a.fid] || 0));
  }, [chats, tsMap]);

  const open = useCallback((fid, cid) => navigation.navigate('Chat', { fid, cid }), [navigation]);

  if (!chats) return <Loading />;
  return (
    <Screen>
      {data.length === 0 ? (
        <Empty text={'No conversations yet.\nOpen the Friends tab to find people and start chatting.'} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(i) => i.fid}
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item }) => (
            <ErrorBoundary compact name="chat-row">
              <ChatRow fid={item.fid} cid={item.cid} onOpen={open} reportTs={reportTs} />
            </ErrorBoundary>
          )}
        />
      )}
    </Screen>
  );
}
