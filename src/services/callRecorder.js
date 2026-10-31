import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEV_CALL_RECORDING_KEY = 'hellocat_dev_call_recording_enabled';

class CallRecorderService {
  constructor() {
    this.recording = null;
    this.isRecording = false;
    this.enabled = false;
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

  async setEnabled(enabled) {
    this.enabled = !!enabled;
    try {
      await AsyncStorage.setItem(DEV_CALL_RECORDING_KEY, this.enabled ? 'true' : 'false');
    } catch (e) {
      // ignore
    }
  }

  async startRecording(callId) {
    const isAct = await this.isEnabled();
    if (!isAct || this.isRecording) return;

    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      this.recording = recording;
      this.isRecording = true;
      this.activeCallId = callId;
    } catch (e) {
      console.warn('[CallRecorder start error]', e);
    }
  }

  async stopRecording() {
    if (!this.isRecording || !this.recording) return null;
    try {
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      this.isRecording = false;
      this.recording = null;

      if (!uri) return null;

      // Save to external/accessible Hellocat directory
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      const targetDir = `${FileSystem.documentDirectory}Hellocat/Racordig/`;
      const dirInfo = await FileSystem.getInfoAsync(targetDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
      }

      const destPath = `${targetDir}Call_${this.activeCallId || dateStr}_${dateStr}.m4a`;
      await FileSystem.copyAsync({ from: uri, to: destPath });
      console.log('[CallRecorder] Saved to:', destPath);
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
