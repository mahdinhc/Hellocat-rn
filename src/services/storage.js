// Unified Storage Service for HelloCat Android (React Native)
// Supports both Firebase Storage and ImageKit.io REST upload.
// Storage provider choice is persisted via AsyncStorage ('firebase' | 'imagekit').

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref as sref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { randomString } from '../utils';

const STORAGE_PROVIDER_KEY = 'hellocat_storage_provider';

export const IMAGEKIT_CONFIG = {
  publicKey: 'public_wkUkn/lILk+zbcbZABjjlMP9nDI=',
  urlEndpoint: 'https://ik.imagekit.io/miacceshc',
  authenticationEndpoint: 'https://hellocat-push.mahdinh2077.workers.dev/imagekit-auth',
};

// Returns 'imagekit' by default (bypassing Firebase 402 Spark tier restrictions)
export async function getStorageProvider() {
  try {
    const val = await AsyncStorage.getItem(STORAGE_PROVIDER_KEY);
    return (val === 'firebase' || val === 'imagekit') ? val : 'imagekit';
  } catch (e) {
    return 'imagekit';
  }
}

export async function setStorageProvider(provider) {
  try {
    if (provider === 'firebase' || provider === 'imagekit') {
      await AsyncStorage.setItem(STORAGE_PROVIDER_KEY, provider);
    }
  } catch (e) {}
}

async function fetchImageKitAuth() {
  const res = await fetch(IMAGEKIT_CONFIG.authenticationEndpoint);
  if (!res.ok) throw new Error('ImageKit auth error: ' + res.status);
  return res.json();
}

/**
 * Upload to ImageKit.io via REST upload API
 * @param {string} localUri - Local file URI (file://...)
 * @param {string} fileName - File name
 * @param {string} folder - Target folder path on ImageKit
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} Download URL
 */
async function uploadToImageKit(localUri, fileName, folder, contentType) {
  const auth = await fetchImageKitAuth();
  const cleanFolder = folder.startsWith('/') ? folder : '/' + folder;

  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    type: contentType || 'application/octet-stream',
    name: fileName,
  });
  formData.append('fileName', fileName);
  formData.append('publicKey', IMAGEKIT_CONFIG.publicKey);
  formData.append('token', auth.token);
  formData.append('expire', String(auth.expire));
  formData.append('signature', auth.signature);
  formData.append('folder', cleanFolder);
  formData.append('useUniqueFileName', 'false');

  const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    body: formData,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || 'ImageKit upload failed');
  }
  return json.url;
}

/**
 * Upload to Firebase Storage
 * @param {string} localUri - Local file URI
 * @param {string} fullPath - Full path in Firebase Storage
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} Download URL
 */
async function uploadToFirebase(localUri, fullPath, contentType) {
  const blob = await (await fetch(localUri)).blob();
  const r = sref(storage, fullPath);
  await uploadBytes(r, blob, contentType ? { contentType } : undefined);
  return getDownloadURL(r);
}

/**
 * Unified file upload function
 * Automatically uses active provider (ImageKit or Firebase)
 */
export async function uploadFile(localUri, options = {}) {
  const {
    path = 'uploads',
    fileName = `file_${Date.now()}`,
    contentType = 'application/octet-stream',
  } = options;

  const provider = await getStorageProvider();
  if (provider === 'firebase') {
    const fullPath = (path.endsWith('/') ? path : path + '/') + fileName;
    return uploadToFirebase(localUri, fullPath, contentType);
  } else {
    return uploadToImageKit(localUri, fileName, path, contentType);
  }
}

/**
 * Chat file upload helper
 */
export async function uploadChatAsset(uid, asset) {
  const name = asset.fileName || asset.name || `file_${Date.now()}`;
  const path = `0xab/${uid}/${randomString(12)}`;
  const url = await uploadFile(asset.uri, {
    path,
    fileName: name,
    contentType: asset.mimeType,
  });
  return { url, name };
}
