import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, Dimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTCView } from 'react-native-webrtc';
import { AppText } from './ui';
import { callManager } from '../services/call';

export default function CallModal() {
  const [callState, setCallState] = useState(callManager.getState());

  useEffect(() => {
    return callManager.subscribe((state) => {
      setCallState({ ...state });
    });
  }, []);

  const activeCall = callState.activeCall;
  if (!activeCall) return null;

  const isVideo = activeCall.type === 'video';
  const isConnected = activeCall.status === 'connected';
  const isIncoming = !activeCall.isCaller && activeCall.status === 'ringing';

  const formatTimer = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const name = activeCall.friendName || activeCall.callerName || 'Friend';
  const pic = activeCall.friendPic || activeCall.callerPic;

  return (
    <View style={styles.overlay}>
      {/* Top Bar with Timer and Speaker status */}
      <View style={styles.topBar}>
        <AppText style={styles.appName}>HELLOCAT CALL</AppText>
        {isConnected && !callState.isReconnecting && (
          <View style={styles.timerBadge}>
            <AppText style={styles.timerText}>{formatTimer(callState.callDurationSec)}</AppText>
          </View>
        )}
        {callState.isReconnecting && (
          <View style={[styles.timerBadge, { backgroundColor: '#eab308' }]}>
            <AppText style={styles.timerText}>Reconnecting...</AppText>
          </View>
        )}
      </View>

      {/* Main Stream or Avatar Content */}
      {isVideo && isConnected && callState.remoteStream ? (
        <View style={styles.videoContainer}>
          <RTCView
            streamURL={callState.remoteStream.toURL()}
            style={styles.remoteVideo}
            objectFit="cover"
          />
          {callState.localStream && !callState.isVideoOff && (
            <View style={styles.localVideoContainer}>
              <RTCView
                streamURL={callState.localStream.toURL()}
                style={styles.localVideo}
                objectFit="cover"
                zOrder={1}
              />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.avatarContainer}>
          <View style={styles.avatarRing}>
            <Image
              source={pic ? { uri: pic } : require('../../assets/blank-profile.png')}
              style={styles.avatar}
            />
          </View>
          <AppText style={styles.userName} numberOfLines={1}>
            {name}
          </AppText>
          <AppText style={styles.statusText}>
            {callState.isReconnecting
              ? 'Reconnecting...'
              : isIncoming
              ? `Incoming ${isVideo ? 'Video' : 'Audio'} Call...`
              : activeCall.status === 'calling'
              ? 'Calling...'
              : activeCall.status === 'ringing'
              ? 'Ringing...'
              : activeCall.status === 'connecting'
              ? 'Connecting...'
              : 'Connected'}
          </AppText>
        </View>
      )}

      {/* Action Controls */}
      <View style={styles.actionsBar}>
        {isIncoming ? (
          <View style={styles.incomingActions}>
            <View style={styles.btnCol}>
              <TouchableOpacity
                style={[styles.roundBtn, styles.declineBtn]}
                onPress={() => callManager.rejectCall()}
              >
                <Ionicons name="close" size={30} color="#fff" />
              </TouchableOpacity>
              <AppText style={styles.btnLabel}>Decline</AppText>
            </View>

            <View style={styles.btnCol}>
              <TouchableOpacity
                style={[styles.roundBtn, styles.acceptBtn]}
                onPress={() => callManager.acceptCall()}
              >
                <Ionicons name="call" size={28} color="#fff" />
              </TouchableOpacity>
              <AppText style={styles.btnLabel}>Accept</AppText>
            </View>
          </View>
        ) : (
          <View style={styles.controlsGrid}>
            {/* Top row in-call controls */}
            <View style={styles.topControlRow}>
              {/* Mic toggle */}
              <View style={styles.btnCol}>
                <TouchableOpacity
                  style={[styles.roundBtn, styles.controlBtn, callState.isMuted && styles.activeControlBtn]}
                  onPress={() => callManager.toggleMute()}
                >
                  <Ionicons
                    name={callState.isMuted ? 'mic-off' : 'mic'}
                    size={24}
                    color="#fff"
                  />
                </TouchableOpacity>
                <AppText style={styles.btnLabel}>{callState.isMuted ? 'Unmute' : 'Mute'}</AppText>
              </View>

              {/* Speaker / Earpiece / Bluetooth audio toggle */}
              <View style={styles.btnCol}>
                <TouchableOpacity
                  style={[styles.roundBtn, styles.controlBtn, callState.isSpeakerOn && styles.activeControlBtn]}
                  onPress={() => callManager.toggleSpeaker()}
                >
                  <Ionicons
                    name={callState.isSpeakerOn ? 'volume-high' : 'volume-medium'}
                    size={24}
                    color="#fff"
                  />
                </TouchableOpacity>
                <AppText style={styles.btnLabel}>{callState.isSpeakerOn ? 'Speaker' : 'Earpiece'}</AppText>
              </View>

              {/* Camera Flip (Video mode) */}
              {isVideo && (
                <View style={styles.btnCol}>
                  <TouchableOpacity
                    style={[styles.roundBtn, styles.controlBtn]}
                    onPress={() => callManager.switchCamera()}
                  >
                    <Ionicons name="camera-reverse" size={24} color="#fff" />
                  </TouchableOpacity>
                  <AppText style={styles.btnLabel}>Flip</AppText>
                </View>
              )}

              {/* Video toggle (Camera On/Off) */}
              {isVideo && (
                <View style={styles.btnCol}>
                  <TouchableOpacity
                    style={[styles.roundBtn, styles.controlBtn, callState.isVideoOff && styles.activeControlBtn]}
                    onPress={() => callManager.toggleVideo()}
                  >
                    <Ionicons
                      name={callState.isVideoOff ? 'videocam-off' : 'videocam'}
                      size={24}
                      color="#fff"
                    />
                  </TouchableOpacity>
                  <AppText style={styles.btnLabel}>{callState.isVideoOff ? 'Camera Off' : 'Camera On'}</AppText>
                </View>
              )}
            </View>

            {/* Hangup button */}
            <View style={styles.hangupRow}>
              <TouchableOpacity
                style={[styles.roundBtn, styles.hangupBtn]}
                onPress={() => callManager.endCall()}
              >
                <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0f172a',
    zIndex: 999999,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Platform.OS === 'ios' ? 50 : 30,
    paddingHorizontal: 20,
  },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
  },
  timerBadge: {
    backgroundColor: '#1e293b',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  timerText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
  },
  avatarContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  avatarRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#38bdf8',
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 114,
    height: 114,
    borderRadius: 57,
    backgroundColor: '#1e293b',
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginTop: 18,
    marginBottom: 6,
  },
  statusText: {
    fontSize: 15,
    color: '#94a3b8',
  },
  videoContainer: {
    flex: 1,
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    marginVertical: 15,
    backgroundColor: '#020617',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
  },
  localVideoContainer: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: width * 0.28,
    height: width * 0.38,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#38bdf8',
    backgroundColor: '#0f172a',
  },
  localVideo: {
    width: '100%',
    height: '100%',
  },
  actionsBar: {
    width: '100%',
    alignItems: 'center',
    paddingBottom: 15,
  },
  incomingActions: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  controlsGrid: {
    width: '100%',
    alignItems: 'center',
    gap: 22,
  },
  topControlRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  hangupRow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCol: {
    alignItems: 'center',
  },
  roundBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangupBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ef4444',
    elevation: 4,
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  btnLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
  },
  acceptBtn: {
    backgroundColor: '#22c55e',
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  declineBtn: {
    backgroundColor: '#ef4444',
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  controlBtn: {
    backgroundColor: '#1e293b',
  },
  activeControlBtn: {
    backgroundColor: '#38bdf8',
  },
});
