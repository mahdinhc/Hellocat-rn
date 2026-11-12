// Thin wrapper around the native call helpers (notification pill, ringer mode, lock-screen mode, tones, background keep-alive).
// Every call is safe to make when the native module is missing (old APK / iOS).
import { NativeModules, Platform } from 'react-native';

const Native = NativeModules.CallRecorderNative;
const ok = Platform.OS === 'android' && !!Native;

let prefs = { enabled: true, banner: true, sound: true, vibrate: true, tone: 'hellocat' };

export function setNativePrefs(patch) {
  prefs = { ...prefs, ...patch };
  if (prefs.tone === 'custom') prefs = { ...prefs, tone: 'hellocat' }; // custom files cannot be used by the system notification
  try { if (ok && Native.setCallPrefs) Native.setCallPrefs(prefs); } catch (e) { /* ignore */ }
}

export const nativeCall = {
  available: ok && !!Native.showIncomingCall,
  show(call) {
    try { return ok && Native.showIncomingCall ? Native.showIncomingCall(call) : Promise.resolve(false); } catch (e) { return Promise.resolve(false); }
  },
  cancel(callId) { try { if (ok && Native.cancelIncomingCall) Native.cancelIncomingCall(callId || ''); } catch (e) { /* ignore */ } },
  overLock(on) { try { if (ok && Native.showOverLockScreen) Native.showOverLockScreen(!!on); } catch (e) { /* ignore */ } },
  moveToBack() { try { if (ok && Native.moveToBack) Native.moveToBack(); } catch (e) { /* ignore */ } },
  async ringerMode() {
    try { return ok && Native.getRingerMode ? await Native.getRingerMode() : 'normal'; } catch (e) { return 'normal'; }
  },
  playFeedbackTone(toneType) {
    try {
      if (ok && Native.playFeedbackTone) {
        Native.playFeedbackTone(toneType);
      }
    } catch (e) {}
  },
  startKeepAlive(title = 'HelloCat Call') {
    try {
      if (ok && Native.startCallKeepAlive) {
        Native.startCallKeepAlive(title);
      }
    } catch (e) {}
  },
  stopKeepAlive() {
    try {
      if (ok && Native.stopCallKeepAlive) {
        Native.stopCallKeepAlive();
      }
    } catch (e) {}
  },
};
