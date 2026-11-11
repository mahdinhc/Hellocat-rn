import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, PermissionsAndroid, Alert } from 'react-native';

const DEV_CALL_RECORDING_KEY = 'hellocat_dev_call_recording_enabled';

class CallRecorderService {
  constructor() {
    this.recording = null;
    this.isRecording = false;
    this.enabled = false;
    this.activeCallId = null;
    this.starting = false;
    this.stopRequested = false;
    this.init();
  }

  async init() {
    try {
      const val = await AsyncStorage.getItem(DEV_CALL_RECORDING_KEY);
      this.enabled = val === 'true';
    } catch (e) {
      this.enabled = false;
    }
  }

  async isEnabled() {
    try {
      const val = await AsyncStorage.getItem(DEV_CALL_RECORDING_KEY);
      this.enabled = val === 'true';
      return this.enabled;
    } catch (e) {
      return false;
    }
  }

  async requestStorageAndAudioPermissions() {
    try {
      // 1. Audio Recording Permission
      const audioPerm = await Audio.requestPermissionsAsync();
      if (!audioPerm.granted) {
        Alert.alert('Permission Denied', 'Microphone permission is required for call recording.');
        return false;
      }

      // 2. Storage Permissions on Android
      if (Platform.OS === 'android') {
        const sdkInt = Platform.Version;
        if (typeof sdkInt === 'number' && sdkInt < 33) {
          const writeGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
            {
              title: 'Storage Permission',
              message: 'HelloCat needs storage access to save call recordings to Music/Hellocat Recordings.',
              buttonPositive: 'Allow',
            }
          );
          if (writeGranted !== PermissionsAndroid.RESULTS.GRANTED) {
            Alert.alert('Storage Permission Denied', 'Storage permission is required to save call recordings.');
            return false;
          }
        }
      }
      return true;
    } catch (e) {
      console.warn('[CallRecorder permission error]', e);
      return false;
    }
  }

  async setEnabled(enabled) {
    if (enabled) {
      const granted = await this.requestStorageAndAudioPermissions();
      if (!granted) {
        this.enabled = false;
        await AsyncStorage.setItem(DEV_CALL_RECORDING_KEY, 'false').catch(() => {});
        return false;
      }
    }

    this.enabled = !!enabled;
    try {
      await AsyncStorage.setItem(DEV_CALL_RECORDING_KEY, this.enabled ? 'true' : 'false');
    } catch (e) {
      // ignore
    }
    return this.enabled;
  }

  async startRecording(callId) {
    const isAct = await this.isEnabled();
    if (!isAct || this.isRecording || this.starting) return;
    this.starting = true;
    this.stopRequested = false;
    try {
      // mic permission may have been revoked since the toggle was switched on
      const perm = await Audio.getPermissionsAsync();
      if (!perm.granted) {
        const r = await Audio.requestPermissionsAsync();
        if (!r.granted) return;
      }
      // Let WebRTC / InCallManager finish grabbing the audio session first; configuring expo-av at the
      // same moment is what made recording fail before.
      await new Promise((r) => setTimeout(r, 1500));
      if (this.stopRequested) return;

      // On Android do NOT touch the audio mode (it steals audio focus from the call); iOS needs it.
      if (Platform.OS === 'ios') {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true, staysActiveInBackground: true }).catch(() => {});
      }

      const attempts = [
        { sampleRate: 16000, numberOfChannels: 1, bitRate: 64000 },
        { sampleRate: 44100, numberOfChannels: 1, bitRate: 96000 },
        { sampleRate: 8000, numberOfChannels: 1, bitRate: 32000 },
      ];
      let recording = null;
      for (const a of attempts) {
        const rec = new Audio.Recording();
        try {
          await rec.prepareToRecordAsync({
            isMeteringEnabled: false,
            android: { extension: '.m4a', outputFormat: Audio.AndroidOutputFormat.MPEG_4, audioEncoder: Audio.AndroidAudioEncoder.AAC, ...a },
            ios: { extension: '.m4a', outputFormat: Audio.IOSOutputFormat.MPEG4AAC, audioQuality: Audio.IOSAudioQuality.MEDIUM, ...a, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
            web: {},
          });
          await rec.startAsync();
          recording = rec;
          break;
        } catch (e) {
          console.warn('[CallRecorder] attempt failed', a.sampleRate, e && e.message);
          try { await rec.stopAndUnloadAsync(); } catch (e2) {}
        }
      }
      if (!recording) return;
      if (this.stopRequested) {
        try { await recording.stopAndUnloadAsync(); } catch (e) {}
        return;
      }
      this.recording = recording;
      this.isRecording = true;
      this.activeCallId = callId;
    } catch (e) {
      console.warn('[CallRecorder start error]', e);
      this.isRecording = false;
      this.recording = null;
    } finally {
      this.starting = false;
    }
  }

  async stopRecording() {
    this.stopRequested = true;
    if (!this.isRecording || !this.recording) return null;
    const rec = this.recording;
    this.recording = null;
    this.isRecording = false;
    try {
      try { await rec.stopAndUnloadAsync(); } catch (e) { /* already stopped */ }
      const uri = rec.getURI();
      if (!uri) return null;

      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `Call_${dateStr}.m4a`;

      // App-private copy (always works, listed in Developer options)
      const targetDir = `${FileSystem.documentDirectory}Hellocat/Racordig/`;
      const dirInfo = await FileSystem.getInfoAsync(targetDir);
      if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
      const destPath = `${targetDir}${fileName}`;
      await FileSystem.copyAsync({ from: uri, to: destPath });

      // Also publish to the phone's public storage so it shows up in file managers / music apps
      try {
        const MediaLibrary = require('expo-media-library');
        const p = await MediaLibrary.requestPermissionsAsync(true);
        if (p.granted) {
          const asset = await MediaLibrary.createAssetAsync(destPath);
          const album = await MediaLibrary.getAlbumAsync('Hellocat Recordings');
          if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
          else await MediaLibrary.createAlbumAsync('Hellocat Recordings', asset, false);
        }
      } catch (e) { /* optional */ }

      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      return destPath;
    } catch (e) {
      console.warn('[CallRecorder stop error]', e);
      return null;
    }
  }

  async listRecordings() {
    try {
      const targetDir = `${FileSystem.documentDirectory}Hellocat/Racordig/`;
      const dirInfo = await FileSystem.getInfoAsync(targetDir);
      if (!dirInfo.exists) return [];
      const files = await FileSystem.readDirectoryAsync(targetDir);
      return files.map((name) => ({
        name,
        uri: `${targetDir}${name}`,
      }));
    } catch (e) {
      return [];
    }
  }
}

export const callRecorder = new CallRecorderService();
