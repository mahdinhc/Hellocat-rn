import React, { useEffect, useState, useMemo } from 'react';
import { FlatList, View, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { ref, onValue, push, remove, runTransaction, serverTimestamp } from 'firebase/database';
import { firestore, db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Avatar, Row, Input, Loading, Empty } from '../components/ui';
import { useUser } from '../services/users';
import { userDisplayName, timeAgo } from '../utils';
import { BlogCard, RichText } from './BlogComponents';

function CommentRow({ c, indent, onReply, onDelete, navigation }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const author = useUser(c.author);
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
          <Row style={{ marginTop: 6 }}>
            <TouchableOpacity onPress={() => onReply(c)}><AppText size={12} style={{ color: theme.link }}>Reply</AppText></TouchableOpacity>
            {c.author === uid ? <TouchableOpacity onPress={() => onDelete(c)} style={{ marginLeft: 16 }}><AppText size={12} style={{ color: '#e5484d' }}>Delete</AppText></TouchableOpacity> : null}
          </Row>
        </View>
      </Row>
    </View>
  );
}

export default function BlogViewScreen({ route, navigation }) {
  const { id } = route.params;
  const { uid } = useAuth();
  const { theme } = useTheme();
  const [post, setPost] = useState(undefined);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);

  useEffect(() => {
    getDoc(doc(firestore, 'blogs', id)).then((d) => setPost(d.exists() ? { id: d.id, ...d.data() } : null)).catch(() => setPost(null));
    runTransaction(ref(db, `blogs/${id}/views`), (v) => (v || 0) + 1).catch(() => {});
  }, [id]);

  useEffect(() => onValue(ref(db, `blogs/${id}/comments`), (s) => {
    const list = [];
    s.forEach((c) => { const v = c.val(); list.push({ key: c.key, author: v.author, content: v.content, ts: v.ts, reply_of: v.reply_of || null }); });
    setComments(list);
  }), [id]);

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
    const r = replyTo ? (replyTo.reply_of || replyTo.key) : null; // replies stay one level deep
    setReplyTo(null);
    try {
      await push(ref(db, `blogs/${id}/comments`), { author: uid, content: t, ts: serverTimestamp(), reply_of: r });
    } catch (e) { Alert.alert('Could not comment', e.message); }
  };

  const delComment = (c) => Alert.alert('Delete comment?', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => remove(ref(db, `blogs/${id}/comments/${c.key}`)) },
  ]);

  const delPost = () => Alert.alert('Delete post?', 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await deleteDoc(doc(firestore, 'blogs', id)); await remove(ref(db, 'blogs/' + id)); navigation.goBack(); }
      catch (e) { Alert.alert('Could not delete', e.message); }
    } },
  ]);

  useEffect(() => {
    if (post && post.uid === uid) {
      navigation.setOptions({ headerRight: () => <TouchableOpacity onPress={delPost}><Ionicons name="trash-outline" size={22} color={theme.primaryText} /></TouchableOpacity> });
    }
  }, [post, uid, navigation, theme]);

  if (post === undefined) return <Loading />;
  if (post === null) return <Empty text="This post is not available." />;

  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <FlatList
          data={ordered}
          keyExtractor={(c) => c.key}
          ListHeaderComponent={<BlogCard post={post} navigation={navigation} detail />}
          renderItem={({ item }) => <CommentRow c={item} indent={item.indent} onReply={setReplyTo} onDelete={delComment} navigation={navigation} />}
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
