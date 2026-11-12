import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, PermissionsAndroid, Alert, NativeModules } from 'react-native';

const Native = NativeModules.CallRecorderNative;

const DEV_CALL_RECORDING_KEY = 'hellocat_dev_call_recording_enabled';

class CallRecorderService {
  constructor() {
    this.recording = null;
    this.isRecording = false;
    this.enabled = false;
    this.activeCallId = null;
    this.starting = false;
    this.stopRequested = false;
    this.native = false;
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
              message: 'HelloCat needs storage access to save call recordings to Music/Hellocat Recordings',
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

      // 1) Preferred: native full-call recorder (your mic + the other person's voice mixed into one WAV)
      if (Platform.OS === 'android' && Native) {
        try {
          if (await Native.isAvailable()) {
            const dir = `${FileSystem.documentDirectory}Hellocat/Racordig/`;
            const info = await FileSystem.getInfoAsync(dir);
            if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const ok = await Native.start(`${dir}Call_${stamp}.wav`);
            if (ok) {
              this.native = true;
              this.isRecording = true;
              this.activeCallId = callId;
              // If WebRTC never feeds us audio (module not hooked), fall back to the mic-only recorder.
              setTimeout(async () => {
                try {
                  if (!this.native || !this.isRecording) return;
                  const st = await Native.stats();
                  if (!st || (st.mic <= 0 && st.spk <= 0)) {
                    await Native.stop().catch(() => null);
                    this.native = false;
                    this.isRecording = false;
                    this.stopRequested = false;
                    this._startExpoAv(callId);
                  }
                } catch (e) { /* ignore */ }
              }, 4000);
              return;
            }
          }
        } catch (e) {
          console.warn('[CallRecorder] native start failed', e && e.message);
          this.native = false;
        }
      }
      await this._startExpoAv(callId, true);
    } catch (e) {
      console.warn('[CallRecorder start error]', e);
      this.isRecording = false;
      this.recording = null;
    } finally {
      this.starting = false;
    }
  }

  // 2) Fallback: expo-av microphone-only recording
  async _startExpoAv(callId) {
    try {
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
      console.warn('[CallRecorder expo-av error]', e);
      this.isRecording = false;
      this.recording = null;
    }
  }

  async stopRecording() {
    this.stopRequested = true;
    if (this.native) {
      this.native = false;
      this.isRecording = false;
      try { return (await Native.stop()) || null; } catch (e) { return null; }
    }
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

      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      if (Platform.OS === 'android' && Native && Native.publishFile) Native.publishFile(destPath).catch(() => {});
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
      const out = [];
      for (const name of files) {
        if (!/\.(wav|m4a)$/i.test(name)) continue;
        const uri = `${targetDir}${name}`;
        let size = 0; let modified = 0;
        try {
          const i = await FileSystem.getInfoAsync(uri, { size: true });
          size = i.size || 0; modified = (i.modificationTime || 0) * 1000;
        } catch (e) { /* ignore */ }
        // Call_2026-11-12T04-22-10-123Z.wav -> real timestamp
        const m = name.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
        const when = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : modified;
        out.push({ name, uri, size, when });
      }
      out.sort((a, b) => b.when - a.when);
      return out;
    } catch (e) {
      return [];
    }
  }

  async deleteRecording(rec) {
    try { await FileSystem.deleteAsync(rec.uri, { idempotent: true }); } catch (e) { /* ignore */ }
    if (Platform.OS === 'android' && Native && Native.deletePublic) { try { await Native.deletePublic(rec.name); } catch (e) { /* ignore */ } }
  }

  // Where recordings are copied on the phone, and whether the real /Hellocat/Racordig folder is reachable.
  async storageStatus() {
    if (Platform.OS === 'android' && Native && Native.storageStatus) {
      try { return await Native.storageStatus(); } catch (e) { /* ignore */ }
    }
    return { direct: false, needsAllFiles: false, path: '/Hellocat/Racordig' };
  }

  async requestAllFilesAccess() {
    if (Platform.OS === 'android' && Native && Native.requestAllFilesAccess) {
      try { return await Native.requestAllFilesAccess(); } catch (e) { /* ignore */ }
    }
    return false;
  }

  // Copies every recording that is not yet in the public folder (used right after access is granted).
  async publishAll() {
    if (Platform.OS !== 'android' || !Native || !Native.publishFile) return;
    const list = await this.listRecordings();
    for (const r of list) { try { await Native.publishFile(r.uri); } catch (e) { /* ignore */ } }
  }
}

export const callRecorder = new CallRecorderService();
