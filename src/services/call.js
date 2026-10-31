// WebRTC Calling System for React Native (HelloCat Mobile)
// Matches web call signaling over Firebase Realtime Database + Metered TURN servers
// Full telephony hardware integration: InCallManager (Earpiece, Speakerphone, Bluetooth, Proximity Sensor, Camera flip)

import { ref, set, update, get, onValue, off, push, serverTimestamp } from 'firebase/database';
import { db, auth } from '../firebase';
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import { pushAndNotify } from './chat';
import { notifyIncomingCallPush } from './pushNotify';
import { getNotificationSettings } from './notifications';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: '8903a7d0a8db3dc99e380809',
      credential: 'eKmEX7Q3LyylMhcx',
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: '8903a7d0a8db3dc99e380809',
      credential: 'eKmEX7Q3LyylMhcx',
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: '8903a7d0a8db3dc99e380809',
      credential: 'eKmEX7Q3LyylMhcx',
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: '8903a7d0a8db3dc99e380809',
      credential: 'eKmEX7Q3LyylMhcx',
    },
  ],
};

class MobileCallManager {
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.activeCall = null;
    this.incomingCallListener = null;
    this.currentCallListener = null;

    this.callTimer = null;
    this.callDurationSec = 0;
    this.ringTimeout = null;

    this.isMuted = false;
    this.isVideoOff = false;
    this.isSpeakerOn = false;
    this.isFrontCamera = true;
    this.isReconnecting = false;
    this.disconnectTimer = null;

    // Listeners for UI state updates
    this.subscribers = new Set();
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notifySubscribers() {
    const state = this.getState();
    this.subscribers.forEach((cb) => {
      try { cb(state); } catch (e) {}
    });
  }

  getState() {
    return {
      activeCall: this.activeCall,
      callDurationSec: this.callDurationSec,
      isMuted: this.isMuted,
      isVideoOff: this.isVideoOff,
      isSpeakerOn: this.isSpeakerOn,
      isFrontCamera: this.isFrontCamera,
      isReconnecting: this.isReconnecting,
      localStream: this.localStream,
      remoteStream: this.remoteStream,
    };
  }

  init(uid) {
    if (!uid) return;
    this.listenForIncomingCalls(uid);
  }

  listenForIncomingCalls(uid) {
    const incomingRef = ref(db, `users/${uid}/incoming_call`);
    if (this.incomingCallListener) {
      off(incomingRef, 'value', this.incomingCallListener);
    }

    this.incomingCallListener = onValue(incomingRef, (snapshot) => {
      const call = snapshot.val();
      if (!call) {
        if (this.activeCall && !this.activeCall.isCaller && this.activeCall.status === 'ringing') {
          this.cleanup();
        }
        return;
      }

      if (call.timestamp && Date.now() - call.timestamp > 45000) {
        set(incomingRef, null);
        return;
      }

      // Simultaneous dial tie-breaker
      if (this.activeCall && this.activeCall.isCaller && this.activeCall.status === 'calling') {
        if (this.activeCall.fid === call.callerId) {
          if (uid > call.callerId) {
            update(ref(db, `calls/${this.activeCall.callId}`), { status: 'cancelled' });
            this.cleanupStateOnly();
            this.showIncomingCall(call);
            setTimeout(() => this.acceptCall(), 200);
            return;
          } else {
            update(ref(db, `calls/${call.callId}`), { status: 'yield' });
            set(incomingRef, null);
            return;
          }
        }
      }

      if (this.activeCall && (this.activeCall.status === 'connected' || this.activeCall.status === 'connecting')) {
        update(ref(db, `calls/${call.callId}`), { status: 'busy' });
        return;
      }

      this.showIncomingCall(call);
    });
  }

  showIncomingCall(call) {
    const isVideo = call.type === 'video';
    this.activeCall = {
      callId: call.callId,
      callerId: call.callerId,
      callerName: call.callerName || 'Friend',
      callerPic: call.callerPic || '',
      fid: call.callerId,
      cid: call.cid || null,
      type: call.type || 'audio',
      isCaller: false,
      status: 'ringing',
      logged: false,
    };

    this.isSpeakerOn = isVideo; // Default video to speaker, audio to earpiece
    this.isFrontCamera = true;

    // Start native Android ringtone & vibration for incoming calls only (if enabled in settings)
    const settings = getNotificationSettings();
    if (settings.callsEnabled !== false && settings.callSound !== false) {
      try {
        InCallManager.stopRingback();
        InCallManager.startRingtone('_DEFAULT_');
      } catch (e) {}
    }

    if (this.ringTimeout) clearTimeout(this.ringTimeout);
    this.ringTimeout = setTimeout(() => {
      if (this.activeCall && this.activeCall.status === 'ringing') {
        update(ref(db, `calls/${call.callId}`), { status: 'missed' });
        this.cleanup();
      }
    }, 35000);

    this.notifySubscribers();
  }

  async startCall(fid, type = 'audio', cid = null) {
    const uid = auth.currentUser?.uid;
    if (!uid || !fid) return;

    if (this.activeCall) return;

    const callType = type;
    const isVideo = callType === 'video';
    const callKey = push(ref(db, 'calls')).key;

    const [friendSnap, mySnap] = await Promise.all([
      get(ref(db, `users/${fid}`)),
      get(ref(db, `users/${uid}`)),
    ]);

    const fData = friendSnap.exists() ? friendSnap.val() : {};
    const friendName = fData.name ? (Array.isArray(fData.name) ? fData.name.join(' ').trim() : fData.name) : (fData.username || 'Friend');
    const friendPic = fData.profile_picture || fData.profile_photo || '';

    const myData = mySnap.exists() ? mySnap.val() : {};
    const myName = myData.name ? (Array.isArray(myData.name) ? myData.name.join(' ').trim() : myData.name) : (myData.username || 'User');
    const myPic = myData.profile_picture || myData.profile_photo || '';

    this.isSpeakerOn = isVideo;
    this.isFrontCamera = true;

    this.activeCall = {
      callId: callKey,
      callerId: uid,
      receiverId: fid,
      fid,
      cid,
      friendName,
      friendPic,
      type: callType,
      isCaller: true,
      status: 'calling',
      logged: false,
    };

    // Telephony audio session: start ringback tone & audio routing for outgoing call
    try {
      InCallManager.stopRingtone(); // Ensure incoming ringtone is never playing
      InCallManager.start({ media: callType });
      InCallManager.startRingback('_DEFAULT_');
      InCallManager.setSpeakerphoneOn(this.isSpeakerOn);
      InCallManager.setKeepScreenOn(true);
    } catch (e) {}

    this.notifySubscribers();

    if (this.ringTimeout) clearTimeout(this.ringTimeout);
    this.ringTimeout = setTimeout(() => {
      if (this.activeCall && this.activeCall.status === 'calling') {
        update(ref(db, `calls/${callKey}`), { status: 'no_answer' });
        setTimeout(() => this.cleanup(), 1000);
      }
    }, 35000);

    try {
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: isVideo ? { facingMode: 'user', frameRate: 30 } : false,
      });
      this.localStream = stream;

      this.peerConnection = new RTCPeerConnection(ICE_SERVERS);

      stream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, stream);
      });

      this.peerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          this.remoteStream = event.streams[0];
          this.notifySubscribers();
        }
      };

      this.peerConnection.onconnectionstatechange = () => {
        if (!this.peerConnection) return;
        const st = this.peerConnection.connectionState;
        if (st === 'connected') {
          if (this.disconnectTimer) {
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = null;
          }
          this.isReconnecting = false;
          this.notifySubscribers();
        } else if (st === 'disconnected') {
          // Temporary network drop / NAT migration - give up to 10 seconds to auto-reconnect ICE
          this.isReconnecting = true;
          this.notifySubscribers();
          if (!this.disconnectTimer) {
            this.disconnectTimer = setTimeout(() => {
              if (this.activeCall && this.activeCall.status === 'connected') {
                this.cleanup();
              }
            }, 10000);
          }
        } else if (st === 'failed' || st === 'closed') {
          if (this.activeCall && this.activeCall.status === 'connected') {
            this.cleanup();
          }
        }
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          push(ref(db, `calls/${callKey}/callerCandidates`), event.candidate.toJSON());
        }
      };

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      await set(ref(db, `calls/${callKey}`), {
        callId: callKey,
        callerId: uid,
        receiverId: fid,
        type: callType,
        status: 'ringing',
        offer: { type: offer.type, sdp: offer.sdp },
        timestamp: Date.now(),
      });

      await set(ref(db, `users/${fid}/incoming_call`), {
        callId: callKey,
        callerId: uid,
        callerName: myName,
        callerPic: myPic,
        type: callType,
        cid,
        timestamp: Date.now(),
      });

      // Send wake-up push notification via Cloudflare Worker
      notifyIncomingCallPush(callKey, fid, callType, cid);

      this.listenToCallSession(callKey);
    } catch (e) {
      console.warn('Failed to start call:', e);
      this.cleanup();
    }
  }

  async acceptCall() {
    if (!this.activeCall || !this.activeCall.callId) return;

    if (this.ringTimeout) {
      clearTimeout(this.ringTimeout);
      this.ringTimeout = null;
    }

    try {
      InCallManager.stopRingtone();
      InCallManager.start({ media: this.activeCall.type });
      InCallManager.setSpeakerphoneOn(this.isSpeakerOn);
      InCallManager.setKeepScreenOn(true);
    } catch (e) {}

    this.activeCall.status = 'connecting';
    this.notifySubscribers();

    const callKey = this.activeCall.callId;

    try {
      const callSnap = await get(ref(db, `calls/${callKey}`));
      if (!callSnap.exists()) {
        this.cleanup();
        return;
      }

      const callData = callSnap.val();
      const callType = callData.type || 'audio';
      const isVideo = callType === 'video';

      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: isVideo ? { facingMode: 'user', frameRate: 30 } : false,
      });
      this.localStream = stream;

      this.peerConnection = new RTCPeerConnection(ICE_SERVERS);

      stream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, stream);
      });

      this.peerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          this.remoteStream = event.streams[0];
          this.notifySubscribers();
        }
      };

      this.peerConnection.onconnectionstatechange = () => {
        if (!this.peerConnection) return;
        const st = this.peerConnection.connectionState;
        if (st === 'connected') {
          if (this.disconnectTimer) {
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = null;
          }
          this.isReconnecting = false;
          this.notifySubscribers();
        } else if (st === 'disconnected') {
          // Temporary network drop / NAT migration - give up to 10 seconds to auto-reconnect ICE
          this.isReconnecting = true;
          this.notifySubscribers();
          if (!this.disconnectTimer) {
            this.disconnectTimer = setTimeout(() => {
              if (this.activeCall && this.activeCall.status === 'connected') {
                this.cleanup();
              }
            }, 10000);
          }
        } else if (st === 'failed' || st === 'closed') {
          if (this.activeCall && this.activeCall.status === 'connected') {
            this.cleanup();
          }
        }
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          push(ref(db, `calls/${callKey}/calleeCandidates`), event.candidate.toJSON());
        }
      };

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      await update(ref(db, `calls/${callKey}`), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: 'connected',
      });

      onValue(ref(db, `calls/${callKey}/callerCandidates`), (snap) => {
        const val = snap.val();
        if (val) {
          Object.values(val).forEach((cand) => {
            this.peerConnection?.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          });
        }
      });

      if (this.activeCall) this.activeCall.status = 'connected';
      const uid = auth.currentUser?.uid;
      if (uid) set(ref(db, `users/${uid}/incoming_call`), null);

      this.startTimer();
      this.listenToCallSession(callKey);
      this.notifySubscribers();
    } catch (e) {
      console.warn('Error accepting call:', e);
      this.cleanup();
    }
  }

  rejectCall() {
    if (this.ringTimeout) {
      clearTimeout(this.ringTimeout);
      this.ringTimeout = null;
    }
    if (this.activeCall?.callId) {
      update(ref(db, `calls/${this.activeCall.callId}`), { status: 'rejected' });
    }
    const uid = auth.currentUser?.uid;
    if (uid) set(ref(db, `users/${uid}/incoming_call`), null);
    this.cleanup();
  }

  endCall() {
    if (this.ringTimeout) {
      clearTimeout(this.ringTimeout);
      this.ringTimeout = null;
    }
    if (this.activeCall?.callId) {
      update(ref(db, `calls/${this.activeCall.callId}`), { status: 'ended' });
      if (this.activeCall.fid) {
        set(ref(db, `users/${this.activeCall.fid}/incoming_call`), null);
      }
    }
    this.cleanup();
  }

  listenToCallSession(callKey) {
    const callRef = ref(db, `calls/${callKey}`);
    if (this.currentCallListener) {
      off(callRef, 'value', this.currentCallListener);
    }

    this.currentCallListener = onValue(callRef, async (snap) => {
      const call = snap.val();
      if (!call) {
        this.cleanup();
        return;
      }

      if (this.activeCall?.isCaller && call.answer && !this.peerConnection?.currentRemoteDescription) {
        if (this.ringTimeout) {
          clearTimeout(this.ringTimeout);
          this.ringTimeout = null;
        }
        try { InCallManager.stopRingback(); } catch (e) {}
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(call.answer));

        onValue(ref(db, `calls/${callKey}/calleeCandidates`), (cSnap) => {
          const val = cSnap.val();
          if (val) {
            Object.values(val).forEach((cand) => {
              this.peerConnection?.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            });
          }
        });
      }

      if (call.status === 'connected') {
        if (this.ringTimeout) {
          clearTimeout(this.ringTimeout);
          this.ringTimeout = null;
        }
        try { InCallManager.stopRingback(); } catch (e) {}
        if (this.activeCall) this.activeCall.status = 'connected';
        this.startTimer();
        this.notifySubscribers();
      } else if (call.status === 'ringing') {
        if (this.activeCall && this.activeCall.isCaller && this.activeCall.status !== 'ringing') {
          this.activeCall.status = 'ringing';
          this.notifySubscribers();
        }
      } else if (call.status === 'rejected' || call.status === 'busy' || call.status === 'no_answer' || call.status === 'missed' || call.status === 'ended') {
        this.cleanup();
      } else if (call.status === 'yield') {
        this.cleanupStateOnly();
      }
    });
  }

  startTimer() {
    this.stopTimer();
    this.callDurationSec = 0;
    this.callTimer = setInterval(() => {
      this.callDurationSec++;
      this.notifySubscribers();
    }, 1000);
  }

  stopTimer() {
    if (this.callTimer) {
      clearInterval(this.callTimer);
      this.callTimer = null;
    }
  }

  // Toggle Mute Microphone
  toggleMute() {
    if (!this.localStream) return;
    const track = this.localStream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      this.isMuted = !track.enabled;
      try { InCallManager.setMicrophoneMute(this.isMuted); } catch (e) {}
      this.notifySubscribers();
    }
  }

  // Toggle Speakerphone / Earpiece / Bluetooth
  toggleSpeaker() {
    this.isSpeakerOn = !this.isSpeakerOn;
    try {
      InCallManager.setSpeakerphoneOn(this.isSpeakerOn);
      InCallManager.chooseAudioRoute(this.isSpeakerOn ? 'SPEAKER_PHONE' : 'EARPIECE');
    } catch (e) {}
    this.notifySubscribers();
  }

  // Flip Camera (Front / Back)
  switchCamera() {
    if (!this.localStream) return;
    const track = this.localStream.getVideoTracks()[0];
    if (track && typeof track._switchCamera === 'function') {
      track._switchCamera();
      this.isFrontCamera = !this.isFrontCamera;
      this.notifySubscribers();
    }
  }

  // Toggle Camera Video On/Off
  toggleVideo() {
    if (!this.localStream) return;
    const track = this.localStream.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      this.isVideoOff = !track.enabled;
      this.notifySubscribers();
    }
  }

  async recordCallSummary(callInfo, durationSec) {
    try {
      if (!callInfo || callInfo.logged || !callInfo.isCaller) return;
      callInfo.logged = true;

      const callerId = callInfo.callerId || auth.currentUser?.uid;
      const receiverId = callInfo.receiverId || callInfo.fid;
      const callType = callInfo.type || 'audio';
      let cid = callInfo.cid;

      if (!cid && callerId && receiverId) {
        const chatSnap = await get(ref(db, `chats/${callerId}/${receiverId}`));
        if (chatSnap.exists()) cid = chatSnap.val();
      }

      if (!cid || !callerId || !receiverId) return;

      const callStatus = durationSec > 0 ? 'completed' : (callInfo.status === 'rejected' ? 'declined' : 'missed');
      pushAndNotify(cid, {
        type: 'call',
        callType,
        callStatus,
        duration: durationSec || 0,
        send_from: callerId,
        send_to: receiverId,
        timestamp: serverTimestamp(),
        isSeenByReceiver: false,
        reply_of: null,
        style: null,
      });
    } catch (e) {
      console.warn('Failed recording call message:', e);
    }
  }

  cleanupStateOnly() {
    this.stopTimer();
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    this.isReconnecting = false;
    try {
      InCallManager.stop();
      InCallManager.stopRingback();
      InCallManager.stopRingtone();
    } catch (e) {}
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((t) => t.stop());
      this.remoteStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }

  cleanup() {
    const duration = this.callDurationSec || 0;
    const savedCall = this.activeCall ? { ...this.activeCall } : null;

    if (this.ringTimeout) {
      clearTimeout(this.ringTimeout);
      this.ringTimeout = null;
    }

    this.stopTimer();

    if (savedCall) {
      this.recordCallSummary(savedCall, duration);
    }

    this.cleanupStateOnly();

    if (this.activeCall?.callId) {
      off(ref(db, `calls/${this.activeCall.callId}`));
      off(ref(db, `calls/${this.activeCall.callId}/callerCandidates`));
      off(ref(db, `calls/${this.activeCall.callId}/calleeCandidates`));
    }

    const uid = auth.currentUser?.uid;
    if (uid) set(ref(db, `users/${uid}/incoming_call`), null);

    this.activeCall = null;
    this.isMuted = false;
    this.isVideoOff = false;
    this.isSpeakerOn = false;
    this.isFrontCamera = true;
    this.callDurationSec = 0;

    this.notifySubscribers();
  }
}

export const callManager = new MobileCallManager();
