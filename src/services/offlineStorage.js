// Offline storage cache for Hellocat (AsyncStorage backed)
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHATS_CACHE_PREFIX = 'hellocat_cache_chats_';
const MESSAGES_CACHE_PREFIX = 'hellocat_cache_msgs_';
const BLOGS_CACHE_KEY = 'hellocat_cache_blogs';

// Save user conversation list
export async function cacheUserChats(uid, chats) {
  if (!uid || !chats) return;
  try {
    await AsyncStorage.setItem(CHATS_CACHE_PREFIX + uid, JSON.stringify(chats));
  } catch (e) {
    // ignore
  }
}

// Get cached conversation list
export async function getCachedUserChats(uid) {
  if (!uid) return null;
  try {
    const raw = await AsyncStorage.getItem(CHATS_CACHE_PREFIX + uid);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Save messages for a specific chat
export async function cacheChatMessages(cid, messages) {
  if (!cid || !Array.isArray(messages)) return;
  try {
    await AsyncStorage.setItem(MESSAGES_CACHE_PREFIX + cid, JSON.stringify(messages.slice(-100)));
  } catch (e) {
    // ignore
  }
}

// Get cached messages for a specific chat
export async function getCachedChatMessages(cid) {
  if (!cid) return null;
  try {
    const raw = await AsyncStorage.getItem(MESSAGES_CACHE_PREFIX + cid);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Save blog posts
export async function cacheBlogPosts(posts) {
  if (!Array.isArray(posts)) return;
  try {
    await AsyncStorage.setItem(BLOGS_CACHE_KEY, JSON.stringify(posts.slice(0, 50)));
  } catch (e) {
    // ignore
  }
}

// Get cached blog posts
export async function getCachedBlogPosts() {
  try {
    const raw = await AsyncStorage.getItem(BLOGS_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
