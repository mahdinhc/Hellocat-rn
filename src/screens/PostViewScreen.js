import React, { useEffect, useState, useMemo } from 'react';
import { FlatList, View, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { remove, set, serverTimestamp } from 'firebase/database';
import { safeRef, safeOnValue, str, isValidKey } from '../safe';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Avatar, Row, Input, Loading, Empty } from '../components/ui';
import { useUser } from '../services/users';
import { userDisplayName, timeAgo, formatNumber } from '../utils';
import { PostCard, RichText } from './PostComponents';
import * as PostsDB from '../services/posts';

function CommentRow({ c, pid, indent, onReply, onDelete, canModerate, navigation }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const author = useUser(c.author);
  const reacts = c.reacts || {};
  const hasReacted = !!(uid && reacts[uid]);
  const reactCount = Object.keys(reacts).length;

  const toggleReact = () => {
    if (!uid || !c.key) return;
    const r = safeRef('post_comments', pid, c.key, 'reacts', uid);
    if (!r) return;
    if (hasReacted) remove(r).catch(() => {}); else set(r, serverTimestamp()).catch(() => {});
  };

  return (
    <View style={{ marginLeft: indent ? 40 : 0, paddingHorizontal: 14, paddingVertical: 8 }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <TouchableOpacity onPress={() => navigation.navigate('Profile', { uid: c.author })}><Avatar user={author} size={indent ? 28 : 34} /></TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10, backgroundColor: theme.cardBg, borderRadius: 12, padding: 10 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText bold size={13}>{userDisplayName(author)}</AppText>
            <AppText size={11} muted>{timeAgo(c.ts)}</AppText>
          </Row>
          <RichText text={c.content} size={14} style={{ color: theme.cardText, marginTop: 2 }} />
          <Row style={{ marginTop: 8, alignItems: 'center' }}>
            <TouchableOpacity onPress={toggleReact} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
              <Ionicons name={hasReacted ? 'heart' : 'heart-outline'} size={16} color={hasReacted ? '#e5484d' : theme.cardText} />
              {reactCount > 0 ? <AppText size={12} style={{ marginLeft: 4, color: theme.cardText }}>{formatNumber(reactCount)}</AppText> : null}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onReply(c)}><AppText size={12} style={{ color: theme.link }}>Reply</AppText></TouchableOpacity>
            {c.author === uid || canModerate ? <TouchableOpacity onPress={() => onDelete(c)} style={{ marginLeft: 16 }}><AppText size={12} style={{ color: '#e5484d' }}>Delete</AppText></TouchableOpacity> : null}
          </Row>
        </View>
      </Row>
    </View>
  );
}

export default function PostViewScreen({ route, navigation }) {
  const { id } = route.params;
  const { uid } = useAuth();
  const { theme } = useTheme();
  const [post, setPost] = useState(undefined);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    PostsDB.getPost(id).then((p) => setPost(p ? { ...p, id } : null)).catch(() => setPost(null));
    PostsDB.addView(id);
    PostsDB.isAdmin().then(setAdmin);
  }, [id]);

  useEffect(() => {
    const r = safeRef('post_comments', id);
    if (!r) return undefined;
    return safeOnValue(r, (s) => {
      const list = [];
      s.forEach((c) => {
        const v = c.val();
        if (!v || typeof v !== 'object') return;
        list.push({
          key: c.key,
          author: str(v.author),
          content: str(v.content),
          ts: typeof v.ts === 'number' ? v.ts : 0,
          reply_of: isValidKey(v.reply_of) ? v.reply_of : null,
          reacts: v.reacts && typeof v.reacts === 'object' ? v.reacts : {},
        });
      });
      setComments(list);
    });
  }, [id]);

  const ordered = useMemo(() => {
    const tops = comments.filter((c) => !c.reply_of || !comments.find((x) => x.key === c.reply_of)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const out = [];
    tops.forEach((t) => {
      out.push({ ...t, indent: false });
      comments.filter((c) => c.reply_of === t.key).sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach((r) => out.push({ ...r, indent: true }));
    });
    return out;
  }, [comments]);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    const r = replyTo ? (replyTo.reply_of || replyTo.key) : null;
    setReplyTo(null);
    try { await PostsDB.addComment(id, t, r); } catch (e) { Alert.alert('Could not comment', e.message); }
  };

  const delComment = (c) => Alert.alert('Delete comment?', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => PostsDB.deleteComment(id, c.key).catch((e) => Alert.alert('Could not delete', e.message)) },
  ]);

  const delPost = () => Alert.alert('Delete post?', 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await PostsDB.deletePost(id, post); navigation.goBack(); } catch (e) { Alert.alert('Could not delete', e.message); }
    } },
  ]);

  useEffect(() => {
    if (post && (post.uid === uid || admin)) {
      navigation.setOptions({ headerRight: () => <TouchableOpacity onPress={delPost}><Ionicons name="trash-outline" size={22} color={theme.primaryText} /></TouchableOpacity> });
    }
  }, [post, uid, admin, navigation, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  if (post === undefined) return <Loading />;
  if (post === null || (post.visibility === 'private' && post.uid !== uid && !admin)) return <Empty text="This post is not available." />;

  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <FlatList
          data={ordered}
          keyExtractor={(c) => c.key}
          ListHeaderComponent={<PostCard post={post} navigation={navigation} detail />}
          renderItem={({ item }) => <CommentRow c={item} pid={id} indent={item.indent} onReply={setReplyTo} onDelete={delComment} canModerate={admin} navigation={navigation} />}
          ListEmptyComponent={<AppText muted style={{ textAlign: 'center', padding: 24 }}>No comments yet.</AppText>}
          keyboardShouldPersistTaps="handled"
        />
        {replyTo ? (
          <Row style={{ backgroundColor: theme.navBg, paddingHorizontal: 12, paddingVertical: 6 }}>
            <AppText size={12} muted numberOfLines={1} style={{ flex: 1 }}>Replying to: {replyTo.content}</AppText>
            <TouchableOpacity onPress={() => setReplyTo(null)}><Ionicons name="close" size={20} color={theme.text} /></TouchableOpacity>
          </Row>
        ) : null}
        <Row style={{ backgroundColor: theme.navBg, padding: 8 }}>
          <Input value={text} onChangeText={setText} placeholder="Write a comment..." multiline style={{ flex: 1, marginBottom: 0, maxHeight: 110, borderRadius: 20 }} />
          <TouchableOpacity onPress={submit} disabled={!text.trim()} style={{ padding: 8, opacity: text.trim() ? 1 : 0.4 }}>
            <Ionicons name="send" size={24} color={theme.link} />
          </TouchableOpacity>
        </Row>
      </KeyboardAvoidingView>
    </Screen>
  );
}
