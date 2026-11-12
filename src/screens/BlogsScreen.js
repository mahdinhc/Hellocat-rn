import React, { useEffect, useState, useCallback, useRef } from 'react';
import { FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, orderBy, limit, startAfter, getDocs } from 'firebase/firestore';
import { ref, get, set } from 'firebase/database';
import { firestore, db } from '../firebase';
import { useTheme } from '../theme/ThemeContext';
import { Screen, Empty, Loading } from '../components/ui';
import { BlogCard } from './BlogComponents';
import { cacheBlogPosts, getCachedBlogPosts } from '../services/offlineStorage';

const PAGE = 10;

function incrementBlogViews(blogId) {
  if (!blogId) return;
  const vRef = ref(db, `blogs/${blogId}/views`);
  get(vRef).then((snap) => {
    if (snap.exists()) {
      set(vRef, (Number(snap.val()) || 0) + 1).catch(() => {});
    } else {
      set(vRef, 1).catch(() => {});
    }
  }).catch(() => {});
}

export default function BlogsScreen({ navigation }) {
  const { theme } = useTheme();
  const [posts, setPosts] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const last = useRef(null);
  const busy = useRef(false);

  const load = useCallback(async (reset) => {
    if (busy.current) return;
    busy.current = true;
    try {
      let q = query(collection(firestore, 'blogs'), where('visibility', '==', 'public'), orderBy('server_ts', 'desc'), limit(PAGE));
      if (!reset && last.current) q = query(collection(firestore, 'blogs'), where('visibility', '==', 'public'), orderBy('server_ts', 'desc'), startAfter(last.current), limit(PAGE));
      const snap = await getDocs(q);
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      items.forEach((item) => incrementBlogViews(item.id));
      if (snap.docs.length) last.current = snap.docs[snap.docs.length - 1];
      setHasMore(snap.docs.length >= PAGE);
      setPosts((prev) => {
        const next = reset || !prev ? items : [...prev, ...items];
        cacheBlogPosts(next);
        return next;
      });
    } catch (e) {
      if (reset) {
        const cached = await getCachedBlogPosts();
        if (cached && cached.length) {
          setPosts(cached);
          busy.current = false;
          return;
        }
      }
      setPosts((prev) => prev || []);
      setHasMore(false);
    }
    busy.current = false;
  }, []);

  useEffect(() => {
    getCachedBlogPosts().then((cached) => {
      if (cached && cached.length) setPosts((curr) => (!curr || !curr.length ? cached : curr));
    }).catch(() => {});
    load(true);
  }, [load]);
  useEffect(() => navigation.addListener('focus', () => { /* keep list, counters are live */ }), [navigation]);

  const refresh = async () => { setRefreshing(true); last.current = null; setHasMore(true); await load(true); setRefreshing(false); };
  const more = async () => { if (!hasMore || loadingMore || busy.current) return; setLoadingMore(true); await load(false); setLoadingMore(false); };

  if (!posts) return <Loading />;
  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <BlogCard post={item} navigation={navigation} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.link} />}
        onEndReached={more}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<Empty text="No posts yet. Be the first to write one!" />}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.link} style={{ margin: 16 }} /> : null}
        contentContainerStyle={{ paddingVertical: 6, paddingBottom: 90 }}
      />
      <TouchableOpacity
        onPress={() => navigation.navigate('CreatePost', { onDone: refresh })}
        style={{ position: 'absolute', right: 18, bottom: 22, width: 56, height: 56, borderRadius: 28, backgroundColor: theme.buttonBg, alignItems: 'center', justifyContent: 'center', elevation: 5 }}
      >
        <Ionicons name="add" size={30} color={theme.buttonText} />
      </TouchableOpacity>
    </Screen>
  );
}
