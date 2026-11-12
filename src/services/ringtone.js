// Ringtone manager: built-in tones, system default, or a custom audio file picked by the user.
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vibration, Platform, NativeModules } from 'react-native';

const Native = NativeModules.CallRecorderNative;
import InCallManager from 'react-native-incall-manager';
import { nativeCall, setNativePrefs } from './nativeCall';

const KEY = 'hellocat_ringtone_v1';

export const BUILTIN_TONES = [
  { id: 'hellocat', raw: 'tone_hellocat', label: 'HelloCat (default)', src: require('../../assets/ringtones/hellocat.wav') },
  { id: 'marimba', raw: 'tone_marimba', label: 'Marimba', src: require('../../assets/ringtones/marimba.wav') },
  { id: 'classic', raw: 'tone_classic', label: 'Classic Ring', src: require('../../assets/ringtones/classic.wav') },
  { id: 'pulse', raw: 'tone_pulse', label: 'Synth Pulse', src: require('../../assets/ringtones/pulse.wav') },
  { id: 'system', label: 'System ringtone', src: null },
];

let choice = { id: 'hellocat', customUri: null, customName: null };
let sound = null;
let playing = false;

export async function loadRingtone() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) choice = { ...choice, ...JSON.parse(raw) };
  } catch (e) {}
  setNativePrefs({ tone: choice.id });
  return choice;
}
export const getRingtone = () => choice;

async function save(next) {
  choice = { ...choice, ...next };
  try { await AsyncStorage.setItem(KEY, JSON.stringify(choice)); } catch (e) {}
  setNativePrefs({ tone: choice.id });
  return choice;
}

export const setBuiltinRingtone = (id) => save({ id });

// Lets the user pick any audio file; it is copied into app storage so it keeps working.
export async function pickCustomRingtone() {
  const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
  if (res.canceled || !res.assets || !res.assets[0]) return null;
  const a = res.assets[0];
  const dir = `${FileSystem.documentDirectory}ringtones/`;
  try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch (e) {}
  const ext = (a.name && a.name.includes('.')) ? a.name.split('.').pop() : 'mp3';
  const dest = `${dir}custom_${Date.now()}.${ext}`;
  await FileSystem.copyAsync({ from: a.uri, to: dest });
  if (choice.customUri && choice.customUri !== dest) FileSystem.deleteAsync(choice.customUri, { idempotent: true }).catch(() => {});
  return save({ id: 'custom', customUri: dest, customName: a.name || 'Custom ringtone' });
}

function currentSource() {
  if (choice.id === 'custom' && choice.customUri) return { uri: choice.customUri };
  const t = BUILTIN_TONES.find((x) => x.id === choice.id);
  if (t && t.src) return t.src;
  if (choice.id === 'system') return null;
  return BUILTIN_TONES[0].src;
}

export async function stopRingtone() {
  playing = false;
  try { Vibration.cancel(); } catch (e) {}
  try { InCallManager.stopRingtone(); } catch (e) {}
  if (Native && Native.stopRingtone) { try { await Native.stopRingtone(); } catch (e) {} }
  const s = sound; sound = null;
  if (s) { try { await s.stopAsync(); } catch (e) {} try { await s.unloadAsync(); } catch (e) {} }
}

export async function playRingtone({ vibrate = true, loop = true, sound: withSound = true, ignoreRinger = false } = {}) {
  await stopRingtone();
  // Follow the phone's ringer: silent / Do Not Disturb = no sound and no vibration, vibrate mode = vibration only.
  const mode = ignoreRinger ? 'normal' : await nativeCall.ringerMode();
  if (mode === 'silent') return;
  playing = true;
  if (mode === 'vibrate') withSound = false;
  if (vibrate) { try { Vibration.vibrate([0, 700, 500, 700, 1500], true); } catch (e) {} }
  if (!withSound) return;
  // Preferred: native player on the RING stream (ring volume, respects silent mode, like a phone call)
  if (Platform.OS === 'android' && Native && Native.playRingtone) {
    try {
      let kind = 'system'; let value = '';
      if (choice.id === 'custom' && choice.customUri) { kind = 'file'; value = choice.customUri; }
      else {
        const t = BUILTIN_TONES.find((x) => x.id === choice.id);
        if (t && t.raw) { kind = 'raw'; value = t.raw; }
      }
      const ok = await Native.playRingtone(kind, value, !!loop);
      if (ok) return;
      if (kind !== 'system') { if (await Native.playRingtone('system', '', !!loop)) return; }
    } catch (e) { /* fall through to expo-av */ }
  }
  const src = currentSource();
  if (!src) { try { InCallManager.startRingtone('_DEFAULT_'); } catch (e) {} return; }
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
    const { sound: s } = await Audio.Sound.createAsync(src, { shouldPlay: false, isLooping: loop, volume: 1.0 });
    if (!playing) { await s.unloadAsync().catch(() => {}); return; }
    sound = s;
    await s.playAsync();
  } catch (e) {
    // custom file unreadable -> fall back to the system ringtone so a call is never silent
    try { InCallManager.startRingtone('_DEFAULT_'); } catch (e2) {}
  }
}

// Preview in settings (plays ~4s once, no vibration).
export async function previewRingtone() {
  await playRingtone({ vibrate: false, loop: false, ignoreRinger: true });
  setTimeout(() => { stopRingtone(); }, 5000);
}
