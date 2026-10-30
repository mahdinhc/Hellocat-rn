import React, { useState, useRef } from 'react';
import { ScrollView, View, Alert, KeyboardAvoidingView, Platform, TouchableOpacity, Image } from 'react-native';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail } from 'firebase/auth';
import { ref, get, set, update, serverTimestamp } from 'firebase/database';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, firestore } from '../firebase';
import { useAuth } from '../AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { NEW_USER_THEME } from '../theme/themes';
import { Screen, AppText, Button, Input } from '../components/ui';
import { validateUsername, validateName, autoUserID } from '../utils';
import { logHistory } from '../services/presence';

function AuthShell({ title, children }) {
  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 70, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Image source={require('../../assets/icon.png')} style={{ width: 84, height: 84, borderRadius: 20 }} />
            <AppText bold size={26} style={{ marginTop: 10 }}>HelloCat</AppText>
            <AppText muted style={{ marginTop: 4 }}>{title}</AppText>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export function SignInScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const pwRef = useRef(null);

  const login = async () => {
    let e = email.trim();
    if (!e || !password) return Alert.alert('Sign in', 'Enter your email and password.');
    if (!e.includes('@')) e += '@gmail.com'; // same shortcut as the web app
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, e, password);
      if (cred.user.emailVerified) logHistory(cred.user.uid, 'login', 'USER-SIGNIN');
    } catch (err) {
      Alert.alert('Sign in failed', err.message);
    }
    setLoading(false);
  };

  const forgot = async () => {
    let e = email.trim();
    if (!e) return Alert.alert('Reset password', 'Type your email address first.');
    if (!e.includes('@')) e += '@gmail.com';
    try {
      await sendPasswordResetEmail(auth, e);
      Alert.alert('Reset password', 'Password reset email sent. Check your inbox.');
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  return (
    <AuthShell title="Sign in to continue">
      <Input placeholder="Email" keyboardType="email-address" value={email} onChangeText={setEmail} returnKeyType="next" onSubmitEditing={() => pwRef.current && pwRef.current.focus()} />
      <Input ref={pwRef} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={login} />
      <Button title="Sign in" onPress={login} loading={loading} />
      <Button title="Forgot password?" secondary onPress={forgot} style={{ marginTop: 10 }} />
      <Button title="Create an account" secondary onPress={() => navigation.navigate('SignUp')} style={{ marginTop: 10 }} />
    </AuthShell>
  );
}

export function SignUpScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const signUp = async () => {
    if (!email.includes('@')) return Alert.alert('Sign up', 'Enter a valid email address.');
    if (password.length < 6) return Alert.alert('Sign up', 'Password must be at least 6 characters.');
    if (password !== confirm) return Alert.alert('Sign up', 'Passwords do not match.');
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await sendEmailVerification(cred.user);
      logHistory(cred.user.uid, 'login', 'USER-SIGNUP');
    } catch (err) {
      Alert.alert('Sign up failed', err.message);
    }
    setLoading(false);
  };

  return (
    <AuthShell title="Create your account">
      <Input placeholder="Email" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Input placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Input placeholder="Confirm password" secureTextEntry value={confirm} onChangeText={setConfirm} />
      <Button title="Sign up" onPress={signUp} loading={loading} />
      <Button title="I already have an account" secondary onPress={() => navigation.goBack()} style={{ marginTop: 10 }} />
    </AuthShell>
  );
}

export function VerifyEmailScreen() {
  const { user, reload, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    try {
      await sendEmailVerification(auth.currentUser);
      Alert.alert('Verification', 'Verification email sent again. Check your inbox (and spam).');
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };
  const check = async () => {
    setBusy(true);
    await reload();
    setBusy(false);
    if (auth.currentUser && !auth.currentUser.emailVerified) Alert.alert('Not verified yet', 'We could not see a verified email yet. Open the link in the email first.');
  };

  return (
    <AuthShell title="Verify your email">
      <AppText style={{ textAlign: 'center', marginBottom: 20 }}>
        We sent a verification link to {user ? user.email : 'your email'}. Open it, then come back and tap the button below.
      </AppText>
      <Button title="I've verified my email" onPress={check} loading={busy} />
      <Button title="Resend email" secondary onPress={resend} style={{ marginTop: 10 }} />
      <Button title="Sign out" secondary onPress={signOut} style={{ marginTop: 10 }} />
    </AuthShell>
  );
}

export function CreateProfileScreen() {
  const { uid, evaluate } = useAuth();
  const { theme } = useTheme();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [username, setUsername] = useState('');
  const [uState, setUState] = useState({ ok: false, msg: '', color: undefined });
  const [birth, setBirth] = useState('');
  const [gender, setGender] = useState('other');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  const onUsername = (t) => {
    setUsername(t);
    clearTimeout(timer.current);
    const u = t.trim();
    if (!validateUsername(u)) {
      setUState({ ok: false, msg: 'Username: 1-30 characters, letters, numbers, underscore and hyphen only.', color: '#e5484d' });
      return;
    }
    setUState({ ok: false, msg: 'Checking availability...', color: theme.link });
    timer.current = setTimeout(async () => {
      try {
        const s = await get(ref(db, 'username/' + u));
        if (s.exists()) setUState({ ok: false, msg: 'Username is already taken.', color: '#e5484d' });
        else setUState({ ok: true, msg: 'Username is available!', color: '#2faa5a' });
      } catch (e) {
        setUState({ ok: false, msg: 'Could not check username.', color: '#e5484d' });
      }
    }, 500);
  };

  const valid = validateName(first.trim()) && (last.trim() === '' || validateName(last.trim())) && uState.ok && bio.trim().length > 3;

  const submit = async () => {
    setLoading(true);
    try {
      const firstName = first.trim();
      const lastName = last.trim();
      let uname = username.trim();
      const base = { name: [firstName, lastName], birth: birth.trim(), gender, bio: bio.trim() };

      await setDoc(doc(firestore, 'users', uid), base);
      await set(ref(db, 'users/' + uid), { ...base, accountCreated: serverTimestamp(), theme: NEW_USER_THEME });

      const taken = await get(ref(db, 'username/' + uname));
      if (taken.exists()) {
        const old = uname;
        uname = autoUserID(firstName, lastName);
        Alert.alert('Username taken', `"${old}" was just taken. We set your username to "${uname}".`);
      }
      await set(ref(db, 'username/' + uname), uid);
      await update(ref(db, 'users/' + uid), { username: uname });
      await updateDoc(doc(firestore, 'users', uid), { username: uname });

      await evaluate(auth.currentUser);
    } catch (err) {
      Alert.alert('Could not create profile', err.message);
    }
    setLoading(false);
  };

  const Chip = ({ v, label }) => (
    <TouchableOpacity onPress={() => setGender(v)} style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginRight: 8, backgroundColor: gender === v ? theme.buttonBg : theme.inputBg }}>
      <AppText style={{ color: gender === v ? theme.buttonText : theme.inputText }}>{label}</AppText>
    </TouchableOpacity>
  );

  return (
    <AuthShell title="Fill up your information">
      <Input placeholder="First name" maxLength={18} value={first} onChangeText={setFirst} autoCapitalize="words" />
      <Input placeholder="Last name (optional)" maxLength={18} value={last} onChangeText={setLast} autoCapitalize="words" />
      <Input placeholder="Username" maxLength={29} value={username} onChangeText={onUsername} />
      {uState.msg ? <AppText size={12} style={{ color: uState.color, marginTop: -6, marginBottom: 10 }}>{uState.msg}</AppText> : null}
      <Input placeholder="Birth date (YYYY-MM-DD)" value={birth} onChangeText={setBirth} keyboardType="numbers-and-punctuation" />
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        <Chip v="male" label="Male" /><Chip v="female" label="Female" /><Chip v="other" label="Other" />
      </View>
      <Input placeholder="Bio (at least 4 characters)" value={bio} onChangeText={setBio} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
      <Button title="Create profile" onPress={submit} disabled={!valid} loading={loading} />
    </AuthShell>
  );
}
