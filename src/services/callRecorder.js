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
    this.activePartnerName = '';
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
        if (Platform.Version <= 28) {
          const writeGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
            {
              title: 'Storage Permission',
              message: 'HelloCat needs storage access to save your recorded calls.',
              buttonPositive: 'OK',
            }
          );
          if (writeGranted !== PermissionsAndroid.RESULTS.GRANTED) {
            Alert.alert('Permission Denied', 'Storage permission is required to save call recordings.');
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

  async startRecording(callId, partnerName = '') {
    const isAct = await this.isEnabled();
    if (!isAct || this.isRecording || this.starting) return;
    this.starting = true;
    this.stopRequested = false;
    this.activePartnerName = (partnerName || 'Unknown').trim();
    try {
      const perm = await Audio.getPermissionsAsync();
      if (!perm.granted) {
        const r = await Audio.requestPermissionsAsync();
        if (!r.granted) return;
      }
      await new Promise((r) => setTimeout(r, 1500));
      if (this.stopRequested) return;

      const safeFolder = (this.activePartnerName || 'Unknown').replace(/[^a-zA-Z0-9._ -]/g, '_').trim() || 'Unknown';
      const now = new Date();
      const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

      // 1) Preferred: native full-call recorder (mic + partner audio mixed)
      if (Platform.OS === 'android' && Native) {
        try {
          if (await Native.isAvailable()) {
            const dir = `${FileSystem.documentDirectory}Hellocat/Racordig/${safeFolder}/`;
            const info = await FileSystem.getInfoAsync(dir);
            if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
            const fileName = `${datePart}.wav`;
            const destPath = `${dir}${fileName}`;
            const ok = await Native.start(destPath);
            if (ok) {
              this.native = true;
              this.isRecording = true;
              this.activeCallId = callId;
              this.currentDestPath = destPath;
              this.currentSafeFolder = safeFolder;
              this.currentFileName = fileName;
              setTimeout(async () => {
                try {
                  if (!this.native || !this.isRecording) return;
                  const st = await Native.stats();
                  if (!st || (st.mic <= 0 && st.spk <= 0)) {
                    await Native.stop().catch(() => null);
                    this.native = false;
                    this.isRecording = false;
                    this.stopRequested = false;
                    this._startExpoAv(callId, safeFolder, datePart);
                  }
                } catch (e) {}
              }, 4000);
              return;
            }
          }
        } catch (e) {
          console.warn('[CallRecorder] native start failed', e && e.message);
          this.native = false;
        }
      }
      await this._startExpoAv(callId, safeFolder, datePart);
    } catch (e) {
      console.warn('[CallRecorder start error]', e);
      this.isRecording = false;
      this.recording = null;
    } finally {
      this.starting = false;
    }
  }

  // 2) Fallback: expo-av microphone-only recording
  async _startExpoAv(callId, safeFolder, datePart) {
    try {
      if (Platform.OS === 'ios') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
        }).catch(() => {});
      }

      const attempts = [
        { sampleRate: 16000, numberOfChannels: 1, bitRate: 64000 },
        { sampleRate: 44100, numberOfChannels: 1, bitRate: 96000 },
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
      this.currentSafeFolder = safeFolder || 'Unknown';
      this.currentDatePart = datePart || 'Call';
    } catch (e) {
      console.warn('[CallRecorder expo-av error]', e);
      this.isRecording = false;
      this.recording = null;
    }
  }

  async stopRecording() {
    this.stopRequested = true;
    const safeFolder = this.currentSafeFolder || (this.activePartnerName || 'Unknown').replace(/[^a-zA-Z0-9._ -]/g, '_').trim() || 'Unknown';

    if (this.native) {
      this.native = false;
      this.isRecording = false;
      try {
        const dest = (await Native.stop()) || null;
        if (dest && Platform.OS === 'android' && Native.publishFile) {
          Native.publishFile(dest, safeFolder).catch(() => {});
        }
        return dest;
      } catch (e) { return null; }
    }
    if (!this.isRecording || !this.recording) return null;
    const rec = this.recording;
    this.recording = null;
    this.isRecording = false;
    try {
      try { await rec.stopAndUnloadAsync(); } catch (e) {}
      const uri = rec.getURI();
      if (!uri) return null;

      const now = new Date();
      const datePart = this.currentDatePart || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
      const fileName = `${datePart}.m4a`;

      // Grouped by partner name (/Name/date.m4a)
      const targetDir = `${FileSystem.documentDirectory}Hellocat/Racordig/${safeFolder}/`;
      const dirInfo = await FileSystem.getInfoAsync(targetDir);
      if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
      const destPath = `${targetDir}${fileName}`;
      await FileSystem.copyAsync({ from: uri, to: destPath });

      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      if (Platform.OS === 'android' && Native && Native.publishFile) {
        Native.publishFile(destPath, safeFolder).catch(() => {});
      }
      return destPath;
    } catch (e) {
      console.warn('[CallRecorder stop error]', e);
      return null;
    }
  }

  async listRecordings() {
    try {
      const baseDir = `${FileSystem.documentDirectory}Hellocat/Racordig/`;
      const baseInfo = await FileSystem.getInfoAsync(baseDir);
      if (!baseInfo.exists) return [];

      const entries = await FileSystem.readDirectoryAsync(baseDir);
      const out = [];

      for (const entry of entries) {
        const entryUri = `${baseDir}${entry}`;
        const entryInfo = await FileSystem.getInfoAsync(entryUri);

        if (entryInfo.isDirectory) {
          const partnerName = entry;
          const subFiles = await FileSystem.readDirectoryAsync(`${entryUri}/`);
          for (const subName of subFiles) {
            if (!/\.(wav|m4a)$/i.test(subName)) continue;
            const fileUri = `${entryUri}/${subName}`;
            let size = 0;
            let modified = 0;
            try {
              const fi = await FileSystem.getInfoAsync(fileUri, { size: true });
              size = fi.size || 0;
              modified = (fi.modificationTime || 0) * 1000;
            } catch (e) {}

            const m = subName.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
            const when = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : modified;
            out.push({
              name: subName,
              uri: fileUri,
              size,
              when,
              folder: partnerName,
              relativePath: `${partnerName}/${subName}`,
            });
          }
        } else if (/\.(wav|m4a)$/i.test(entry)) {
          let size = 0;
          let modified = 0;
          try {
            const fi = await FileSystem.getInfoAsync(entryUri, { size: true });
            size = fi.size || 0;
            modified = (fi.modificationTime || 0) * 1000;
          } catch (e) {}
          const m = entry.match(/(\d{4})-(\d{2})-(\d{2})[T_](\d{2})-(\d{2})-(\d{2})/);
          const when = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : modified;
          out.push({
            name: entry,
            uri: entryUri,
            size,
            when,
            folder: 'General',
            relativePath: entry,
          });
        }
      }

      out.sort((a, b) => b.when - a.when);
      return out;
    } catch (e) {
      return [];
    }
  }

  async deleteRecording(rec) {
    try { await FileSystem.deleteAsync(rec.uri, { idempotent: true }); } catch (e) {}
    if (Platform.OS === 'android' && Native && Native.deletePublic) {
      try { await Native.deletePublic(rec.name); } catch (e) {}
    }
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
    for (const r of list) {
      try { await Native.publishFile(r.uri, r.folder || ''); } catch (e) { /* ignore */ }
    }
  }
}

export const callRecorder = new CallRecorderService();
