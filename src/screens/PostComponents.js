import React, { useState, useEffect } from 'react';
import { View, Image, TouchableOpacity, Linking, Text, Dimensions, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { safeUri } from '../safe';
import * as PostsDB from '../services/posts';
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


const RED = '#e5484d';

function ReactionControl({ post }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const pid = post.id;
  const isVote = post.type === 'vote';
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(post.like_count || 0);
  const [v, setV] = useState(0);
  const [score, setScore] = useState(post.score || 0);
  useEffect(() => {
    let alive = true;
    if (isVote) PostsDB.myVote(pid).then((x) => alive && setV(x)); else PostsDB.myLike(pid).then((x) => alive && setLiked(x));
    return () => { alive = false; };
  }, [pid, isVote, uid]);
  if (isVote) {
    const go = (dir) => { if (!uid) return; PostsDB.vote(pid, dir).then((r) => { setV(r.vote); setScore(r.score); }).catch(() => {}); };
    return (
      <Row style={{ alignItems: 'center', marginRight: 18 }}>
        <TouchableOpacity onPress={() => go(1)} style={{ padding: 4 }}><Ionicons name="arrow-up" size={22} color={v === 1 ? '#ff6a1a' : theme.cardText} /></TouchableOpacity>
        <AppText size={13} style={{ minWidth: 22, textAlign: 'center', color: v === 1 ? '#ff6a1a' : v === -1 ? '#5d8ffc' : theme.cardText }}>{formatNumber(score)}</AppText>
        <TouchableOpacity onPress={() => go(-1)} style={{ padding: 4 }}><Ionicons name="arrow-down" size={22} color={v === -1 ? '#5d8ffc' : theme.cardText} /></TouchableOpacity>
      </Row>
    );
  }
  const go = () => { if (!uid) return; PostsDB.toggleLike(pid).then((r) => { setLiked(r.liked); setCount(r.count); }).catch(() => {}); };
  return (
    <TouchableOpacity onPress={go} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 22, paddingVertical: 4 }}>
      <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? RED : theme.cardText} />
      <AppText size={13} style={{ marginLeft: 6, color: liked ? RED : theme.cardText }}>{formatNumber(count)}</AppText>
    </TouchableOpacity>
  );
}

export function PostCard({ post: initial, navigation, showAuthor = true, detail = false, repostTs = null, onDeleted }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const [post, setPost] = useState(initial);
  useEffect(() => { setPost(initial); }, [initial]);
  const author = useUser(post.uid);
  const [reposted, setReposted] = useState(false);
  const [repostCount, setRepostCount] = useState(post.repost_count || 0);
  const [saved, setSaved] = useState(false);
  const canRepost = post.visibility === 'public' && post.uid !== uid;

  useEffect(() => {
    let alive = true;
    if (uid) {
      PostsDB.mySave(post.id).then((x) => alive && setSaved(x));
      if (canRepost) PostsDB.myRepost(post.id).then((x) => alive && setReposted(x));
    }
    return () => { alive = false; };
  }, [post.id, uid, canRepost]);

  const open = () => { if (!detail) navigation.navigate('PostView', { id: post.id }); };
  const sub = `${timeAgo(post.ts)}${post.visibility && post.visibility !== 'public' ? ' · ' + post.visibility : ''}`;
  return (
    <Card style={{ padding: 14 }}>
      {repostTs ? <AppText size={11} muted style={{ marginBottom: 6 }}>Reposted · {timeAgo(repostTs)}</AppText> : null}
      {post.pinned ? <AppText size={11} muted style={{ marginBottom: 6 }}>Pinned</AppText> : null}
      {showAuthor ? (
        <TouchableOpacity onPress={() => navigation.navigate('Profile', { uid: post.uid })}>
          <Row style={{ marginBottom: 10 }}>
            <Avatar user={author} size={38} />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <AppText bold numberOfLines={1}>{userDisplayName(author)}</AppText>
              <AppText size={11} muted>{sub}</AppText>
            </View>
          </Row>
        </TouchableOpacity>
      ) : <AppText size={11} muted style={{ marginBottom: 6 }}>{sub}</AppText>}
      {post.cat ? (
        <TouchableOpacity onPress={() => navigation.navigate('Cat', { slug: post.cat })}>
          <AppText size={12} style={{ color: theme.link, marginBottom: 6 }}>cat/{post.cat}</AppText>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity activeOpacity={0.85} onPress={open}>
        <RichText text={post.caption} style={{ color: theme.cardText }} />
        <Attachments items={Array.isArray(post.attachments) ? post.attachments : PostsDB_toArray(post.attachments)} />
      </TouchableOpacity>
      <Row style={{ marginTop: 12, alignItems: 'center' }}>
        <ReactionControl post={post} />
        <TouchableOpacity onPress={open} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 22, paddingVertical: 4 }}>
          <Ionicons name="chatbubble-outline" size={20} color={theme.cardText} />
          <AppText size={13} style={{ marginLeft: 6, color: theme.cardText }}>{formatNumber(post.comment_count || 0)}</AppText>
        </TouchableOpacity>
        {canRepost ? (
          <TouchableOpacity
            onPress={() => { if (!uid) return; PostsDB.toggleRepost(post.id).then((r) => { setReposted(r.reposted); setRepostCount(r.count); }).catch(() => {}); }}
            style={{ flexDirection: 'row', alignItems: 'center', marginRight: 22, paddingVertical: 4 }}
          >
            <Ionicons name="repeat" size={22} color={reposted ? '#2ea043' : theme.cardText} />
            <AppText size={13} style={{ marginLeft: 4, color: reposted ? '#2ea043' : theme.cardText }}>{formatNumber(repostCount)}</AppText>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => { if (!uid) return; PostsDB.toggleSave(post.id).then(setSaved).catch(() => {}); }}
          style={{ marginRight: 22, paddingVertical: 4 }}
        >
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={20} color={saved ? theme.link : theme.cardText} />
        </TouchableOpacity>
        <Row style={{ alignItems: 'center', paddingVertical: 4 }}>
          <Ionicons name="eye-outline" size={20} color={theme.cardText} style={{ opacity: 0.7 }} />
          <AppText size={13} muted style={{ marginLeft: 6 }}>{formatNumber(post.views || 0)}</AppText>
        </Row>
      </Row>
    </Card>
  );
}

function PostsDB_toArray(v) {
  if (!v || typeof v !== 'object') return [];
  return Object.keys(v).sort((a, b) => a - b).map((k) => v[k]).filter(Boolean);
}
