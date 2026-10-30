import React, { useEffect, useState } from 'react';
import { ScrollView, View, TouchableOpacity, Alert, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { sendPasswordResetEmail } from 'firebase/auth';
import { ref, update, get, query, limitToLast, orderByChild } from 'firebase/database';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db, firestore, APP_VERSION } from '../firebase';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { THEMES } from '../theme/themes';
import { Screen, AppText, Avatar, Row, Button, Input, Loading, Empty } from '../components/ui';
import { uploadLocalFile } from '../services/chat';
import { invalidateUser } from '../services/users';
import { validateName, formatDateTime } from '../utils';

export function SettingsScreen({ navigation }) {
  const { signOut } = useAuth();
  const { theme } = useTheme();
  const Item = ({ icon, label, to, onPress }) => (
    <TouchableOpacity onPress={onPress || (() => navigation.navigate(to))}>
      <Row style={{ paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.dark ? '#ffffff15' : '#00000010' }}>
        <Ionicons name={icon} size={22} color={theme.link} />
        <AppText style={{ marginLeft: 14, flex: 1 }}>{label}</AppText>
        <Ionicons name="chevron-forward" size={18} color={theme.text} style={{ opacity: 0.4 }} />
      </Row>
    </TouchableOpacity>
  );
  return (
    <Screen>
      <Item icon="person-outline" label="Profile" to="SettingsProfile" />
      <Item icon="key-outline" label="Account" to="SettingsAccount" />
      <Item icon="color-palette-outline" label="Theme" to="SettingsTheme" />
      <Item icon="time-outline" label="Login history" to="SettingsHistory" />
      <Item icon="log-out-outline" label="Sign out" onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }])} />
      <AppText size={12} muted style={{ textAlign: 'center', marginTop: 24 }}>{APP_VERSION}</AppText>
    </Screen>
  );
}

export function SettingsProfileScreen({ navigation }) {
  const { uid, profile, refreshProfile } = useAuth();
  const n = (profile && profile.name) || ['', ''];
  const [first, setFirst] = useState(n[0] || '');
  const [last, setLast] = useState(n[1] || '');
  const [bio, setBio] = useState((profile && profile.bio) || '');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0]);
  };

  const save = async () => {
    if (!validateName(first.trim())) return Alert.alert('Name', 'First name is required (max 18 characters, no special symbols).');
    if (last.trim() && !validateName(last.trim())) return Alert.alert('Name', 'Last name is invalid.');
    if (bio.trim().length <= 3) return Alert.alert('Bio', 'Bio must be longer than 3 characters.');
    setBusy(true);
    try {
      const patch = { name: [first.trim(), last.trim()], bio: bio.trim() };
      if (photo) {
        const url = await uploadLocalFile(`users/${uid}/profile.png`, photo.uri, photo.mimeType || 'image/png');
        patch.profile_picture = url;
      }
      await update(ref(db, 'users/' + uid), patch);
      await updateDoc(doc(firestore, 'users', uid), patch).catch(() => {});
      invalidateUser(uid);
      await refreshProfile();
      navigation.goBack();
    } catch (e) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };

  const preview = { ...(profile || {}), profile_picture: photo ? photo.uri : profile && profile.profile_picture, name: [first, last] };
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={pickPhoto} style={{ alignItems: 'center', marginBottom: 18 }}>
          <Avatar user={preview} size={96} />
          <AppText size={13} style={{ marginTop: 6 }} muted>Tap to change photo</AppText>
        </TouchableOpacity>
        <Input placeholder="First name" value={first} onChangeText={setFirst} maxLength={18} autoCapitalize="words" />
        <Input placeholder="Last name" value={last} onChangeText={setLast} maxLength={18} autoCapitalize="words" />
        <Input placeholder="Bio" value={bio} onChangeText={setBio} multiline style={{ minHeight: 90, textAlignVertical: 'top' }} autoCapitalize="sentences" />
        <Button title="Save" onPress={save} loading={busy} />
      </ScrollView>
    </Screen>
  );
}

export function SettingsAccountScreen() {
  const { user, profile } = useAuth();
  const reset = async () => {
    try { await sendPasswordResetEmail(auth, user.email); Alert.alert('Password reset', 'We sent a reset link to ' + user.email); }
    catch (e) { Alert.alert('Error', e.message); }
  };
  const Field = ({ label, value }) => (
    <View style={{ marginBottom: 16 }}><AppText size={12} muted>{label}</AppText><AppText selectable>{value || '-'}</AppText></View>
  );
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18 }}>
        <Field label="Email" value={user && user.email} />
        <Field label="Username" value={profile && profile.username ? '@' + profile.username : ''} />
        <Field label="User ID" value={user && user.uid} />
        <Field label="Email verified" value={user && user.emailVerified ? 'Yes' : 'No'} />
        <Button title="Send password reset email" secondary onPress={reset} />
      </ScrollView>
    </Screen>
  );
}

export function SettingsThemeScreen() {
  const { uid } = useAuth();
  const { theme, themeId, applyTheme } = useTheme();
  const choose = (id) => {
    applyTheme(id);
    update(ref(db, 'users/' + uid), { theme: id }).catch(() => {});
  };
  const ids = Object.keys(THEMES);
  return (
    <Screen>
      <FlatList
        data={ids}
        keyExtractor={(i) => i}
        renderItem={({ item }) => {
          const t = THEMES[item];
          return (
            <TouchableOpacity onPress={() => choose(item)}>
              <Row style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
                <View style={{ flexDirection: 'row', marginRight: 14 }}>
                  {[t.primary, t.bg, t.sendBg].map((c, i) => <View key={i} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, marginLeft: i ? -8 : 0, borderWidth: 1, borderColor: '#8885' }} />)}
                </View>
                <AppText style={{ flex: 1 }} bold={item === themeId}>{t.name}</AppText>
                {item === themeId ? <Ionicons name="checkmark-circle" size={22} color={theme.link} /> : null}
              </Row>
            </TouchableOpacity>
          );
        }}
      />
    </Screen>
  );
}

export function SettingsHistoryScreen() {
  const { uid } = useAuth();
  const [items, setItems] = useState(null);
  useEffect(() => {
    get(query(ref(db, `history/${uid}/login`), orderByChild('timestamp'), limitToLast(30))).then((s) => {
      const l = [];
      s.forEach((c) => { l.push({ key: c.key, ...c.val() }); });
      setItems(l.reverse());
    }).catch(() => setItems([]));
  }, [uid]);
  if (!items) return <Loading />;
  if (!items.length) return <Empty text="No login history." />;
  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 18, paddingVertical: 10 }}>
            <AppText bold>{item.type === 'USER-SIGNUP' ? 'Signed up' : 'Signed in'}</AppText>
            <AppText size={12} muted>{formatDateTime(item.timestamp)}</AppText>
            <AppText size={12} muted numberOfLines={1}>{item.ua}</AppText>
            {item.location && item.location.city ? <AppText size={12} muted>{[item.location.city, item.location.country].filter(Boolean).join(', ')}</AppText> : null}
          </View>
        )}
      />
    </Screen>
  );
}
