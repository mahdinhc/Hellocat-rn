import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { FlatList, View, TouchableOpacity, Image, Linking, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { query, limitToLast } from 'firebase/database';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Avatar, Row, Input, Loading } from '../components/ui';
import { useUser } from '../services/users';
import { getOrCreateChat, sendTextMessage, sendFileMessage, removeMessage, markSeen, setTyping, uploadChatFile, reactToMessage, unreactMessage } from '../services/chat';
import { userDisplayName, formatClock, isImageType, bytesToLabel } from '../utils';
import { previewOf } from './ChatsScreen';
import ErrorBoundary from '../components/ErrorBoundary';
import { safeRef, safeOnValue, normalizeMessage, isValidKey } from '../safe';
import { setActiveChat } from '../services/notifications';
import { callManager } from '../services/call';
import { cacheChatMessages, getCachedChatMessages } from '../services/offlineStorage';
import * as Clipboard from 'expo-clipboard';

const PAGE = 40;

const POPULAR_REACTS = [
  { code: 'u2764', emoji: '❤️' },
  { code: 'u1f602', emoji: '😂' },
  { code: 'u1f62e', emoji: '😮' },
  { code: 'u1f622', emoji: '😢' },
  { code: 'u1f44d', emoji: '👍' },
  { code: 'u1f525', emoji: '🔥' },
];

function codeToChar(code) {
  if (!code) return '❤️';
  if (code.startsWith('u')) {
    try {
      const hex = code.slice(1);
      const cp = parseInt(hex, 16);
      if (!isNaN(cp)) return String.fromCodePoint(cp);
    } catch (e) {}
  }
  return code;
}

function Bubble({ m, mine, replied, onLongPress, onToggleReact, currentUid, theme }) {
  if (m.type === 'event') {
    return <AppText size={12} muted style={{ textAlign: 'center', marginVertical: 8 }}>{previewOf(m, '')}</AppText>;
  }
  const bg = mine ? theme.sendBg : theme.recvBg;
  const fg = mine ? theme.sendText : theme.recvText;
  let body;
  if (m.removed) {
    body = <AppText style={{ color: fg, opacity: 0.6, fontStyle: 'italic' }}>This message was removed</AppText>;
  } else if (m.type === 'file') {
    if (isImageType(m.filetype) && m.url) {
      body = (
        <TouchableOpacity onPress={() => { Linking.openURL(m.url).catch(() => {}); }}>
          <Image source={{ uri: m.url }} style={{ width: 220, height: 220, borderRadius: 8 }} resizeMode="cover" />
        </TouchableOpacity>
      );
    } else {
      body = (
        <TouchableOpacity onPress={() => { if (m.url) Linking.openURL(m.url).catch(() => {}); }}>
          <Row><Ionicons name="document-outline" size={22} color={fg} /><AppText style={{ color: fg, marginLeft: 6, textDecorationLine: 'underline' }}>{m.filename || 'file'}</AppText></Row>
        </TouchableOpacity>
      );
    }
  } else if (m.type === 'call') {
    const isVideo = m.callType === 'video';
    const durSec = m.duration || 0;
    const durFormatted = durSec > 0 ? `${Math.floor(durSec / 60)}m ${durSec % 60}s` : (m.callStatus === 'missed' ? 'Missed' : (m.callStatus === 'declined' ? 'Declined' : 'No answer'));
    body = (
      <Row style={{ alignItems: 'center' }}>
        <Ionicons name={isVideo ? 'videocam-outline' : 'call-outline'} size={18} color={fg} />
        <AppText style={{ color: fg, marginLeft: 6, fontWeight: '600', fontSize: 13 }}>
          {isVideo ? 'Video Call' : 'Audio Call'} • {durFormatted}
        </AppText>
      </Row>
    );
  } else if (m.type === 'code') {
    body = <AppText style={{ color: fg, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 }}>{m.data}</AppText>;
  } else if (m.type === 'emoji') {
    body = <AppText size={(m.size || 40) / 2} style={{ color: fg }}>:{m.emoji}:</AppText>;
  } else {
    body = <AppText style={{ color: fg }}>{m.data}</AppText>;
  }

  // Aggregate reacts
  const reactsMap = m.reacts || null;
  const aggregatedReacts = [];
  if (reactsMap && typeof reactsMap === 'object') {
    const counts = {};
    const hasMyReact = {};
    Object.keys(reactsMap).forEach((rUid) => {
      const r = reactsMap[rUid];
      if (!r) return;
      const t = r.type || 'u2764';
      counts[t] = (counts[t] || 0) + 1;
      if (rUid === currentUid) hasMyReact[t] = true;
    });
    Object.keys(counts).forEach((type) => {
      aggregatedReacts.push({
        type,
        char: codeToChar(type),
        count: counts[type],
        mine: !!hasMyReact[type],
      });
    });
  }

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginVertical: 2, paddingHorizontal: 10 }}>
      <TouchableOpacity activeOpacity={0.85} onLongPress={() => onLongPress(m)} style={{ maxWidth: '82%', backgroundColor: bg, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
        {replied ? (
          <View style={{ borderLeftWidth: 3, borderLeftColor: fg, opacity: 0.7, paddingLeft: 8, marginBottom: 6 }}>
            <AppText size={12} numberOfLines={2} style={{ color: fg }}>{previewOf(replied, '')}</AppText>
          </View>
        ) : null}
        {body}
        <Row style={{ justifyContent: 'flex-end', marginTop: 3 }}>
          <AppText size={10} style={{ color: fg, opacity: 0.6 }}>{formatClock(m.timestamp)}</AppText>
          {mine && !m.removed ? <Ionicons name={m.isSeenByReceiver ? 'checkmark-done' : 'checkmark'} size={13} color={fg} style={{ opacity: 0.7, marginLeft: 4 }} /> : null}
        </Row>
      </TouchableOpacity>
      {aggregatedReacts.length > 0 ? (
        <Row style={{ flexWrap: 'wrap', marginTop: -6, marginBottom: 4, zIndex: 2, alignSelf: mine ? 'flex-end' : 'flex-start', marginHorizontal: 6 }}>
          {aggregatedReacts.map((r) => (
            <TouchableOpacity
              key={r.type}
              activeOpacity={0.7}
              onPress={() => onToggleReact && onToggleReact(m, r.type)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: r.mine ? (theme.card || '#2a2a2a') : (theme.bg || '#1a1a1a'),
                borderWidth: 1,
                borderColor: r.mine ? theme.link : (theme.border || '#333'),
                borderRadius: 12,
                paddingHorizontal: 6,
                paddingVertical: 2,
                marginRight: 4,
                marginBottom: 2,
                elevation: 2,
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowRadius: 2,
                shadowOffset: { width: 0, height: 1 },
              }}
            >
              <AppText size={12}>{r.char}</AppText>
              {r.count > 1 ? <AppText size={11} style={{ color: theme.text, marginLeft: 3, fontWeight: '600' }}>{r.count}</AppText> : null}
            </TouchableOpacity>
          ))}
        </Row>
      ) : null}
    </View>
  );
}

export default function ChatScreen({ route, navigation }) {
  const params = route.params || {};
  const fid = isValidKey(params.fid) ? params.fid : null;
  const { uid } = useAuth();
  const { theme } = useTheme();
  const friend = useUser(fid);
  const [cid, setCid] = useState(isValidKey(params.cid) ? params.cid : null);
  const [limit, setLimit] = useState(PAGE);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [online, setOnline] = useState(false);
  const [friendTyping, setFriendTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const typingTimer = useRef(null);

  useEffect(() => {
    if (!cid && fid) getOrCreateChat(uid, fid).then((c) => { if (isValidKey(c)) setCid(c); else Alert.alert('Error', 'This conversation could not be opened.'); }).catch((e) => Alert.alert('Error', (e && e.message) || 'Could not open chat'));
  }, [cid, uid, fid]);

  // tell the notification service which chat is on screen so it does not notify for it
  useEffect(() => { setActiveChat(cid); return () => setActiveChat(null); }, [cid]);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <TouchableOpacity onPress={() => navigation.navigate('Profile', { uid: fid })}>
          <Row>
            <Avatar user={friend} size={34} online={online} />
            <View style={{ marginLeft: 10 }}>
              <AppText bold style={{ color: theme.chatHeadText }} numberOfLines={1}>{userDisplayName(friend)}</AppText>
              <AppText size={11} style={{ color: theme.chatHeadText, opacity: 0.6 }}>{friendTyping ? 'typing...' : online ? 'Active now' : 'Offline'}</AppText>
            </View>
          </Row>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <Row style={{ gap: 6 }}>
          <TouchableOpacity
            onPress={() => fid && callManager.startCall(fid, 'audio', cid)}
            style={{ padding: 6 }}
          >
            <Ionicons name="call-outline" size={22} color={theme.chatHeadText || theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => fid && callManager.startCall(fid, 'video', cid)}
            style={{ padding: 6 }}
          >
            <Ionicons name="videocam-outline" size={24} color={theme.chatHeadText || theme.text} />
          </TouchableOpacity>
        </Row>
      ),
    });
  }, [navigation, friend, online, friendTyping, theme, fid, cid]);

  useEffect(() => {
    const r = safeRef('status', fid, 'state');
    if (!r) return undefined;
    return safeOnValue(r, (s) => setOnline(s.val() === 'online'));
  }, [fid]);

  // Load cached offline messages first
  useEffect(() => {
    if (!cid) return;
    getCachedChatMessages(cid).then((cached) => {
      if (cached && cached.length) {
        setMsgs((curr) => (!curr || curr.length === 0 ? cached : curr));
      }
    }).catch(() => {});
  }, [cid]);

  useEffect(() => {
    const r = cid ? safeRef('chats_data', cid, 'messages') : null;
    if (!r) return undefined;
    // push-keys are chronological, so ordering by key gives the newest `limit` messages without needing a DB index
    return safeOnValue(
      query(r, limitToLast(limit)),
      (snap) => {
        const list = [];
        snap.forEach((c) => { list.push(normalizeMessage(c.key, c.val())); });
        const now = Date.now();
        list.sort((a, b) => (a.timestamp || now) - (b.timestamp || now));
        setMsgs(list);
        cacheChatMessages(cid, list);
      },
      () => setMsgs((m) => m || []),
    );
  }, [cid, limit]);

  useEffect(() => {
    const r = cid ? safeRef('chats_data', cid, 'typing', fid) : null;
    if (!r) return undefined;
    return safeOnValue(r, (s) => {
      const v = s.val();
      setFriendTyping(typeof v === 'number' && v > 0 && Date.now() - v < 8000);
    });
  }, [cid, fid]);

  // mark incoming messages as seen
  useEffect(() => {
    if (!cid || !msgs) return;
    msgs.forEach((m) => { if (m.send_to === uid && !m.isSeenByReceiver && m.key) markSeen(cid, m.key); });
  }, [msgs, cid, uid]);

  useEffect(() => () => { if (cid) { try { setTyping(cid, uid, false); } catch (e) { /* ignore */ } } clearTimeout(typingTimer.current); }, [cid, uid]);

  const onChange = (t) => {
    setText(t);
    if (!cid) return;
    setTyping(cid, uid, t.length > 0);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(cid, uid, false), 3000);
  };

  const byKey = useMemo(() => { const o = {}; (msgs || []).forEach((m) => { o[m.key] = m; }); return o; }, [msgs]);

  const send = async () => {
    const t = text.trim();
    if (!t || !cid) return;
    setText('');
    const r = replyTo ? replyTo.key : null;
    setReplyTo(null);
    setTyping(cid, uid, false);
    try { await sendTextMessage(cid, uid, fid, t, r); } catch (e) { Alert.alert('Could not send', e.message); }
  };

  const sendAsset = async (asset, mime) => {
    if (!cid) return;
    setUploading(true);
    try {
      const { url, name } = await uploadChatFile(uid, asset);
      const ext = (name.split('.').pop() || '').toLowerCase();
      await sendFileMessage(cid, uid, fid, url, mime || asset.mimeType || 'application/octet-stream', name, ext, replyTo ? replyTo.key : null);
      setReplyTo(null);
    } catch (e) { Alert.alert('Upload failed', e.message); }
    setUploading(false);
  };

  const pickImage = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
      if (!res.canceled && res.assets && res.assets[0]) {
        const a = res.assets[0];
        await sendAsset({ ...a, fileName: a.fileName || `photo_${Date.now()}.jpg` }, a.mimeType || 'image/jpeg');
      }
    } catch (e) { Alert.alert('Photo', (e && e.message) || 'Could not open photos'); }
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (!res.canceled && res.assets && res.assets[0]) {
        const a = res.assets[0];
        if (a.size && a.size > 25 * 1024 * 1024) { Alert.alert('Too large', 'Files over 25 MB are not supported (' + bytesToLabel(a.size) + ').'); return; }
        await sendAsset({ ...a, fileName: a.name }, a.mimeType);
      }
    } catch (e) { Alert.alert('File', (e && e.message) || 'Could not open files'); }
  };

  const attach = () => Alert.alert('Attach', undefined, [
    { text: 'Photo', onPress: pickImage },
    { text: 'File', onPress: pickFile },
    { text: 'Cancel', style: 'cancel' },
  ]);

  const [selectedMessage, setSelectedMessage] = useState(null);

  const toggleReact = useCallback((m, reactType) => {
    if (!cid || !m || !m.key || !uid) return;
    const currentReact = m.reacts && m.reacts[uid] ? m.reacts[uid].type : null;
    if (currentReact === reactType) {
      unreactMessage(cid, m.key, uid).catch(() => {});
    } else {
      reactToMessage(cid, m.key, uid, reactType).catch(() => {});
    }
  }, [cid, uid]);

  const onLongPress = useCallback((m) => {
    if (m.removed) return;
    setSelectedMessage(m);
  }, []);

  const closeMenu = () => setSelectedMessage(null);

  const copySelectedText = () => {
    if (!selectedMessage) return;
    const textToCopy = selectedMessage.data || selectedMessage.filename || (selectedMessage.type === 'call' ? (selectedMessage.callType === 'video' ? 'Video Call' : 'Audio Call') : '');
    if (textToCopy) {
      Clipboard.setStringAsync(textToCopy).catch(() => {});
    }
    closeMenu();
  };

  const replySelected = () => {
    if (selectedMessage) setReplyTo(selectedMessage);
    closeMenu();
  };

  const deleteSelected = () => {
    if (selectedMessage && selectedMessage.send_from === uid) {
      removeMessage(cid, selectedMessage.key).catch(() => {});
    }
    closeMenu();
  };

  if (!fid) return <Screen><AppText muted style={{ textAlign: 'center', padding: 24 }}>This conversation is not available.</AppText></Screen>;
  if (!msgs) return <Loading />;
  const data = [...msgs].reverse();

  return (
    <Screen style={{ backgroundColor: theme.chatBg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <FlatList
          inverted
          data={data}
          keyExtractor={(m) => m.key}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => (
            <ErrorBoundary compact name="bubble">
              <Bubble
                m={item}
                mine={item.send_from === uid}
                replied={item.reply_of ? byKey[item.reply_of] : null}
                onLongPress={onLongPress}
                onToggleReact={toggleReact}
                currentUid={uid}
                theme={theme}
              />
            </ErrorBoundary>
          )}
          onEndReached={() => { if (msgs.length >= limit) setLimit((l) => l + PAGE); }}
          onEndReachedThreshold={0.3}
        />
        {replyTo ? (
          <Row style={{ backgroundColor: theme.chatFootBg, paddingHorizontal: 12, paddingVertical: 6 }}>
            <AppText size={12} muted numberOfLines={1} style={{ flex: 1 }}>Replying to: {previewOf(replyTo, '')}</AppText>
            <TouchableOpacity onPress={() => setReplyTo(null)}><Ionicons name="close" size={20} color={theme.text} /></TouchableOpacity>
          </Row>
        ) : null}
        <Row style={{ backgroundColor: theme.chatFootBg, paddingHorizontal: 8, paddingVertical: 6 }}>
          <TouchableOpacity onPress={attach} disabled={uploading} style={{ padding: 8 }}>
            {uploading ? <ActivityIndicator color={theme.link} /> : <Ionicons name="attach" size={26} color={theme.link} />}
          </TouchableOpacity>
          <Input value={text} onChangeText={onChange} placeholder="Message..." multiline style={{ flex: 1, marginBottom: 0, maxHeight: 120, borderRadius: 20 }} />
          <TouchableOpacity onPress={send} disabled={!text.trim()} style={{ padding: 8, opacity: text.trim() ? 1 : 0.4 }}>
            <Ionicons name="send" size={24} color={theme.link} />
          </TouchableOpacity>
        </Row>
      </KeyboardAvoidingView>

      {/* Message action & reaction overlay */}
      <Modal visible={!!selectedMessage} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable onPress={closeMenu} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '85%', maxWidth: 340, backgroundColor: theme.card || '#232323', borderRadius: 20, padding: 16, elevation: 10 }}>
            {/* Quick reaction row */}
            <Row style={{ justifyContent: 'space-around', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: theme.border || '#333', marginBottom: 10 }}>
              {POPULAR_REACTS.map((r) => {
                const isSelected = selectedMessage?.reacts && selectedMessage.reacts[uid]?.type === r.code;
                return (
                  <TouchableOpacity
                    key={r.code}
                    activeOpacity={0.6}
                    onPress={() => {
                      toggleReact(selectedMessage, r.code);
                      closeMenu();
                    }}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 21,
                      backgroundColor: isSelected ? (theme.link + '33') : (theme.bg || '#1a1a1a'),
                      borderWidth: isSelected ? 2 : 1,
                      borderColor: isSelected ? theme.link : (theme.border || '#444'),
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <AppText size={22}>{r.emoji}</AppText>
                  </TouchableOpacity>
                );
              })}
            </Row>

            {/* Actions list */}
            {(selectedMessage?.data || selectedMessage?.filename) ? (
              <TouchableOpacity onPress={copySelectedText} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                <Ionicons name="copy-outline" size={20} color={theme.text} style={{ marginRight: 12 }} />
                <AppText size={15} style={{ color: theme.text }}>Copy Text</AppText>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity onPress={replySelected} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
              <Ionicons name="arrow-undo-outline" size={20} color={theme.link} style={{ marginRight: 12 }} />
              <AppText size={15} style={{ color: theme.link }}>Reply</AppText>
            </TouchableOpacity>

            {selectedMessage?.send_from === uid && !selectedMessage?.removed ? (
              <TouchableOpacity onPress={deleteSelected} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                <Ionicons name="trash-outline" size={20} color="#ff6c61" style={{ marginRight: 12 }} />
                <AppText size={15} style={{ color: "#ff6c61" }}>Delete Message</AppText>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity onPress={closeMenu} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: theme.border || '#333' }}>
              <Ionicons name="close-circle-outline" size={20} color={theme.textMuted || '#888'} style={{ marginRight: 12 }} />
              <AppText size={15} muted>Close</AppText>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
