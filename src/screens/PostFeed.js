import React, { useEffect, useState, useCallback, useRef } from 'react';
import { FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Empty, AppText } from '../components/ui';
import { PostCard } from './PostComponents';
import * as PostsDB from '../services/posts';
import { cachePosts, getCachedPosts } from '../services/offlineStorage';

const PAGE = 10;

// Paged feed over PostsDB.page(src). Pass a new `src` object (memoized) to reload.
export default function PostFeed({ src, navigation, header, emptyText = 'No posts yet.', showAuthor = true, bottomPad = 90, reloadKey = 0 }) {
  const { theme } = useTheme();
  const [items, setItems] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursor = useRef(null);
  const done = useRef(false);
  const busy = useRef(false);
  const gen = useRef(0);
  const cacheable = src.mode === 'all' && src.sort !== 'top';

  const load = useCallback(async (reset) => {
    if (busy.current) return;
    if (!reset && done.current) return;
    busy.current = true;
    const g = gen.current;
    try {
      const p = await PostsDB.page(src, reset ? null : cursor.current, PAGE);
      if (g !== gen.current) { busy.current = false; return; }
      cursor.current = p.cursor;
      done.current = p.done;
      setItems((prev) => {
        const next = reset || !prev ? p.items : [...prev, ...p.items.filter((n) => !prev.find((o) => o.id === n.id))];
        if (cacheable) cachePosts(next);
        return next;
      });
    } catch (e) {
      if (g === gen.current) {
        if (reset && cacheable) {
          const cached = await getCachedPosts();
          if (cached && cached.length) { setItems(cached); busy.current = false; return; }
        }
        setItems((prev) => prev || []);
        done.current = true;
      }
    }
    busy.current = false;
  }, [src, cacheable]);

  useEffect(() => {
    gen.current += 1;
    busy.current = false;
    cursor.current = null;
    done.current = false;
    setItems(null);
    if (cacheable) getCachedPosts().then((c) => { if (c && c.length) setItems((cur) => cur || c); }).catch(() => {});
    load(true);
  }, [load, reloadKey, cacheable]);

  const refresh = async () => { setRefreshing(true); cursor.current = null; done.current = false; await load(true); setRefreshing(false); };
  const more = async () => { if (done.current || loadingMore || busy.current) return; setLoadingMore(true); await load(false); setLoadingMore(false); };

  return (
    <FlatList
      data={items || []}
      keyExtractor={(it) => it.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <PostCard post={{ ...item.data, id: item.id }} navigation={navigation} showAuthor={showAuthor} repostTs={item.extra && item.extra.repostTs} />
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.link} />}
      onEndReached={more}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={items ? <Empty text={emptyText} /> : <ActivityIndicator color={theme.link} style={{ margin: 30 }} />}
      ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.link} style={{ margin: 16 }} /> : null}
      contentContainerStyle={{ paddingVertical: 6, paddingBottom: bottomPad }}
    />
  );
}

export function Chips({ options, value, onChange }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8 }}>
      {options.map(([v, label]) => (
        <TouchableOpacity key={v} onPress={() => onChange(v)} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 18, marginRight: 8, backgroundColor: value === v ? theme.buttonBg : theme.inputBg }}>
          <AppText size={13} style={{ color: value === v ? theme.buttonText : theme.inputText }}>{label}</AppText>
        </TouchableOpacity>
      ))}
    </View>
  );
}
