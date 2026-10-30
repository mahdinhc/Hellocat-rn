import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { auth, db } from './firebase';
import { startPresence, setOffline, logHistory } from './services/presence';
import { useTheme } from './theme/ThemeContext';
import { invalidateUser } from './services/users';
import { normalizeUser, reportError } from './safe';

// status: 'loading' | 'signedOut' | 'unverified' | 'noProfile' | 'ready'
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { applyTheme } = useTheme();
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const stopPresence = useRef(null);
  const themeApplied = useRef(false);

  const evaluate = useCallback(async (u) => {
    if (!u) {
      setUser(null); setProfile(null); setStatus('signedOut');
      return;
    }
    setUser(u);
    if (!u.emailVerified) { setStatus('unverified'); return; }
    try {
      const snap = await get(ref(db, 'users/' + u.uid));
      if (snap.exists()) {
        const val = normalizeUser(snap.val()) || {};
        setProfile(val);
        if (!themeApplied.current && val.theme) { applyTheme(val.theme); themeApplied.current = true; }
        setStatus('ready');
      } else {
        setProfile(null);
        setStatus('noProfile');
      }
    } catch (e) {
      reportError(e, 'evaluate-profile');
      setStatus('noProfile');
    }
  }, [applyTheme]);

  useEffect(() => onAuthStateChanged(auth, (u) => { evaluate(u).catch((e) => reportError(e, 'auth-state')); }), [evaluate]);

  // presence while ready
  useEffect(() => {
    if (status === 'ready' && user) {
      stopPresence.current = startPresence(user.uid);
      logHistory(user.uid, 'activity');
      return () => { if (stopPresence.current) stopPresence.current(); };
    }
    return undefined;
  }, [status, user]);

  const reload = useCallback(async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    await evaluate(auth.currentUser);
  }, [evaluate]);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return;
    invalidateUser(auth.currentUser.uid);
    const snap = await get(ref(db, 'users/' + auth.currentUser.uid));
    if (snap.exists()) setProfile(normalizeUser(snap.val()) || {});
  }, []);

  const signOut = useCallback(async () => {
    const uid = auth.currentUser && auth.currentUser.uid;
    themeApplied.current = false;
    if (uid) await setOffline(uid);
    await fbSignOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, profile, uid: user ? user.uid : null, reload, refreshProfile, signOut, evaluate }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
