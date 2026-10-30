import React, { useEffect, useState } from 'react';
import { View, Image, TouchableOpacity, Linking, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ref, set, remove, serverTimestamp } from 'firebase/database';
import { db } from '../firebase';
import { safeRef, safeOnValue, safeUri, isValidKey } from '../safe';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { AppText, Avatar, Row, Card } from '../components/ui';
import { useUser } from '../services/users';
import { userDisplayName, timeAgo, formatNumber } from '../utils';

// Renders text with clickable links and coloured #hashtags
export function RichText({ text, style, size }) {
  const { theme } = useTheme();
  const parts = String(text || '').split(/(https?:\/\/[^\s]+|#[\p{L}\p{N}_-]+)/gu);
  return (
    <AppText size={size} style={style}>
      {parts.map((p, i) => {
        if (/^https?:\/\//.test(p)) return <Text key={i} style={{ color: theme.link, textDecorationLine: 'underline' }} onPress={() => { Linking.openURL(p).catch(() => {}); }}>{p}</Text>;
        if (p.startsWith('#') && p.length > 1) return <Text key={i} style={{ color: theme.link }}>{p}</Text>;
        return <Text key={i}>{p}</Text>;
      })}
    </AppText>
  );
}

export function Attachments({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <View style={{ marginTop: 8 }}>
      {items.map((a, i) => {
        if (a && safeUri(a.src) && typeof a.type === 'string' && a.type.startsWith('image')) {
          return <Image key={i} source={{ uri: safeUri(a.src) }} style={{ width: '100%', height: 220, borderRadius: 8, marginBottom: 6 }} resizeMode="cover" />;
        }
        return (
          <TouchableOpacity key={i} onPress={() => { if (a && safeUri(a.src)) Linking.openURL(a.src).catch(() => {}); }} style={{ paddingVertical: 6 }}>
            <Row><Ionicons name="attach" size={18} color="#888" /><AppText muted style={{ marginLeft: 4, textDecorationLine: 'underline' }}>{(a && a.name) || 'Attachment'} ({(a && a.type) || 'file'})</AppText></Row>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function useBlogMeta(id) {
  const [meta, setMeta] = useState({ likes: 0, comments: 0, views: 0, mine: false });
  const { uid } = useAuth();
  useEffect(() => {
    const r = safeRef('blogs', id);
    if (!r) return undefined;
    return safeOnValue(r, (s) => {
    const reacts = s.child('reacts');
    setMeta({
      likes: reacts.numChildren(),
      comments: s.child('comments').numChildren(),
      views: Number(s.child('views').val()) || 0,
      mine: !!uid && reacts.child(uid).exists(),
    });
    });
  }, [id, uid]);
  return meta;
}

export function toggleLike(id, uid, liked) {
  if (!uid || !isValidKey(id)) return Promise.resolve();
  const r = safeRef('blogs', id, 'reacts', uid);
  if (!r) return Promise.resolve();
  return liked ? remove(r) : set(r, serverTimestamp());
}

export function BlogCard({ post, navigation, showAuthor = true, detail = false }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const author = useUser(post.uid);
  const meta = useBlogMeta(post.id);
  const ts = post.server_ts && post.server_ts.toMillis ? post.server_ts.toMillis() : null;
  const open = () => { if (!detail) navigation.navigate('BlogView', { id: post.id }); };
  return (
    <Card style={{ padding: 14 }}>
      {showAuthor ? (
        <TouchableOpacity onPress={() => navigation.navigate('Profile', { uid: post.uid })}>
          <Row style={{ marginBottom: 10 }}>
            <Avatar user={author} size={38} />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <AppText bold numberOfLines={1}>{userDisplayName(author)}</AppText>
              <AppText size={11} muted>{timeAgo(ts)}{post.visibility && post.visibility !== 'public' ? ' · ' + post.visibility : ''}</AppText>
            </View>
          </Row>
        </TouchableOpacity>
      ) : <AppText size={11} muted style={{ marginBottom: 6 }}>{timeAgo(ts)}{post.visibility && post.visibility !== 'public' ? ' · ' + post.visibility : ''}</AppText>}
      <TouchableOpacity activeOpacity={0.85} onPress={open}>
        <RichText text={post.caption} style={{ color: theme.cardText }} />
        <Attachments items={post.attachments} />
      </TouchableOpacity>
      <Row style={{ marginTop: 12 }}>
        <TouchableOpacity onPress={() => toggleLike(post.id, uid, meta.mine)} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 22 }}>
          <Ionicons name={meta.mine ? 'heart' : 'heart-outline'} size={22} color={meta.mine ? '#e5484d' : theme.cardText} />
          <AppText size={13} style={{ marginLeft: 5, color: theme.cardText }}>{formatNumber(meta.likes)}</AppText>
        </TouchableOpacity>
        <TouchableOpacity onPress={open} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 22 }}>
          <Ionicons name="chatbubble-outline" size={20} color={theme.cardText} />
          <AppText size={13} style={{ marginLeft: 5, color: theme.cardText }}>{formatNumber(meta.comments)}</AppText>
        </TouchableOpacity>
        <Row><Ionicons name="eye-outline" size={20} color={theme.cardText} /><AppText size={13} style={{ marginLeft: 5, color: theme.cardText }}>{formatNumber(meta.views)}</AppText></Row>
      </Row>
    </Card>
  );
}
