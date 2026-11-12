import React, { useState, useEffect } from 'react';
import { View, Image, TouchableOpacity, Linking, Text, Dimensions, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ref, set, remove, serverTimestamp } from 'firebase/database';
import { db } from '../firebase';
import { safeRef, safeOnValue, safeUri, isValidKey } from '../safe';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { AppText, Avatar, Row, Card } from '../components/ui';
import { useUser } from '../services/users';
import { userDisplayName, timeAgo, formatNumber } from '../utils';
import { renderHellocatString } from '../services/hellocatString';

// Renders text with full Hellocat-String support (bold, italic, underline, strike, hashtags, links, mentions)
export function RichText({ text, style, size }) {
  const { theme } = useTheme();
  return (
    <AppText size={size} style={style}>
      {renderHellocatString(text, {
        linkStyle: { color: theme.link },
        hashtagStyle: { color: theme.link },
        userStyle: { color: theme.link },
        textColor: style?.color || theme.text,
      })}
    </AppText>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Multi-image Slide Scroll attachment viewer for media/posts
export function Attachments({ items }) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (!Array.isArray(items) || !items.length) return null;

  const images = items.filter((a) => a && safeUri(a.src) && typeof a.type === 'string' && a.type.startsWith('image'));
  const otherFiles = items.filter((a) => !(a && safeUri(a.src) && typeof a.type === 'string' && a.type.startsWith('image')));

  const cardWidth = Math.min(SCREEN_WIDTH - 56, 420);

  return (
    <View style={{ marginTop: 8 }}>
      {images.length > 0 ? (
        <View style={{ width: '100%', marginBottom: 6 }}>
          {images.length === 1 ? (
            <TouchableOpacity activeOpacity={0.9} onPress={() => Linking.openURL(safeUri(images[0].src)).catch(() => {})}>
              <Image source={{ uri: safeUri(images[0].src) }} style={{ width: '100%', height: 240, borderRadius: 10 }} resizeMode="cover" />
            </TouchableOpacity>
          ) : (
            <View>
              <FlatList
                data={images}
                keyExtractor={(_, i) => String(i)}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                snapToAlignment="center"
                decelerationRate="fast"
                onMomentumScrollEnd={(e) => {
                  const x = e.nativeEvent.contentOffset.x;
                  const idx = Math.round(x / cardWidth);
                  setActiveIndex(idx);
                }}
                renderItem={({ item }) => (
                  <TouchableOpacity activeOpacity={0.9} onPress={() => Linking.openURL(safeUri(item.src)).catch(() => {})} style={{ width: cardWidth, marginRight: 8 }}>
                    <Image source={{ uri: safeUri(item.src) }} style={{ width: '100%', height: 260, borderRadius: 10 }} resizeMode="cover" />
                  </TouchableOpacity>
                )}
              />
              {/* Pagination Dots */}
              <Row style={{ justifyContent: 'center', marginTop: 8 }}>
                {images.map((_, i) => (
                  <View
                    key={i}
                    style={{
                      width: i === activeIndex ? 16 : 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: i === activeIndex ? '#5d8ffc' : 'rgba(150,150,150,0.4)',
                      marginHorizontal: 3,
                    }}
                  />
                ))}
              </Row>
            </View>
          )}
        </View>
      ) : null}

      {otherFiles.map((a, i) => (
        <TouchableOpacity key={i} onPress={() => { if (a && safeUri(a.src)) Linking.openURL(a.src).catch(() => {}); }} style={{ paddingVertical: 6 }}>
          <Row>
            <Ionicons name="attach" size={18} color="#888" />
            <AppText muted style={{ marginLeft: 4, textDecorationLine: 'underline' }}>{(a && a.name) || 'Attachment'} ({(a && a.type) || 'file'})</AppText>
          </Row>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function useBlogMeta(id) {
  const [meta, setMeta] = useState({ likes: 0, comments: 0, views: 0, mine: false });
  const { uid } = useAuth();
  useEffect(() => {
    if (!id) return undefined;
    const r = safeRef('blogs', id);
    if (!r) return undefined;
    return safeOnValue(r, (s) => {
      const reacts = s.child('reacts');
      setMeta({
        likes: reacts.numChildren() || 0,
        comments: s.child('comments').numChildren() || 0,
        views: Number(s.child('views').val()) || 0,
        mine: !!uid && reacts.child(uid).exists(),
      });
    });
  }, [id, uid]);
  return meta;
}

export function toggleLike(id, uid, liked) {
  if (!uid || !id) return Promise.resolve();
  const r = safeRef('blogs', id, 'reacts', uid);
  if (!r) return Promise.resolve();
  return (liked ? remove(r) : set(r, serverTimestamp())).catch((err) => {
    console.warn('[toggleLike error]', err);
  });
}

export function BlogCard({ post, navigation, showAuthor = true, detail = false }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const author = useUser(post.uid);
  const meta = useBlogMeta(post.id);
  const [optimisticLiked, setOptimisticLiked] = useState(null);
  const [optimisticDelta, setOptimisticDelta] = useState(0);

  const isLiked = optimisticLiked !== null ? optimisticLiked : meta.mine;
  const likeCount = Math.max(0, meta.likes + optimisticDelta);

  // Sync back when meta updates
  useEffect(() => {
    setOptimisticLiked(null);
    setOptimisticDelta(0);
  }, [meta.mine, meta.likes]);

  const onToggleLike = () => {
    if (!uid) return;
    const nextState = !isLiked;
    setOptimisticLiked(nextState);
    setOptimisticDelta(nextState ? (meta.mine ? 0 : 1) : (meta.mine ? -1 : 0));
    toggleLike(post.id, uid, isLiked);
  };

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
      <Row style={{ marginTop: 12, alignItems: 'center' }}>
        <TouchableOpacity onPress={onToggleLike} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 22, paddingVertical: 4 }}>
          <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={22} color={isLiked ? '#e5484d' : theme.cardText} />
          <AppText size={13} style={{ marginLeft: 6, color: isLiked ? '#e5484d' : theme.cardText, fontWeight: isLiked ? '600' : '400' }}>
            {formatNumber(likeCount)}
          </AppText>
        </TouchableOpacity>
        <TouchableOpacity onPress={open} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 22, paddingVertical: 4 }}>
          <Ionicons name="chatbubble-outline" size={20} color={theme.cardText} />
          <AppText size={13} style={{ marginLeft: 6, color: theme.cardText }}>
            {formatNumber(meta.comments || 0)}
          </AppText>
        </TouchableOpacity>
        <Row style={{ alignItems: 'center', paddingVertical: 4 }}>
          <Ionicons name="eye-outline" size={20} color={theme.cardText} style={{ opacity: 0.7 }} />
          <AppText size={13} muted style={{ marginLeft: 6 }}>
            {formatNumber(meta.views || 0)}
          </AppText>
        </Row>
      </Row>
    </Card>
  );
}
