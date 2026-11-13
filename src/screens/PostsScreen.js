import React, { useState, useMemo } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { Screen } from '../components/ui';
import PostFeed, { Chips } from './PostFeed';

export default function PostsScreen({ navigation }) {
  const { theme } = useTheme();
  const [mode, setMode] = useState('all');
  const [sort, setSort] = useState('new');
  const [reloadKey, setReloadKey] = useState(0);
  const src = useMemo(() => ({ mode, sort }), [mode, sort]);

  const header = (
    <View>
      <Chips options={[['all', 'All'], ['mine', 'My cats']]} value={mode} onChange={setMode} />
      {mode === 'all' ? <Chips options={[['new', 'New'], ['top', 'Top']]} value={sort} onChange={setSort} /> : null}
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 6 }}>
        <TouchableOpacity onPress={() => navigation.navigate('Cats')} style={{ marginRight: 18 }}><Ionicons name="paw-outline" size={22} color={theme.link} /></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Saved')}><Ionicons name="bookmark-outline" size={22} color={theme.link} /></TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <PostFeed src={src} navigation={navigation} header={header} reloadKey={reloadKey} emptyText={mode === 'mine' ? 'Join a cat to see its posts here.' : 'No posts yet. Be the first to write one!'} />
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
  const src = useMemo(() => ({ mode: 'saved' }), []);
  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <PostFeed src={src} navigation={navigation} emptyText="Nothing saved yet." bottomPad={30} />
    </Screen>
  );
}
