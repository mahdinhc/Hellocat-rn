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
              message: 'HelloCat needs storage access to save call recordings to /Hellocat/Racordig/.',
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
    if (!isAct || this.isRecording) return;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      }).catch(() => {});

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {},
      });
      await recording.startAsync();

      this.recording = recording;
      this.isRecording = true;
      this.activeCallId = callId;
      console.log('[CallRecorder] Started recording for call:', callId);
    } catch (e) {
      console.warn('[CallRecorder start error]', e);
      this.isRecording = false;
      this.recording = null;
    }
  }

  async stopRecording() {
    if (!this.isRecording || !this.recording) return null;
    try {
      const rec = this.recording;
      this.recording = null;
      this.isRecording = false;

      const status = await rec.getStatusAsync().catch(() => null);
      if (status && status.canRecord) {
        await rec.stopAndUnloadAsync();
      }

      const uri = rec.getURI();
      if (!uri) return null;

      // Ensure directory exists in document/accessible directory
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      const targetDir = `${FileSystem.documentDirectory}Hellocat/Racordig/`;
      const dirInfo = await FileSystem.getInfoAsync(targetDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
      }

      const destPath = `${targetDir}Call_${this.activeCallId || dateStr}_${dateStr}.m4a`;
      await FileSystem.copyAsync({ from: uri, to: destPath });
      console.log('[CallRecorder] Successfully saved call to:', destPath);

      return destPath;
    } catch (e) {
      console.warn('[CallRecorder stop error]', e);
      this.isRecording = false;
      this.recording = null;
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
