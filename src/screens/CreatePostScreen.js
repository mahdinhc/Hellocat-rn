import React, { useState, useEffect } from 'react';
import { ScrollView, View, Image, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Button, Input, Row } from '../components/ui';
import { randomString } from '../utils';
import { uploadLocalFile } from '../services/chat';
import * as PostsDB from '../services/posts';

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

export default function CreatePostScreen({ navigation, route }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const preset = (route.params && route.params.cat) || '';
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [type, setType] = useState('like');
  const [cat, setCat] = useState(preset);
  const [cats, setCats] = useState([]);
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { PostsDB.myCats().then(setCats).catch(() => {}); }, []);

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 4, quality: 0.8 });
    if (!res.canceled) setImages((prev) => [...prev, ...res.assets].slice(0, 4));
  };

  const publish = async () => {
    if (!caption.trim()) return Alert.alert('Write something', 'Your caption is empty.');
    setBusy(true);
    try {
      const pid = PostsDB.newPostId();
      const attachments = [];
      for (let i = 0; i < images.length; i++) {
        try {
          const a = images[i];
          const t = a.mimeType || 'image/jpeg';
          const filename = `${randomString(16)}_${i}.${EXT[t] || 'jpg'}`;
          const src = await uploadLocalFile(`posts/${uid}/${pid}/${filename}`, a.uri, t);
          attachments.push({ type: t, src, name: filename });
        } catch (e) { /* skip a failed upload, keep the rest */ }
      }
      await PostsDB.createPost({ pid, caption: caption.trim(), visibility, type, cat: cat || null, attachments });
      if (route.params && route.params.onDone) route.params.onDone();
      navigation.goBack();
    } catch (e) {
      Alert.alert('Could not publish', e.message);
    }
    setBusy(false);
  };

  const Chip = ({ active, onPress, label, disabled }) => (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={{ paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20, marginRight: 8, marginBottom: 8, opacity: disabled ? 0.4 : 1, backgroundColor: active ? theme.buttonBg : theme.inputBg }}>
      <AppText style={{ color: active ? theme.buttonText : theme.inputText }}>{label}</AppText>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Input placeholder="Write your caption here... Use #hashtags and links." value={caption} onChangeText={setCaption} multiline style={{ minHeight: 140, textAlignVertical: 'top' }} autoCapitalize="sentences" />
        <AppText size={12} muted style={{ marginBottom: 6 }}>Post to</AppText>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip active={!cat} label="My profile" onPress={() => setCat('')} />
          {cats.map((c) => <Chip key={c.slug} active={cat === c.slug} label={'cat/' + c.slug} onPress={() => setCat(c.slug)} />)}
        </Row>
        <AppText size={12} muted style={{ marginBottom: 6 }}>Visibility{cat ? ' (cat posts are always public)' : ''}</AppText>
        <Row style={{ flexWrap: 'wrap' }}>
          {['public', 'unlisted', 'private'].map((v) => <Chip key={v} disabled={!!cat} active={(cat ? 'public' : visibility) === v} label={v[0].toUpperCase() + v.slice(1)} onPress={() => setVisibility(v)} />)}
        </Row>
        <AppText size={12} muted style={{ marginBottom: 6 }}>Type</AppText>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip active={type === 'like'} label="Like (heart)" onPress={() => setType('like')} />
          <Chip active={type === 'vote'} label="Vote (up/down)" onPress={() => setType('vote')} />
        </Row>
        <Row style={{ flexWrap: 'wrap', marginTop: 6 }}>
          {images.map((a, i) => (
            <View key={i} style={{ marginRight: 8, marginBottom: 8 }}>
              <Image source={{ uri: a.uri }} style={{ width: 90, height: 90, borderRadius: 8 }} />
              <TouchableOpacity onPress={() => setImages((p) => p.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#000a', borderRadius: 10 }}>
                <Ionicons name="close" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          {images.length < 4 ? (
            <TouchableOpacity onPress={pick} style={{ width: 90, height: 90, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.link, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="image-outline" size={28} color={theme.link} />
            </TouchableOpacity>
          ) : null}
        </Row>
        <Button title="Publish" onPress={publish} loading={busy} style={{ marginTop: 16 }} />
      </ScrollView>
    </Screen>
  );
}
