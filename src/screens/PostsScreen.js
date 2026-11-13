import React, { useState, useMemo, useEffect } from 'react';
import { TouchableOpacity, View, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText } from '../components/ui';
import PostFeed from './PostFeed';
import { SearchBar, CatIcon, SortMenu } from './CatWidgets';
import * as PostsDB from '../services/posts';

function CatsStrip({ navigation }) {
  const { theme } = useTheme();
  const [cats, setCats] = useState([]);
  useEffect(() => navigation.addListener('focus', () => { PostsDB.myCats().then(setCats).catch(() => {}); }), [navigation]);
  const Item = ({ onPress, children, label }) => (
    <TouchableOpacity onPress={onPress} style={{ alignItems: 'center', width: 68, marginRight: 6 }}>
      {children}
      <AppText size={11} numberOfLines={1} style={{ marginTop: 4, color: theme.text }}>{label}</AppText>
    </TouchableOpacity>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}>
      <Item label="Explore" onPress={() => navigation.navigate('Cats')}>
        <View style={{ width: 48, height: 48, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.link, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="compass-outline" size={24} color={theme.link} /></View>
      </Item>
      <Item label="Saved" onPress={() => navigation.navigate('Saved')}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: theme.cardBg, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="bookmark" size={22} color={theme.link} /></View>
      </Item>
      {cats.map((c) => (
        <Item key={c.slug} label={c.title || c.slug} onPress={() => navigation.navigate('Cat', { slug: c.slug })}><CatIcon cat={c} size={48} /></Item>
      ))}
    </ScrollView>
  );
}

export default function PostsScreen({ navigation }) {
  const { theme } = useTheme();
  const [sort, setSort] = useState('new');
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const src = useMemo(() => ({ mode: 'all', sort }), [sort]);

  const header = (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search posts" style={{ flex: 1, marginRight: 8 }} />
        <SortMenu value={sort} onChange={setSort} />
      </View>
      <CatsStrip navigation={navigation} />
    </View>
  );

  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <PostFeed src={src} navigation={navigation} header={header} filter={search} reloadKey={reloadKey} emptyText="No posts yet. Be the first to write one!" />
      <TouchableOpacity
        onPress={() => navigation.navigate('CreatePost', { onDone: () => setReloadKey((k) => k + 1) })}
        style={{ position: 'absolute', right: 18, bottom: 22, width: 56, height: 56, borderRadius: 28, backgroundColor: theme.buttonBg, alignItems: 'center', justifyContent: 'center', elevation: 5 }}
      >
        <Ionicons name="add" size={30} color={theme.buttonText} />
      </TouchableOpacity>
    </Screen>
  );
}

export function SavedScreen({ navigation }) {
  const { theme } = useTheme();
  const [search, setSearch] = useState('');
  const src = useMemo(() => ({ mode: 'saved' }), []);
  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <PostFeed src={src} navigation={navigation} header={<SearchBar value={search} onChangeText={setSearch} placeholder="Search saved posts" />} filter={search} emptyText="Nothing saved yet." bottomPad={30} />
    </Screen>
  );
}
