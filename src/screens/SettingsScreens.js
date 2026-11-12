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
import { Switch, Linking, AppState } from 'react-native';
import { Audio } from 'expo-av';
import { getNotificationSettings, loadNotificationSettings, saveNotificationSettings, requestPermission, hasPermission, sendTestNotification, setupNotifications } from '../services/notifications';
import { uploadLocalFile } from '../services/chat';
import { invalidateUser } from '../services/users';
import { validateName, formatDateTime } from '../utils';
import { callRecorder } from '../services/callRecorder';
import { BUILTIN_TONES, loadRingtone, getRingtone, setBuiltinRingtone, pickCustomRingtone, previewRingtone, stopRingtone } from '../services/ringtone';
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
  const [tone, setTone] = useState(getRingtone());

  useEffect(() => {
    loadRingtone().then((c) => setTone({ ...c })).catch(() => {});
    return () => { stopRingtone(); };
  }, []);

  const chooseTone = async (id) => {
    await setBuiltinRingtone(id); setTone({ ...getRingtone() }); previewRingtone();
  };
  const chooseCustom = async () => {
    try { const c = await pickCustomRingtone(); if (c) { setTone({ ...c }); previewRingtone(); } }
    catch (e) { Alert.alert('Could not use that file', 'Pick a different audio file.'); }
  };

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
        <Toggle label="Incoming call banner" hint="Show a compact banner at the top when HelloCat is open. Turn off to always show the full screen." k="callBanner" />
        <Toggle label="Ringtone" hint="Play ringtone during incoming calls" k="callSound" disabled={!st.callsEnabled} />
        <Toggle label="Call Vibrate" hint="Vibrate phone on incoming calls" k="callVibrate" disabled={!st.callsEnabled} />

        <View style={{ paddingHorizontal: 18, paddingTop: 20, paddingBottom: 6, opacity: st.callsEnabled ? 1 : 0.45 }}>
          <AppText bold size={13} muted>CALL RINGTONE</AppText>
        </View>
        {BUILTIN_TONES.map((t) => (
          <TouchableOpacity key={t.id} disabled={!st.callsEnabled} onPress={() => chooseTone(t.id)} style={{ opacity: st.callsEnabled ? 1 : 0.45 }}>
            <Row style={{ paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.dark ? '#ffffff15' : '#00000010' }}>
              <Ionicons name={tone.id === t.id ? 'radio-button-on' : 'radio-button-off'} size={22} color={theme.link} />
              <AppText style={{ marginLeft: 12, flex: 1 }}>{t.label}</AppText>
              <Ionicons name="play-circle-outline" size={22} color={theme.text} style={{ opacity: 0.5 }} />
            </Row>
          </TouchableOpacity>
        ))}
        <TouchableOpacity disabled={!st.callsEnabled} onPress={chooseCustom} style={{ opacity: st.callsEnabled ? 1 : 0.45 }}>
          <Row style={{ paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.dark ? '#ffffff15' : '#00000010' }}>
            <Ionicons name={tone.id === 'custom' ? 'radio-button-on' : 'radio-button-off'} size={22} color={theme.link} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <AppText>Custom ringtone…</AppText>
              <AppText size={12} muted numberOfLines={1}>{tone.id === 'custom' && tone.customName ? tone.customName : 'Choose any audio file from your phone'}</AppText>
            </View>
            <Ionicons name="folder-open-outline" size={22} color={theme.text} style={{ opacity: 0.5 }} />
          </Row>
        </TouchableOpacity>

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

const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const fmtDur = (ms) => { const t = Math.max(0, Math.round((ms || 0) / 1000)); const m = Math.floor(t / 60); const s2 = t % 60; return `${m}:${s2 < 10 ? '0' : ''}${s2}`; };
const fmtWhen = (t) => { try { return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };

export function SettingsDeveloperScreen() {
  const { theme } = useTheme();
  const [recordEnabled, setRecordEnabled] = useState(false);
  const [recordings, setRecordings] = useState([]);
  const [storage, setStorage] = useState({ direct: false, needsAllFiles: false, path: '/Hellocat/Racordig' });
  const [playing, setPlaying] = useState(null); // { uri, pos, dur, isPlaying }
  const soundRef = React.useRef(null);
  const [barW, setBarW] = useState(1);

  const refresh = async () => {
    const list = await callRecorder.listRecordings().catch(() => []);
    setRecordings(list);
    const st = await callRecorder.storageStatus().catch(() => null);
    if (st) setStorage(st);
  };

  const unloadSound = async () => {
    const s = soundRef.current; soundRef.current = null;
    if (s) { try { await s.stopAsync(); } catch (e) {} try { await s.unloadAsync(); } catch (e) {} }
  };

  useEffect(() => {
    callRecorder.isEnabled().then(setRecordEnabled).catch(() => {});
    refresh();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') { refresh(); callRecorder.storageStatus().then((x) => { if (x && x.direct) callRecorder.publishAll(); }).catch(() => {}); }
    });
    return () => { sub.remove(); unloadSound(); };
  }, []);

  const onToggleRecord = async (v) => {
    const success = await callRecorder.setEnabled(v);
    setRecordEnabled(success);
    refresh();
  };

  const play = async (rec) => {
    try {
      if (playing && playing.uri === rec.uri && soundRef.current) {
        const st = await soundRef.current.getStatusAsync();
        if (st.isLoaded) { if (st.isPlaying) await soundRef.current.pauseAsync(); else await soundRef.current.playAsync(); return; }
      }
      await unloadSound();
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false, staysActiveInBackground: false, shouldDuckAndroid: true });
      const { sound } = await Audio.Sound.createAsync({ uri: rec.uri }, { shouldPlay: true }, (st) => {
        if (!st.isLoaded) return;
        setPlaying({ uri: rec.uri, pos: st.positionMillis, dur: st.durationMillis || 0, isPlaying: st.isPlaying });
        if (st.didJustFinish) { sound.setPositionAsync(0).catch(() => {}); sound.pauseAsync().catch(() => {}); }
      });
      soundRef.current = sound;
    } catch (e) { Alert.alert('Could not play', 'This recording cannot be played.'); }
  };

  const seek = async (rec, x) => {
    if (!playing || playing.uri !== rec.uri || !soundRef.current || !playing.dur) return;
    const ratio = Math.min(1, Math.max(0, x / barW));
    try { await soundRef.current.setPositionAsync(Math.round(ratio * playing.dur)); } catch (e) {}
  };

  const shareRec = async (rec) => {
    try {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(rec.uri, { mimeType: rec.name.endsWith('.m4a') ? 'audio/mp4' : 'audio/x-wav' });
      else Alert.alert('Recording location', rec.uri);
    } catch (e) { Alert.alert('Error', e.message); }
  };

  const del = (rec) => {
    Alert.alert('Delete recording?', rec.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (playing && playing.uri === rec.uri) { await unloadSound(); setPlaying(null); }
        await callRecorder.deleteRecording(rec);
        refresh();
      } },
    ]);
  };

  const delAll = () => {
    if (!recordings.length) return;
    Alert.alert('Delete all recordings?', `${recordings.length} recordings will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete all', style: 'destructive', onPress: async () => {
        await unloadSound(); setPlaying(null);
        for (const r of recordings) await callRecorder.deleteRecording(r);
        refresh();
      } },
    ]);
  };

  const allowAllFiles = async () => {
    Alert.alert('Allow file access', 'To save recordings in the /Hellocat/Racordig folder, turn on "Allow access to manage all files" for HelloCat on the next screen, then come back.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open settings', onPress: () => { callRecorder.requestAllFilesAccess(); } },
    ]);
  };

  const line = { borderBottomWidth: 1, borderBottomColor: theme.dark ? '#ffffff15' : '#00000010' };
  const totalSize = recordings.reduce((a, r) => a + (r.size || 0), 0);
  const folderText = storage.direct ? storage.path : 'Documents/Hellocat/Racordig';

  return (
    <Screen>
      <ScrollView>
        <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 }}>
          <AppText bold size={13} muted>CALL RECORDING</AppText>
        </View>

        <Row style={{ paddingHorizontal: 18, paddingVertical: 14, ...line }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <AppText>Record calls</AppText>
            <AppText size={12} muted>Records both sides of voice and video calls automatically</AppText>
          </View>
          <Switch value={recordEnabled} onValueChange={onToggleRecord} trackColor={{ true: theme.link, false: '#8885' }} thumbColor="#fff" />
        </Row>

        <View style={{ paddingHorizontal: 18, paddingVertical: 14, ...line }}>
          <Row>
            <Ionicons name="folder-open-outline" size={22} color={theme.link} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <AppText>Saved to</AppText>
              <AppText size={12} muted>{folderText}</AppText>
            </View>
          </Row>
          {storage.needsAllFiles ? (
            <View style={{ marginTop: 12 }}>
              <AppText size={12} muted style={{ marginBottom: 8 }}>Android only allows the exact /Hellocat/Racordig folder with "All files access". Until you allow it, recordings go to Documents/Hellocat/Racordig.</AppText>
              <Button title="Allow /Hellocat/Racordig folder" secondary onPress={allowAllFiles} />
            </View>
          ) : null}
        </View>

        <Row style={{ paddingHorizontal: 18, paddingTop: 20, paddingBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <AppText bold size={13} muted>RECORDINGS ({recordings.length}){recordings.length ? ` · ${fmtSize(totalSize)}` : ''}</AppText>
          </View>
          {recordings.length ? (
            <TouchableOpacity onPress={delAll}><AppText size={13} style={{ color: '#e5484d' }}>Delete all</AppText></TouchableOpacity>
          ) : null}
        </Row>

        {recordings.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 30 }}>
            <Ionicons name="mic-off-outline" size={38} color={theme.text} style={{ opacity: 0.3 }} />
            <AppText size={13} muted style={{ marginTop: 10, textAlign: 'center' }}>No recordings yet. Turn on recording and make a call.</AppText>
          </View>
        ) : (
          recordings.map((rec) => {
            const active = playing && playing.uri === rec.uri;
            const isPlay = active && playing.isPlaying;
            const ratio = active && playing.dur ? Math.min(1, playing.pos / playing.dur) : 0;
            return (
              <View key={rec.uri} style={{ paddingHorizontal: 18, paddingVertical: 12, ...line }}>
                <Row>
                  <TouchableOpacity onPress={() => play(rec)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name={isPlay ? 'pause-circle' : 'play-circle'} size={42} color={theme.link} />
                  </TouchableOpacity>
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <AppText size={14} numberOfLines={1}>Call · {fmtWhen(rec.when)}</AppText>
                    <AppText size={11} muted>{fmtSize(rec.size)} · {rec.name.split('.').pop().toUpperCase()}{active && playing.dur ? ` · ${fmtDur(playing.pos)} / ${fmtDur(playing.dur)}` : ''}</AppText>
                  </View>
                  <TouchableOpacity onPress={() => shareRec(rec)} style={{ padding: 8 }}>
                    <Ionicons name="share-outline" size={20} color={theme.text} style={{ opacity: 0.7 }} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => del(rec)} style={{ padding: 8 }}>
                    <Ionicons name="trash-outline" size={20} color="#e5484d" />
                  </TouchableOpacity>
                </Row>
                {active ? (
                  <TouchableOpacity activeOpacity={1} onPress={(e) => seek(rec, e.nativeEvent.locationX)} onLayout={(e) => setBarW(e.nativeEvent.layout.width || 1)} style={{ marginTop: 10, paddingVertical: 8 }}>
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: '#8885' }}>
                      <View style={{ height: 5, borderRadius: 3, width: `${ratio * 100}%`, backgroundColor: theme.link }} />
                    </View>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    </Screen>
  );
}
