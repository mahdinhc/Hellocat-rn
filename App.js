import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { AuthProvider, useAuth } from './src/AuthContext';
import { Loading } from './src/components/ui';
import ErrorBoundary from './src/components/ErrorBoundary';
import { safeRef, safeOnValue, reportError } from './src/safe';
import { startMessageNotifications, listenForNotificationTaps, loadNotificationSettings } from './src/services/notifications';

import { SignInScreen, SignUpScreen, VerifyEmailScreen, CreateProfileScreen } from './src/screens/AuthScreens';
import ChatsScreen from './src/screens/ChatsScreen';
import ChatScreen from './src/screens/ChatScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import BlogsScreen from './src/screens/BlogsScreen';
import BlogViewScreen from './src/screens/BlogViewScreen';
import CreatePostScreen from './src/screens/CreatePostScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { SettingsScreen, SettingsProfileScreen, SettingsAccountScreen, SettingsThemeScreen, SettingsHistoryScreen, SettingsNotificationsScreen } from './src/screens/SettingsScreens';

SplashScreen.preventAutoHideAsync().catch(() => {});

// ---- crash protection -------------------------------------------------------------------------------
// Any uncaught JS error (event handler, timer, listener callback ...) is logged instead of killing the app.
// Render-time errors are caught by the ErrorBoundary components.
try {
  const prev = global.ErrorUtils && global.ErrorUtils.getGlobalHandler && global.ErrorUtils.getGlobalHandler();
  if (global.ErrorUtils && global.ErrorUtils.setGlobalHandler) {
    global.ErrorUtils.setGlobalHandler((error, isFatal) => {
      reportError(error, isFatal ? 'fatal' : 'error');
      // swallow in release builds (the app keeps running); keep the red box while developing
      if (__DEV__ && prev) prev(error, isFatal);
    });
  }
} catch (e) { /* ignore */ }

const navigationRef = createNavigationContainerRef();
let pendingChat = null;
const openChat = (p) => {
  if (navigationRef.isReady()) { try { navigationRef.navigate('Chat', p); } catch (e) { reportError(e, 'open-chat'); } } else pendingChat = p;
};

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function useHeaderOptions() {
  const { theme } = useTheme();
  return {
    headerStyle: { backgroundColor: theme.primary },
    headerTintColor: theme.primaryText,
    headerTitleStyle: { fontFamily: 'Nunito-Black' },
  };
}

function Tabs() {
  const { theme } = useTheme();
  const { uid } = useAuth();
  const header = useHeaderOptions();
  const [reqs, setReqs] = useState(0);
  useEffect(() => {
    const r = safeRef('friend_req', 'recieved', uid);
    if (!r) return undefined;
    return safeOnValue(r, (s) => setReqs(s.numChildren()));
  }, [uid]);

  const icons = { Chats: 'chatbubbles', Posts: 'newspaper', Friends: 'people', Me: 'person-circle' };
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        ...header,
        tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name]} size={size} color={color} />,
        tabBarActiveTintColor: theme.link,
        tabBarInactiveTintColor: theme.navText,
        tabBarStyle: { backgroundColor: theme.navBg, borderTopColor: theme.dark ? '#ffffff15' : '#00000012' },
        tabBarLabelStyle: { fontFamily: 'Nunito-Regular' },
        tabBarBadgeStyle: { backgroundColor: theme.badge },
      })}
    >
      <Tab.Screen name="Chats" component={ChatsScreen} options={{ title: 'HelloCat' }} />
      <Tab.Screen name="Posts" component={BlogsScreen} />
      <Tab.Screen name="Friends" component={FriendsScreen} options={{ tabBarBadge: reqs > 0 ? reqs : undefined }} />
      <Tab.Screen name="Me" component={ProfileScreen} options={{ title: 'My profile' }} />
    </Tab.Navigator>
  );
}

function MainStack() {
  const { theme } = useTheme();
  const header = useHeaderOptions();
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ headerStyle: { backgroundColor: theme.chatHeadBg }, headerTintColor: theme.chatHeadText, title: '' }}
      />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Stack.Screen name="BlogView" component={BlogViewScreen} options={{ title: 'Post' }} />
      <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'New post' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="SettingsProfile" component={SettingsProfileScreen} options={{ title: 'Edit profile' }} />
      <Stack.Screen name="SettingsAccount" component={SettingsAccountScreen} options={{ title: 'Account' }} />
      <Stack.Screen name="SettingsNotifications" component={SettingsNotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="SettingsTheme" component={SettingsThemeScreen} options={{ title: 'Theme' }} />
      <Stack.Screen name="SettingsHistory" component={SettingsHistoryScreen} options={{ title: 'Login history' }} />
    </Stack.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
    </Stack.Navigator>
  );
}

// Runs while a user is signed in: raises a system notification for new incoming messages.
function NotificationManager() {
  const { uid } = useAuth();
  useEffect(() => {
    if (!uid) return undefined;
    let stop = () => {};
    try { stop = startMessageNotifications(uid); } catch (e) { reportError(e, 'notifications'); }
    return () => { try { stop(); } catch (e) { /* ignore */ } };
  }, [uid]);
  useEffect(() => listenForNotificationTaps(openChat), []);
  return null;
}

function Root() {
  const { status } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') return <AuthStack />;
  if (status === 'unverified') return <VerifyEmailScreen />;
  if (status === 'noProfile') return <CreateProfileScreen />;
  return (
    <>
      <NotificationManager />
      <MainStack />
    </>
  );
}

function Themed() {
  const { theme } = useTheme();
  const base = theme.dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: theme.link, background: theme.bg, card: theme.navBg, text: theme.text, border: theme.dark ? '#ffffff15' : '#00000012', notification: theme.badge },
  };
  return (
    <NavigationContainer
      theme={navTheme}
      ref={navigationRef}
      onReady={() => { if (pendingChat) { const p = pendingChat; pendingChat = null; openChat(p); } }}
    >
      <StatusBar style="light" />
      <AuthProvider>
        <ErrorBoundary name="root">
          <Root />
        </ErrorBoundary>
      </AuthProvider>
    </NavigationContainer>
  );
}

export default function App() {
  const [loaded, fontError] = useFonts({
    'Nunito-Regular': require('./assets/fonts/Nunito-Regular.ttf'),
    'Nunito-Black': require('./assets/fonts/Nunito-Black.ttf'),
    'Cinzel-Regular': require('./assets/fonts/Cinzel-Regular.ttf'),
  });
  useEffect(() => { loadNotificationSettings().catch(() => {}); }, []);
  // never block the app on a font problem: show it with system fonts after a short wait
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => { const t = setTimeout(() => setFontTimeout(true), 4000); return () => clearTimeout(t); }, []);
  const ready = loaded || fontError || fontTimeout;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
    <ErrorBoundary name="app">
      <SafeAreaProvider>
        <ThemeProvider>
          <Themed />
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
