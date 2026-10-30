import React, { useState } from 'react';
import { ScrollView, View, Image, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { firestore } from '../firebase';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Screen, AppText, Button, Input, Row } from '../components/ui';
import { randomString } from '../utils';
import { uploadLocalFile } from '../services/chat';

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

export default function CreatePostScreen({ navigation, route }) {
  const { uid } = useAuth();
  const { theme } = useTheme();
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 4, quality: 0.8 });
    if (!res.canceled) setImages((prev) => [...prev, ...res.assets].slice(0, 4));
  };

  const publish = async () => {
    if (!caption.trim()) return Alert.alert('Write something', 'A post needs some text.');
    setBusy(true);
    try {
      const pid = randomString(8);
      await setDoc(doc(firestore, 'blogs', pid), { server_ts: serverTimestamp(), visibility, caption: caption.trim(), uid, attachments: [] });
      const attachments = [];
      for (let i = 0; i < images.length; i++) {
        try {
          const a = images[i];
          const type = a.mimeType || 'image/jpeg';
          const filename = `${randomString(16)}_${i}.${EXT[type] || 'jpg'}`;
          const src = await uploadLocalFile(`blogs/${uid}/${pid}/${filename}`, a.uri, type);
          attachments.push({ type, src, name: filename });
        } catch (e) { /* skip a failed upload, keep the rest */ }
      }
      if (attachments.length) await updateDoc(doc(firestore, 'blogs', pid), { attachments });
      if (route.params && route.params.onDone) route.params.onDone();
      navigation.goBack();
    } catch (e) {
      Alert.alert('Could not publish', e.message);
    }
    setBusy(false);
  };

  const Chip = ({ v, label }) => (
    <TouchableOpacity onPress={() => setVisibility(v)} style={{ paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20, marginRight: 8, backgroundColor: visibility === v ? theme.buttonBg : theme.inputBg }}>
      <AppText style={{ color: visibility === v ? theme.buttonText : theme.inputText }}>{label}</AppText>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Input placeholder="What's on your mind? Use #hashtags and links." value={caption} onChangeText={setCaption} multiline style={{ minHeight: 140, textAlignVertical: 'top' }} autoCapitalize="sentences" />
        <Row style={{ marginBottom: 14 }}><Chip v="public" label="Public" /><Chip v="private" label="Only me" /></Row>
        <Row style={{ flexWrap: 'wrap' }}>
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
