import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, Dimensions, Platform, Animated, Easing, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTCView } from 'react-native-webrtc';
import { AppText } from './ui';
import { callManager } from '../services/call';
import { getNotificationSettings } from '../services/notifications';


const DEFAULT_AVATAR_BG = '#4b5058';

function AvatarImg({ pic, size, style }) {
  if (pic) return <Image source={{ uri: pic }} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#3a3f46' }, style]} />;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: DEFAULT_AVATAR_BG, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Ionicons name="person" size={size * 0.5} color="#f1f3f5" />
    </View>
  );
}

// Compact pill banner (like modern Android / iOS heads-up incoming call). Tap to open the full screen.
function IncomingBanner({ name, pic, isVideo, onExpand }) {
  const slide = useRef(new Animated.Value(-160)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: 0,
      useNativeDriver: true,
      damping: 14,
      stiffness: 140,
      mass: 0.8,
    }).start();

    // Subtle gentle pulse on answer button to draw attention
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const top = (Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 50) + 6;

  return (
    <View pointerEvents="box-none" style={styles.bannerHost}>
      <Animated.View style={[styles.banner, { marginTop: top, transform: [{ translateY: slide }] }]}>
        <TouchableOpacity activeOpacity={0.85} onPress={onExpand} style={styles.bannerBody}>
          <View style={styles.avatarWrap}>
            <AvatarImg pic={pic} size={48} />
            <View style={[styles.callTypeBadge, { backgroundColor: isVideo ? '#38bdf8' : '#22c55e' }]}>
              <Ionicons name={isVideo ? 'videocam' : 'call'} size={11} color="#fff" />
            </View>
          </View>
          <View style={{ flex: 1, marginLeft: 12, marginRight: 8, justifyContent: 'center' }}>
            <AppText style={styles.bannerTitle} numberOfLines={1}>{name}</AppText>
            <AppText style={styles.bannerSub} numberOfLines={1}>
              {isVideo ? 'Incoming video call...' : 'Incoming audio call...'}
            </AppText>
          </View>
        </TouchableOpacity>

        {/* Action Buttons */}
        <View style={styles.bannerActions}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.bannerBtn, styles.bannerDeclineBtn]}
            onPress={() => callManager.rejectCall()}
          >
            <Ionicons name="call" size={20} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>

          <Animated.View style={{ transform: [{ scale: pulse }] }}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.bannerBtn, styles.bannerAcceptBtn]}
              onPress={() => callManager.acceptCall()}
            >
              <Ionicons name={isVideo ? 'videocam' : 'call'} size={21} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

function IncomingCallScreen({ name, pic, isVideo, onCollapse }) {
  return (
    <View style={styles.incomingRoot}>
      <StatusBar barStyle="light-content" />
      {pic ? <Image source={{ uri: pic }} style={StyleSheet.absoluteFill} blurRadius={Platform.OS === 'ios' ? 50 : 30} resizeMode="cover" /> : null}
      <View style={[styles.incomingShade, !pic && { backgroundColor: '#14171c' }]} />
      <View style={styles.incomingTop}>
        {onCollapse ? (
          <TouchableOpacity onPress={onCollapse} style={styles.collapseBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-down" size={24} color="#fff" />
          </TouchableOpacity>
        ) : <View style={styles.collapseBtn} />}
        <AppText style={styles.brandText}>HelloCat {isVideo ? 'video' : 'voice'} call</AppText>
        <View style={styles.collapseBtn} />
      </View>
      <View style={styles.incomingMid}>
        <AvatarImg pic={pic} size={132} style={styles.incomingAvatar} />
        <AppText style={styles.incomingName} numberOfLines={2}>{name}</AppText>
        <AppText style={styles.incomingSub}>Incoming {isVideo ? 'video' : 'voice'} call</AppText>
      </View>
      <View style={styles.incomingBottom}>
        <View style={styles.btnCol}>
          <TouchableOpacity activeOpacity={0.8} style={[styles.bigBtn, { backgroundColor: '#e0141c' }]} onPress={() => callManager.rejectCall()}>
            <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>
          <AppText style={styles.bigLabel}>Decline</AppText>
        </View>
        <View style={styles.btnCol}>
          <TouchableOpacity activeOpacity={0.8} style={[styles.bigBtn, { backgroundColor: '#5cc43c' }]} onPress={() => callManager.acceptCall()}>
            <Ionicons name={isVideo ? 'videocam' : 'call'} size={30} color="#fff" />
          </TouchableOpacity>
          <AppText style={styles.bigLabel}>Accept</AppText>
        </View>
      </View>
    </View>
  );
}

export default function CallModal() {
  const [callState, setCallState] = useState(callManager.getState());
  const [expanded, setExpanded] = useState(false);
  const incomingId = callState.activeCall && callState.activeCall.callId;
  useEffect(() => { setExpanded(false); }, [incomingId]);
  useEffect(() => { if (callState.fullScreenRequested) setExpanded(true); }, [callState.fullScreenRequested, incomingId]);

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

  if (isIncoming) {
    const bannerOn = getNotificationSettings().callBanner !== false;
    if (bannerOn && !expanded) return <IncomingBanner name={name} pic={pic} isVideo={isVideo} onExpand={() => setExpanded(true)} />;
    return <View style={styles.overlay0}><IncomingCallScreen name={name} pic={pic} isVideo={isVideo} onCollapse={bannerOn ? () => setExpanded(false) : null} /></View>;
  }

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
  overlay0: { ...StyleSheet.absoluteFillObject, zIndex: 999999, backgroundColor: '#14171c' },
  bannerHost: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999999,
    paddingHorizontal: 12,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e2430',
    borderRadius: 36,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    elevation: 20,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  bannerBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    position: 'relative',
  },
  callTypeBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#1e2430',
  },
  bannerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  bannerSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  bannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  bannerAcceptBtn: {
    backgroundColor: '#22c55e',
  },
  bannerDeclineBtn: {
    backgroundColor: '#ef4444',
  },
  incomingRoot: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 64 },
  incomingShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12,14,18,0.78)' },
  incomingTop: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  collapseBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  brandText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  incomingMid: { alignItems: 'center', paddingHorizontal: 30 },
  incomingAvatar: { marginBottom: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  incomingName: { color: '#fff', fontSize: 30, fontWeight: '600', textAlign: 'center' },
  incomingSub: { color: 'rgba(255,255,255,0.6)', fontSize: 15, marginTop: 8 },
  incomingBottom: { width: '100%', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', paddingHorizontal: 40 },
  bigBtn: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  bigLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '500', marginTop: 10 },
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
