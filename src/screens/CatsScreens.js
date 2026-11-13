import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { FlatList, TouchableOpacity, View, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Row, Button, Loading, Empty, Card } from '../components/ui';
import { formatNumber } from '../utils';
import * as PostsDB from '../services/posts';
import PostFeed, { Chips } from './PostFeed';
import { RichText } from './PostComponents';

export function CatsScreen({ navigation }) {
  const { theme } = useTheme();
  const [cats, setCats] = useState(null);
  useEffect(() => { PostsDB.listCats(50).then(setCats).catch(() => setCats([])); }, []);
  if (!cats) return <Loading />;
  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <FlatList
        data={cats}
        keyExtractor={(c) => c.slug}
        ListEmptyComponent={<Empty text="No cats yet." />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => navigation.navigate('Cat', { slug: item.slug })}>
            <Card style={{ padding: 14 }}>
              <AppText bold>{item.title || item.slug}</AppText>
              <AppText size={12} muted>cat/{item.slug} · {formatNumber(item.member_count || 0)} members · {formatNumber(item.post_count || 0)} posts</AppText>
              {item.description ? <AppText size={13} numberOfLines={2} style={{ marginTop: 4, color: theme.cardText }}>{item.description}</AppText> : null}
            </Card>
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
  const [reloadKey, setReloadKey] = useState(0);
  const src = useMemo(() => ({ mode: 'cat', cat: slug, sort }), [slug, sort]);

  const loadCat = useCallback(() => {
    PostsDB.getCat(slug).then((c) => setCat(c)).catch(() => setCat(null));
  }, [slug]);
  useEffect(() => {
    loadCat();
    PostsDB.isMember(slug).then(setMember);
    PostsDB.isBanned(slug).then(setBanned);
  }, [slug, loadCat]);
  useEffect(() => { if (cat) navigation.setOptions({ title: 'cat/' + slug }); }, [cat, slug, navigation]);

  const toggleMember = async () => {
    try {
      if (member) await PostsDB.leaveCat(slug); else await PostsDB.joinCat(slug);
      setMember(!member);
      loadCat();
    } catch (e) { Alert.alert('Could not update', e.message); }
  };

  if (cat === undefined) return <Loading />;
  if (cat === null) return <Empty text="This cat does not exist." />;

  const header = (
    <View style={{ padding: 14 }}>
      <AppText bold size={20}>{cat.title || slug}</AppText>
      <AppText size={12} muted>{formatNumber(cat.member_count || 0)} members · {formatNumber(cat.post_count || 0)} posts</AppText>
      {cat.description ? <RichText text={cat.description} style={{ color: theme.text, marginTop: 8 }} /> : null}
      {cat.rules ? <AppText size={12} muted style={{ marginTop: 8 }}>Rules: {cat.rules}</AppText> : null}
      <Row style={{ marginTop: 12 }}>
        {uid && !banned ? <Button small title={member ? 'Leave' : 'Join'} secondary={member} onPress={toggleMember} style={{ marginRight: 8 }} /> : null}
        {member && !banned ? <Button small title="Post" onPress={() => navigation.navigate('CreatePost', { cat: slug, onDone: () => setReloadKey((k) => k + 1) })} /> : null}
      </Row>
      {banned ? <AppText size={12} style={{ color: '#e5484d', marginTop: 8 }}>You are banned from this cat.</AppText> : null}
      <Chips options={[['new', 'New'], ['top', 'Top']]} value={sort} onChange={setSort} />
    </View>
  );

  return (
    <Screen style={{ backgroundColor: theme.feedBg }}>
      <PostFeed src={src} navigation={navigation} header={header} reloadKey={reloadKey} emptyText="No posts in this cat yet." bottomPad={30} />
    </Screen>
  );
}
