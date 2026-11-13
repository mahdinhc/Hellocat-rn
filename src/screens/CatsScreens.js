import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { FlatList, TouchableOpacity, View, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Row, Button, Loading, Empty } from '../components/ui';
import { formatNumber } from '../utils';
import * as PostsDB from '../services/posts';
import PostFeed, { Chips } from './PostFeed';
import { RichText } from './PostComponents';
import { CatIcon, CatBanner, SearchBar } from './CatWidgets';

export function CatsScreen({ navigation }) {
  const { theme } = useTheme();
  const [cats, setCats] = useState(null);
  const [search, setSearch] = useState('');
  useEffect(() => { PostsDB.listCats(100).then(setCats).catch(() => setCats([])); }, []);
  const q = search.trim().toLowerCase();
  const shown = useMemo(() => (cats || []).filter((c) => !q || `${c.slug} ${c.title || ''} ${c.description || ''}`.toLowerCase().includes(q)), [cats, q]);
  if (!cats) return <Loading />;
  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <FlatList
        data={shown}
        keyExtractor={(c) => c.slug}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<SearchBar value={search} onChangeText={setSearch} placeholder="Search cats" />}
        ListEmptyComponent={<Empty text={q ? 'No cats match your search.' : 'No cats yet.'} />}
        contentContainerStyle={{ paddingVertical: 6, paddingBottom: 30 }}
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.8} onPress={() => navigation.navigate('Cat', { slug: item.slug })}
            style={{ backgroundColor: theme.cardBg, borderRadius: 14, marginHorizontal: 12, marginVertical: 5, overflow: 'hidden' }}>
            <CatBanner cat={item} height={56} />
            <View style={{ padding: 12, paddingTop: 0 }}>
              <Row style={{ alignItems: 'flex-end', marginTop: -22 }}>
                <CatIcon cat={item} size={52} style={{ borderWidth: 3, borderColor: theme.cardBg }} />
                <View style={{ flex: 1, marginLeft: 10, paddingBottom: 2 }}>
                  <AppText bold size={16} numberOfLines={1} style={{ color: theme.cardText }}>{item.title || item.slug}</AppText>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.cardText} style={{ opacity: 0.5, marginBottom: 6 }} />
              </Row>
              <AppText size={12} muted style={{ marginTop: 4 }}>cat/{item.slug} · {formatNumber(item.member_count || 0)} members · {formatNumber(item.post_count || 0)} posts</AppText>
              {item.description ? <AppText size={13} numberOfLines={2} style={{ marginTop: 6, color: theme.cardText }}>{item.description}</AppText> : null}
            </View>
          </TouchableOpacity>
        )}
      />
    </Screen>
  );
}

export function CatScreen({ route, navigation }) {
  const { slug } = route.params;
  const { uid } = useAuth();
  const { theme } = useTheme();
  const [cat, setCat] = useState(undefined);
  const [member, setMember] = useState(false);
  const [banned, setBanned] = useState(false);
  const [sort, setSort] = useState('new');
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const src = useMemo(() => ({ mode: 'cat', cat: slug, sort }), [slug, sort]);

  const loadCat = useCallback(() => { PostsDB.getCat(slug).then(setCat).catch(() => setCat(null)); }, [slug]);
  useEffect(() => {
    loadCat();
    PostsDB.isMember(slug).then(setMember);
    PostsDB.isBanned(slug).then(setBanned);
  }, [slug, loadCat]);
  useEffect(() => { navigation.setOptions({ title: 'cat/' + slug }); }, [slug, navigation]);

  const toggleMember = async () => {
    try {
      if (member) await PostsDB.leaveCat(slug); else await PostsDB.joinCat(slug);
      setMember(!member);
      loadCat();
    } catch (e) { Alert.alert('Could not update', e.message); }
  };

  if (cat === undefined) return <Loading />;
  if (cat === null) return <Empty text="This cat does not exist." />;
  const full = { slug, ...cat };

  const header = (
    <View>
      <View style={{ backgroundColor: theme.cardBg, paddingBottom: 12 }}>
        <CatBanner cat={full} height={130} />
        <View style={{ paddingHorizontal: 14 }}>
          <Row style={{ alignItems: 'flex-end', marginTop: -32 }}>
            <CatIcon cat={full} size={72} style={{ borderWidth: 4, borderColor: theme.cardBg }} />
            <View style={{ flex: 1 }} />
            {uid && !banned ? (
              <Row>
                {member ? <Button small title="Post" onPress={() => navigation.navigate('CreatePost', { cat: slug, onDone: () => setReloadKey((k) => k + 1) })} style={{ marginRight: 8 }} /> : null}
                <Button small title={member ? 'Joined' : 'Join'} secondary={member} onPress={toggleMember} />
              </Row>
            ) : null}
          </Row>
          <AppText bold size={21} style={{ marginTop: 8, color: theme.cardText }}>{cat.title || slug}</AppText>
          <AppText size={12} muted>cat/{slug} · {formatNumber(cat.member_count || 0)} members · {formatNumber(cat.post_count || 0)} posts</AppText>
          {cat.description ? <RichText text={cat.description} size={14} style={{ color: theme.cardText, marginTop: 8 }} /> : null}
          {cat.rules ? (
            <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: theme.dark ? '#ffffff0d' : '#0000000a' }}>
              <AppText bold size={12} style={{ color: theme.cardText }}>Rules</AppText>
              <AppText size={12} style={{ color: theme.cardText, marginTop: 2 }}>{cat.rules}</AppText>
            </View>
          ) : null}
          {banned ? <AppText size={12} style={{ color: '#e5484d', marginTop: 8 }}>You are banned from this cat.</AppText> : null}
        </View>
      </View>
      <SearchBar value={search} onChangeText={setSearch} placeholder={`Search in cat/${slug}`} />
      <Chips options={[['new', 'New'], ['top', 'Top']]} value={sort} onChange={setSort} />
    </View>
  );

  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <PostFeed src={src} navigation={navigation} header={header} filter={search} reloadKey={reloadKey} emptyText="No posts in this cat yet." bottomPad={30} />
    </Screen>
  );
}
