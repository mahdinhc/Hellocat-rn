import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getAuth, getReactNativePersistence } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Same Firebase project as the HelloCat web app, so accounts, chats and posts are shared.
const firebaseConfig = {
  apiKey: 'AIzaSyCRoTx-p0r3DcU2TbeCG1csftOPGR76Ds4',
  authDomain: 'hellocat-app.firebaseapp.com',
  databaseURL: 'https://hellocat-app-default-rtdb.firebaseio.com',
  projectId: 'hellocat-app',
  storageBucket: 'hellocat-app.appspot.com',
  messagingSenderId: '681807782381',
  appId: '1:681807782381:web:23fc06f0d58c6dfd0787e4',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let auth;
try {
  auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch (e) {
  auth = getAuth(app);
}

export { app, auth };
export const db = getDatabase(app);
export const firestore = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
export const storage = getStorage(app);
export const APP_VERSION = 'HELLOCAT_APP-v1.0.0';
