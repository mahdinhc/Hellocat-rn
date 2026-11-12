import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  FlatList,
  View,
  TouchableOpacity,
  Image,
  Linking,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  Animated,
  PanResponder,
} from 'react-native';
import Svg, { Path as SvgPath } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { query, limitToLast } from 'firebase/database';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Avatar, Row, Input, Loading } from '../components/ui';
import { useUser } from '../services/users';
import {
  getOrCreateChat,
  sendTextMessage,
  sendFileMessage,
  removeMessage,
  markSeen,
  setTyping,
  uploadChatFile,
  reactToMessage,
  unreactMessage,
  saveMessageDoodle,
  deleteMessageDoodle,
} from '../services/chat';
import { userDisplayName, formatClock, isImageType, bytesToLabel } from '../utils';
import { previewOf } from './ChatsScreen';
import ErrorBoundary from '../components/ErrorBoundary';
import { safeRef, safeOnValue, normalizeMessage, isValidKey } from '../safe';
import { setActiveChat } from '../services/notifications';
import { callManager } from '../services/call';
import { cacheChatMessages, getCachedChatMessages } from '../services/offlineStorage';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHellocatString } from '../services/hellocatString';

const PAGE = 40;



const DEFAULT_REACTS = [
  { code: 'u2764', emoji: '❤️' },
  { code: 'u1f602', emoji: '😂' },
  { code: 'u1f62e', emoji: '😮' },
  { code: 'u1f622', emoji: '😢' },
  { code: 'u1f44d', emoji: '👍' },
  { code: 'u1f525', emoji: '🔥' },
];

const EMOJI_PICKER_TABS = [
  {
    title: 'Popular',
    icon: 'star-outline',
    emojis: ['❤️', '😂', '😮', '😢', '👍', '🔥', '👏', '🙏', '😍', '🎉', '💔', '💯'],
  },
  {
    title: 'Smileys',
    icon: 'happy-outline',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐'],
  },
  {
    title: 'Demon & Dark',
    icon: 'skull-outline',
    emojis: ['😈', '👿', '💀', '☠️', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '🩸', '🗡️', '⚔️', '🖤', '🔥', '💣', '🦇', '🕷️', '🕸️', '🦂', '🧟'],
  },
  {
    title: 'Cat',
    icon: 'paw-outline',
    emojis: ['😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🐱', '🐈', '🐈‍⬛', '🐾'],
  },
  {
    title: 'Gestures',
    icon: 'hand-left-outline',
    emojis: ['👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✌️', '🤟', '🤘', '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤙', '💪', '🖕'],
  },
  {
    title: 'Hearts',
    icon: 'heart-outline',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌', '💋', '🥰'],
  },
];

function emojiToCode(emoji) {
  try {
    const cp = emoji.codePointAt(0);
    return 'u' + cp.toString(16);
  } catch (e) {
    return emoji;
  }
}



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

function Bubble({ m, mine, replied, onLongPress, onToggleReact, onReply, currentUid, theme }) {
  const panX = useRef(new Animated.Value(0)).current;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          // Horizontal swipe with minimal vertical movement
          return Math.abs(gestureState.dx) > 15 && Math.abs(gestureState.dy) < 15;
        },
        onPanResponderMove: (_, gestureState) => {
          // Allow swiping right (or slight left)
          if (gestureState.dx > 0) {
            panX.setValue(Math.min(gestureState.dx, 70));
          } else {
            panX.setValue(Math.max(gestureState.dx, -30));
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx > 40) {
            if (onReply && !m.removed) onReply(m);
          }
          Animated.spring(panX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(panX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [m, onReply, panX]
  );

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
    body = (
      <AppText style={{ color: fg }}>
        {renderHellocatString(m.data, {
          linkStyle: { color: mine ? '#fff' : theme.link, textDecorationLine: 'underline' },
          hashtagStyle: { color: mine ? '#fff' : theme.link, fontWeight: 'bold' },
          userStyle: { color: mine ? '#fff' : theme.link, fontWeight: 'bold' },
          boldStyle: { fontWeight: 'bold', color: fg },
          italicStyle: { fontStyle: 'italic', color: fg },
          underlineStyle: { textDecorationLine: 'underline', color: fg },
          strikeStyle: { textDecorationLine: 'line-through', color: fg },
          textColor: fg,
        })}
      </AppText>
    );
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
    <View style={{ marginVertical: 2, paddingHorizontal: 10 }}>
      {/* Slide to reply animated container */}
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          transform: [{ translateX: panX }],
          alignItems: mine ? 'flex-end' : 'flex-start',
        }}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          onLongPress={() => onLongPress(m)}
          style={{
            maxWidth: '82%',
            backgroundColor: bg,
            borderRadius: 16,
            paddingHorizontal: 12,
            paddingVertical: 8,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {replied ? (
            <View style={{ borderLeftWidth: 3, borderLeftColor: fg, opacity: 0.7, paddingLeft: 8, marginBottom: 6 }}>
              <AppText size={12} numberOfLines={2} style={{ color: fg }}>{previewOf(replied, '')}</AppText>
            </View>
          ) : null}
          {body}

          {/* Message Doodle overlay if present */}
          {m.doodle && m.doodle.url ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 10,
              }}
            >
              <Image
                source={{ uri: m.doodle.url }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
              />
            </View>
          ) : null}

          <Row style={{ justifyContent: 'flex-end', marginTop: 3 }}>
            {m.doodle && m.doodle.url ? (
              <Ionicons name="brush-outline" size={11} color={fg} style={{ opacity: 0.8, marginRight: 4 }} />
            ) : null}
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
      </Animated.View>
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
  const [activeReacts, setActiveReacts] = useState(DEFAULT_REACTS);
  const [customizerVisible, setCustomizerVisible] = useState(false);
  const [pickerTab, setPickerTab] = useState(0);
  const typingTimer = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem('@hellocat_custom_reactions').then((val) => {
      if (val) {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed) && parsed.length > 0) setActiveReacts(parsed);
        } catch (e) {}
      }
    }).catch(() => {});
  }, []);

  const selectReactionSet = (rSet) => {
    setActiveReacts(rSet.reacts);
    AsyncStorage.setItem('@hellocat_custom_reactions', JSON.stringify(rSet.reacts)).catch(() => {});
    setCustomizerVisible(false);
  };

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

  // Doodle state
  const [doodleModalVisible, setDoodleModalVisible] = useState(false);
  const [doodleTargetMessage, setDoodleTargetMessage] = useState(null);
  const [doodlePaths, setDoodlePaths] = useState([]);
  const [currentDoodlePath, setCurrentDoodlePath] = useState(null);
  const [doodleColor, setDoodleColor] = useState('#ff4444');
  const [doodleStrokeWidth, setDoodleStrokeWidth] = useState(4);

  const startDoodleForSelected = () => {
    if (!selectedMessage) return;
    setDoodleTargetMessage(selectedMessage);
    setDoodlePaths([]);
    setCurrentDoodlePath(null);
    closeMenu();
    setDoodleModalVisible(true);
  };

  const removeDoodleForSelected = () => {
    if (!selectedMessage || !cid) return;
    deleteMessageDoodle(cid, selectedMessage.key)
      .then(() => Alert.alert('Success', 'Doodle removed.'))
      .catch((e) => Alert.alert('Error', (e && e.message) || 'Could not remove doodle'));
    closeMenu();
  };

  const handleDoodleSave = async () => {
    if (!doodleTargetMessage || !cid) return;
    if (doodlePaths.length === 0) {
      setDoodleModalVisible(false);
      return;
    }
    try {
      // Build pure SVG string
      const pathElements = doodlePaths.map((p) => {
        if (!p.points || p.points.length < 2) return '';
        const d = 'M ' + p.points.map((pt) => pt.x.toFixed(1) + ' ' + pt.y.toFixed(1)).join(' L ');
        return `<path d="${d}" stroke="${p.color}" stroke-width="${p.width}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
      }).join('');
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="240" viewBox="0 0 300 240">${pathElements}</svg>`;
      const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;

      await saveMessageDoodle(cid, doodleTargetMessage.key, dataUrl, { top: 0, left: 0, width: 300, height: 240 });
      setDoodleModalVisible(false);
      setDoodleTargetMessage(null);
    } catch (e) {
      Alert.alert('Error', (e && e.message) || 'Failed to save doodle');
    }
  };

  // Direct paste image / GIF support
  const pasteImageFromClipboard = async () => {
    try {
      const hasImg = await Clipboard.hasImageAsync();
      if (!hasImg) {
        // Also check if clipboard has an image/gif URL
        const textInClip = await Clipboard.getStringAsync();
        if (textInClip && /^https?:\/\/.*\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(textInClip.trim())) {
          await sendAsset({ uri: textInClip.trim(), fileName: `image_${Date.now()}.gif` }, 'image/gif');
          return;
        }
        Alert.alert('Clipboard', 'No image found in clipboard. Copy an image or image URL first!');
        return;
      }
      const img = await Clipboard.getImageAsync({ format: 'png' });
      if (img && img.data) {
        const dataUri = img.data.startsWith('data:') ? img.data : `data:image/png;base64,${img.data}`;
        await sendAsset({ uri: dataUri, fileName: `clipboard_${Date.now()}.png` }, 'image/png');
      }
    } catch (e) {
      Alert.alert('Paste Error', (e && e.message) || 'Could not paste image');
    }
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
                onReply={(msg) => setReplyTo(msg)}
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
        <Row style={{ backgroundColor: theme.chatFootBg, paddingHorizontal: 8, paddingVertical: 6, alignItems: 'center' }}>
          <TouchableOpacity onPress={attach} disabled={uploading} style={{ padding: 6 }}>
            {uploading ? <ActivityIndicator color={theme.link} /> : <Ionicons name="attach" size={26} color={theme.link} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={pasteImageFromClipboard} disabled={uploading} style={{ padding: 6 }} accessibilityLabel="Paste Image or GIF">
            <Ionicons name="clipboard-outline" size={22} color={theme.link} />
          </TouchableOpacity>
          <Input value={text} onChangeText={onChange} placeholder="Message..." multiline style={{ flex: 1, marginBottom: 0, maxHeight: 120, borderRadius: 20 }} />
          <TouchableOpacity onPress={send} disabled={!text.trim()} style={{ padding: 8, opacity: text.trim() ? 1 : 0.4 }}>
            <Ionicons name="send" size={24} color={theme.link} />
          </TouchableOpacity>
        </Row>
      </KeyboardAvoidingView>

      {/* Message action & reaction overlay (Messenger / WhatsApp style floating pill) */}
      <Modal visible={!!selectedMessage} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable onPress={closeMenu} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 330, alignItems: 'center' }}>
            
            {/* WhatsApp / Messenger style Floating Reaction Bubble */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: theme.card || '#262628',
                borderRadius: 30,
                paddingHorizontal: 8,
                paddingVertical: 6,
                marginBottom: 12,
                elevation: 12,
                shadowColor: '#000',
                shadowOpacity: 0.35,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                width: '100%',
              }}
            >
              {activeReacts.slice(0, 5).map((r) => {
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
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: isSelected ? (theme.link + '33') : 'transparent',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <AppText size={24}>{r.emoji}</AppText>
                  </TouchableOpacity>
                );
              })}
              {/* '+' button to open WhatsApp style emoji sheet */}
              <TouchableOpacity
                activeOpacity={0.6}
                onPress={() => {
                  setCustomizerVisible(true);
                }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: theme.dark ? '#333' : '#e5e7eb',
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginLeft: 4,
                }}
              >
                <Ionicons name="add" size={22} color={theme.text} />
              </TouchableOpacity>
            </View>

            {/* Context menu actions */}
            <View style={{ width: '100%', backgroundColor: theme.card || '#262628', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 16, elevation: 8 }}>
              {(selectedMessage?.data || selectedMessage?.filename) ? (
                <TouchableOpacity onPress={copySelectedText} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                  <Ionicons name="copy-outline" size={20} color={theme.text} style={{ marginRight: 14 }} />
                  <AppText size={15} style={{ color: theme.text }}>Copy</AppText>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity onPress={replySelected} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                <Ionicons name="arrow-undo-outline" size={20} color={theme.link} style={{ marginRight: 14 }} />
                <AppText size={15} style={{ color: theme.link }}>Reply</AppText>
              </TouchableOpacity>

              {/* Doodle trigger */}
              <TouchableOpacity onPress={startDoodleForSelected} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                <Ionicons name="brush-outline" size={20} color="#f59e0b" style={{ marginRight: 14 }} />
                <AppText size={15} style={{ color: '#f59e0b' }}>Doodle on Message</AppText>
              </TouchableOpacity>

              {/* Delete doodle if present */}
              {selectedMessage?.doodle && (selectedMessage?.send_from === uid || !mine) ? (
                <TouchableOpacity onPress={removeDoodleForSelected} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                  <Ionicons name="color-wand-outline" size={20} color="#ff6c61" style={{ marginRight: 14 }} />
                  <AppText size={15} style={{ color: '#ff6c61' }}>Delete Doodle</AppText>
                </TouchableOpacity>
              ) : null}

              {selectedMessage?.send_from === uid && !selectedMessage?.removed ? (
                <TouchableOpacity onPress={deleteSelected} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                  <Ionicons name="trash-outline" size={20} color="#ff6c61" style={{ marginRight: 14 }} />
                  <AppText size={15} style={{ color: "#ff6c61" }}>Delete</AppText>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity onPress={closeMenu} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.border || '#38383a' }}>
                <Ionicons name="close-circle-outline" size={20} color={theme.textMuted || '#888'} style={{ marginRight: 14 }} />
                <AppText size={15} muted>Close</AppText>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* WhatsApp / Messenger Full Emoji Picker & Customizer Sheet */}
      <Modal visible={customizerVisible} transparent animationType="slide" onRequestClose={() => setCustomizerVisible(false)}>
        <Pressable onPress={() => setCustomizerVisible(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', height: '62%', backgroundColor: theme.card || '#1f1f23', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 12, elevation: 20 }}>
            {/* Grab handle */}
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#666', alignSelf: 'center', marginBottom: 12 }} />

            {/* Header with Title and Close */}
            <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <AppText bold size={17}>React to Message</AppText>
              <TouchableOpacity onPress={() => setCustomizerVisible(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </Row>

            {/* Category Tabs (WhatsApp / Messenger Style) */}
            <Row style={{ borderBottomWidth: 1, borderBottomColor: theme.border || '#333', paddingBottom: 8, marginBottom: 12, justifyContent: 'space-around' }}>
              {EMOJI_PICKER_TABS.map((tab, idx) => (
                <TouchableOpacity
                  key={tab.title}
                  onPress={() => setPickerTab(idx)}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 16,
                    backgroundColor: pickerTab === idx ? (theme.link + '26') : 'transparent',
                  }}
                >
                  <Ionicons name={tab.icon} size={20} color={pickerTab === idx ? theme.link : (theme.textMuted || '#888')} />
                </TouchableOpacity>
              ))}
            </Row>

            {/* Emoji Grid */}
            <FlatList
              data={EMOJI_PICKER_TABS[pickerTab]?.emojis || []}
              keyExtractor={(em, i) => em + i}
              numColumns={6}
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item: emoji }) => (
                <TouchableOpacity
                  activeOpacity={0.6}
                  onPress={() => {
                    const code = emojiToCode(emoji);
                    toggleReact(selectedMessage, code);
                    // Also update activeReacts so user's favorites bar gets this emoji
                    setActiveReacts((prev) => {
                      const filtered = prev.filter((p) => p.code !== code);
                      const updated = [{ code, emoji }, ...filtered].slice(0, 5);
                      AsyncStorage.setItem('@hellocat_custom_reactions', JSON.stringify(updated)).catch(() => {});
                      return updated;
                    });
                    setCustomizerVisible(false);
                    closeMenu();
                  }}
                  style={{
                    flex: 1 / 6,
                    aspectRatio: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginVertical: 4,
                  }}
                >
                  <AppText size={28}>{emoji}</AppText>
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Message Doodle Canvas Modal */}
      <Modal visible={doodleModalVisible} transparent animationType="slide" onRequestClose={() => setDoodleModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ width: '100%', maxWidth: 360, backgroundColor: theme.card || '#1f1f23', borderRadius: 20, overflow: 'hidden', elevation: 16 }}>
            {/* Doodle Header */}
            <Row style={{ paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.border || '#333' }}>
              <AppText bold size={16}>Doodle on Message</AppText>
              <TouchableOpacity onPress={() => setDoodleModalVisible(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </Row>

            {/* Colors & Brush Size Selector */}
            <Row style={{ paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.dark ? '#18181b' : '#f4f4f5' }}>
              <Row style={{ gap: 8 }}>
                {['#ff4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ffffff'].map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setDoodleColor(c)}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: c,
                      borderWidth: doodleColor === c ? 3 : 1,
                      borderColor: doodleColor === c ? '#fff' : '#666',
                    }}
                  />
                ))}
              </Row>
              <Row style={{ gap: 6 }}>
                {[3, 6, 12].map((s) => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => setDoodleStrokeWidth(s)}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 12,
                      backgroundColor: doodleStrokeWidth === s ? theme.link : 'transparent',
                    }}
                  >
                    <AppText size={12} style={{ color: doodleStrokeWidth === s ? '#fff' : theme.text }}>
                      {s}px
                    </AppText>
                  </TouchableOpacity>
                ))}
              </Row>
            </Row>

            {/* Interactive Drawing Pad */}
            <View
              style={{
                width: '100%',
                height: 240,
                backgroundColor: theme.dark ? '#111' : '#f9f9f9',
                position: 'relative',
              }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(evt) => {
                const { locationX, locationY } = evt.nativeEvent;
                const newPath = {
                  color: doodleColor,
                  width: doodleStrokeWidth,
                  points: [{ x: locationX, y: locationY }],
                };
                setCurrentDoodlePath(newPath);
              }}
              onResponderMove={(evt) => {
                const { locationX, locationY } = evt.nativeEvent;
                if (!currentDoodlePath) return;
                const updatedPoints = [...currentDoodlePath.points, { x: locationX, y: locationY }];
                setCurrentDoodlePath({ ...currentDoodlePath, points: updatedPoints });
              }}
              onResponderRelease={() => {
                if (currentDoodlePath) {
                  setDoodlePaths((prev) => [...prev, currentDoodlePath]);
                  setCurrentDoodlePath(null);
                }
              }}
            >
              <Svg style={{ width: '100%', height: '100%' }}>
                {doodlePaths.map((p, idx) => {
                  if (!p.points || p.points.length < 2) return null;
                  const d = 'M ' + p.points.map((pt) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' L ');
                  return (
                    <SvgPath
                      key={idx}
                      d={d}
                      stroke={p.color}
                      strokeWidth={p.width}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                })}
                {currentDoodlePath && currentDoodlePath.points.length > 1 ? (
                  <SvgPath
                    d={'M ' + currentDoodlePath.points.map((pt) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' L ')}
                    stroke={currentDoodlePath.color}
                    strokeWidth={currentDoodlePath.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
              </Svg>
            </View>

            {/* Footer Buttons: Undo, Clear, Save */}
            <Row style={{ paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: theme.border || '#333' }}>
              <Row style={{ gap: 12 }}>
                <TouchableOpacity
                  onPress={() => setDoodlePaths((prev) => prev.slice(0, -1))}
                  disabled={doodlePaths.length === 0}
                  style={{ opacity: doodlePaths.length > 0 ? 1 : 0.4 }}
                >
                  <Ionicons name="arrow-undo" size={22} color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setDoodlePaths([])}
                  disabled={doodlePaths.length === 0}
                  style={{ opacity: doodlePaths.length > 0 ? 1 : 0.4 }}
                >
                  <Ionicons name="trash-outline" size={22} color="#ff6c61" />
                </TouchableOpacity>
              </Row>
              <Row style={{ gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setDoodleModalVisible(false)}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: theme.dark ? '#333' : '#e5e7eb' }}
                >
                  <AppText size={14}>Cancel</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDoodleSave}
                  style={{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: 16, backgroundColor: theme.link }}
                >
                  <AppText bold size={14} style={{ color: '#fff' }}>Apply</AppText>
                </TouchableOpacity>
              </Row>
            </Row>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
