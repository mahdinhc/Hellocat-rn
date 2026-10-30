import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { FlatList, View, TouchableOpacity, Image, Linking, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { ref, onValue, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Avatar, Row, Input, Loading } from '../components/ui';
import { useUser } from '../services/users';
import { getOrCreateChat, sendTextMessage, sendFileMessage, removeMessage, markSeen, setTyping, uploadChatFile } from '../services/chat';
import { userDisplayName, formatClock, isImageType, bytesToLabel } from '../utils';
import { previewOf } from './ChatsScreen';

const PAGE = 40;

function Bubble({ m, mine, replied, onLongPress, theme }) {
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
        <TouchableOpacity onPress={() => Linking.openURL(m.url)}>
          <Image source={{ uri: m.url }} style={{ width: 220, height: 220, borderRadius: 8 }} resizeMode="cover" />
        </TouchableOpacity>
      );
    } else {
      body = (
        <TouchableOpacity onPress={() => m.url && Linking.openURL(m.url)}>
          <Row><Ionicons name="document-outline" size={22} color={fg} /><AppText style={{ color: fg, marginLeft: 6, textDecorationLine: 'underline' }}>{m.filename || 'file'}</AppText></Row>
        </TouchableOpacity>
      );
    }
  } else if (m.type === 'code') {
    body = <AppText style={{ color: fg, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 }}>{m.data}</AppText>;
  } else if (m.type === 'emoji') {
    body = <AppText size={(m.size || 40) / 2} style={{ color: fg }}>:{m.emoji}:</AppText>;
  } else {
    body = <AppText style={{ color: fg }}>{m.data}</AppText>;
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
    </View>
  );
}

export default function ChatScreen({ route, navigation }) {
  const { fid } = route.params;
  const { uid } = useAuth();
  const { theme } = useTheme();
  const friend = useUser(fid);
  const [cid, setCid] = useState(route.params.cid || null);
  const [limit, setLimit] = useState(PAGE);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [online, setOnline] = useState(false);
  const [friendTyping, setFriendTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const typingTimer = useRef(null);

  useEffect(() => { if (!cid) getOrCreateChat(uid, fid).then(setCid).catch((e) => Alert.alert('Error', e.message)); }, [cid, uid, fid]);

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
    });
  }, [navigation, friend, online, friendTyping, theme, fid]);

  useEffect(() => onValue(ref(db, 'status/' + fid + '/state'), (s) => setOnline(s.val() === 'online')), [fid]);

  useEffect(() => {
    if (!cid) return undefined;
    const q = query(ref(db, `chats_data/${cid}/messages`), orderByChild('timestamp'), limitToLast(limit));
    return onValue(q, (snap) => {
      const list = [];
      snap.forEach((c) => { list.push({ key: c.key, ...c.val() }); });
      list.sort((a, b) => (a.timestamp || Date.now()) - (b.timestamp || Date.now()));
      setMsgs(list);
    });
  }, [cid, limit]);

  useEffect(() => {
    if (!cid) return undefined;
    return onValue(ref(db, `chats_data/${cid}/typing/${fid}`), (s) => {
      const v = s.val();
      setFriendTyping(typeof v === 'number' && v > 0 && Date.now() - v < 8000);
    });
  }, [cid, fid]);

  // mark incoming messages as seen
  useEffect(() => {
    if (!cid || !msgs) return;
    msgs.forEach((m) => { if (m.send_to === uid && m.isSeenByReceiver === false) markSeen(cid, m.key); });
  }, [msgs, cid, uid]);

  useEffect(() => () => { if (cid) setTyping(cid, uid, false); clearTimeout(typingTimer.current); }, [cid, uid]);

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
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!res.canceled && res.assets && res.assets[0]) {
      const a = res.assets[0];
      await sendAsset({ ...a, fileName: a.fileName || `photo_${Date.now()}.jpg` }, a.mimeType || 'image/jpeg');
    }
  };

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (!res.canceled && res.assets && res.assets[0]) {
      const a = res.assets[0];
      if (a.size && a.size > 25 * 1024 * 1024) return Alert.alert('Too large', 'Files over 25 MB are not supported (' + bytesToLabel(a.size) + ').');
      await sendAsset({ ...a, fileName: a.name }, a.mimeType);
    }
  };

  const attach = () => Alert.alert('Attach', undefined, [
    { text: 'Photo', onPress: pickImage },
    { text: 'File', onPress: pickFile },
    { text: 'Cancel', style: 'cancel' },
  ]);

  const onLongPress = useCallback((m) => {
    const buttons = [{ text: 'Reply', onPress: () => setReplyTo(m) }];
    if (m.send_from === uid && !m.removed) buttons.push({ text: 'Delete', style: 'destructive', onPress: () => removeMessage(cid, m.key) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Message', undefined, buttons);
  }, [cid, uid]);

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
          renderItem={({ item }) => <Bubble m={item} mine={item.send_from === uid} replied={item.reply_of ? byKey[item.reply_of] : null} onLongPress={onLongPress} theme={theme} />}
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
    </Screen>
  );
}
