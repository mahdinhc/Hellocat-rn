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
import { Switch, Linking } from 'react-native';
import { getNotificationSettings, loadNotificationSettings, saveNotificationSettings, requestPermission, hasPermission, sendTestNotification, setupNotifications } from '../services/notifications';
import { uploadLocalFile } from '../services/chat';
import { invalidateUser } from '../services/users';
import { validateName, formatDateTime } from '../utils';
import { callRecorder } from '../services/callRecorder';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEV_MODE_KEY = 'hellocat_dev_mode_unlocked';

export function SettingsScreen({ navigation }) {
  const { signOut } = useAuth();
  const { theme } = useTheme();
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const tapTimeout = React.useRef(null);

  useEffect(() => {
    AsyncStorage.getItem(DEV_MODE_KEY).then((v) => {
      if (v === 'true') setDevUnlocked(true);
    }).catch(() => {});
  }, []);

  const onVersionPress = () => {
    clearTimeout(tapTimeout.current);
    const next = tapCount + 1;
    setTapCount(next);

    if (next >= 10) {
      setDevUnlocked(true);
      AsyncStorage.setItem(DEV_MODE_KEY, 'true').catch(() => {});
      Alert.alert('Developer options enabled', 'Developer options are now unlocked in Settings.');
      setTapCount(0);
    } else {
      tapTimeout.current = setTimeout(() => {
        setTapCount(0);
      }, 2500);
    }
  };

  const Item = ({ icon, label, to, onPress, badge }) => (
    <TouchableOpacity onPress={onPress || (() => navigation.navigate(to))}>
      <Row style={{ paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.dark ? '#ffffff15' : '#00000010' }}>
        <Ionicons name={icon} size={22} color={theme.link} />
        <AppText style={{ marginLeft: 14, flex: 1 }}>{label}</AppText>
        {badge ? <AppText size={11} style={{ marginRight: 8, color: '#eab308' }}>{badge}</AppText> : null}
        <Ionicons name="chevron-forward" size={18} color={theme.text} style={{ opacity: 0.4 }} />
      </Row>
    </TouchableOpacity>
  );
  return (
    <Screen>
      <Item icon="person-outline" label="Profile" to="SettingsProfile" />
      <Item icon="key-outline" label="Account" to="SettingsAccount" />
      <Item icon="notifications-outline" label="Notifications" to="SettingsNotifications" />
      <Item icon="color-palette-outline" label="Theme" to="SettingsTheme" />
      <Item icon="time-outline" label="Login history" to="SettingsHistory" />
      {devUnlocked ? (
        <Item icon="code-slash-outline" label="Developer options" to="SettingsDeveloper" badge="DEV" />
      ) : null}
      <Item icon="log-out-outline" label="Sign out" onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }])} />
      <TouchableOpacity activeOpacity={0.7} onPress={onVersionPress} style={{ paddingVertical: 12 }}>
        <AppText size={12} muted style={{ textAlign: 'center', marginTop: 12 }}>{APP_VERSION}</AppText>
      </TouchableOpacity>
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

export function SettingsNotificationsScreen() {
  const { theme } = useTheme();
  const [st, setSt] = useState(getNotificationSettings());
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    let alive = true;
    loadNotificationSettings().then((v) => { if (alive) setSt({ ...v }); }).catch(() => {});
    hasPermission().then((g) => { if (alive) setAllowed(g); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const update = async (patch) => {
    try {
      if (patch.enabled === true) {
        const ok = await requestPermission();
        setAllowed(ok);
        if (!ok) {
          Alert.alert('Notifications are blocked', 'Allow notifications for HelloCat in your phone settings to get message alerts.', [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
          ]);
        }
      }
      const next = await saveNotificationSettings(patch);
      setSt({ ...next });
      if ('sound' in patch || 'vibrate' in patch || 'callsEnabled' in patch || 'callSound' in patch || 'callVibrate' in patch) {
        setupNotifications();
      }
    } catch (e) { /* settings must never crash the app */ }
  };

  const test = async () => {
    const ok = await sendTestNotification();
    if (!ok) Alert.alert('Notifications are blocked', 'Allow notifications for HelloCat in your phone settings first.');
  };

  const Toggle = ({ label, hint, k, disabled }) => (
    <Row style={{ paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.dark ? '#ffffff15' : '#00000010', opacity: disabled ? 0.45 : 1 }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <AppText>{label}</AppText>
        {hint ? <AppText size={12} muted>{hint}</AppText> : null}
      </View>
      <Switch value={!!st[k]} disabled={disabled} onValueChange={(v) => update({ [k]: v })} trackColor={{ true: theme.link, false: '#8885' }} thumbColor="#fff" />
    </Row>
  );

  return (
    <Screen>
      <ScrollView>
        <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 }}>
          <AppText bold size={13} muted>MESSAGES</AppText>
        </View>
        <Toggle label="Message notifications" hint="Get notified when anyone sends you a message" k="enabled" />
        <Toggle label="Show message preview" hint="Turn off to hide the message text in notifications" k="preview" disabled={!st.enabled} />
        <Toggle label="Message Sound" k="sound" disabled={!st.enabled} />
        <Toggle label="Message Vibrate" k="vibrate" disabled={!st.enabled} />

        <View style={{ paddingHorizontal: 18, paddingTop: 20, paddingBottom: 6 }}>
          <AppText bold size={13} muted>CALLS</AppText>
        </View>
        <Toggle label="Call notifications" hint="Get notified and wake screen for incoming voice & video calls" k="callsEnabled" />
        <Toggle label="Ringtone" hint="Play ringtone during incoming calls" k="callSound" disabled={!st.callsEnabled} />
        <Toggle label="Call Vibrate" hint="Vibrate phone on incoming calls" k="callVibrate" disabled={!st.callsEnabled} />

        {!allowed && (st.enabled || st.callsEnabled) ? (
          <AppText size={12} style={{ color: '#e5484d', padding: 18 }}>Android is currently blocking HelloCat notifications. Enable them in your phone's app settings.</AppText>
        ) : null}
        <View style={{ padding: 18 }}>
          <Button title="Send a test notification" secondary onPress={test} disabled={!st.enabled} />
          <AppText size={12} muted style={{ marginTop: 14 }}>You will not be notified for the chat you currently have open. If push is set up for this build, alerts also arrive when HelloCat is closed.</AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

export function SettingsDeveloperScreen() {
  const { theme } = useTheme();
  const [recordEnabled, setRecordEnabled] = useState(false);
  const [recordings, setRecordings] = useState([]);

  const refreshRecordings = () => {
    callRecorder.listRecordings().then(setRecordings).catch(() => setRecordings([]));
  };

  useEffect(() => {
    callRecorder.isEnabled().then(setRecordEnabled).catch(() => {});
    refreshRecordings();
  }, []);

  const onToggleRecord = async (v) => {
    setRecordEnabled(v);
    await callRecorder.setEnabled(v);
  };

  const shareRecording = async (rec) => {
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(rec.uri);
      } else {
        Alert.alert('Recording Location', rec.uri);
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  return (
    <Screen>
      <ScrollView>
        <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 }}>
          <AppText bold size={13} muted>EXPERIMENTAL FEATURES</AppText>
        </View>

        <Row style={{ paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.dark ? '#ffffff15' : '#00000010' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <AppText>Call Recording</AppText>
            <AppText size={12} muted>Automatically record voice/video calls to /Hellocat/Racordig/</AppText>
          </View>
          <Switch value={recordEnabled} onValueChange={onToggleRecord} trackColor={{ true: theme.link, false: '#8885' }} thumbColor="#fff" />
        </Row>

        <View style={{ paddingHorizontal: 18, paddingTop: 20, paddingBottom: 6 }}>
          <AppText bold size={13} muted>SAVED CALL RECORDINGS ({recordings.length})</AppText>
        </View>

        {recordings.length === 0 ? (
          <AppText size={13} muted style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
            No recordings found yet in /Hellocat/Racordig/.
          </AppText>
        ) : (
          recordings.map((rec, i) => (
            <TouchableOpacity key={i} onPress={() => shareRecording(rec)}>
              <Row style={{ paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.dark ? '#ffffff15' : '#00000010' }}>
                <Ionicons name="mic-circle-outline" size={26} color={theme.link} />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <AppText size={13} numberOfLines={1}>{rec.name}</AppText>
                  <AppText size={11} muted>Tap to play or export</AppText>
                </View>
                <Ionicons name="share-outline" size={20} color={theme.text} style={{ opacity: 0.6 }} />
              </Row>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
