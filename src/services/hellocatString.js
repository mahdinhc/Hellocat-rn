import React from 'react';
import { Text, Linking, Image, View } from 'react-native';

/**
 * Hellocat-String parser for React Native.
 * Matches web patterns from hcstring.js:
 *  - Bold: **text**
 *  - Underline: *_text_*
 *  - Italic: *~text~*
 *  - Strike: *-text-*
 *  - Hashtag: #tag
 *  - User mention: @user
 *  - Web Link: https://...
 *  - Emojis / Extramoji: :emoji_name: or :u1f602:
 *  - Embedded Image: %img%url%img%
 */

// Basic emoji converter for unicode codes (e.g. u1f602 -> 😂)
export function parseEmojiCode(name) {
  if (!name) return '';
  if (name.startsWith('u')) {
    try {
      const cp = parseInt(name.slice(1), 16);
      if (!isNaN(cp)) return String.fromCodePoint(cp);
    } catch (e) {}
  }
  return `:${name}:`;
}

// Regex matching all Hellocat-String format tokens
const HC_REGEX = /(\*\*[^\r\n]+?\*\*|\*_[^\r\n]+?_\*|\*~[^\r\n]+?~\*|\*-[^\r\n]+?-\*|%img%[^\r\n]+?%img%|https?:\/\/[^\s]+|#[a-zA-Z0-9_\u0080-\uFFFF-]+|@[a-zA-Z0-9_-]+|:[a-zA-Z0-9_+-]+:)/g;

export function renderHellocatString(text, options = {}) {
  const {
    linkStyle = {},
    hashtagStyle = {},
    userStyle = {},
    boldStyle = { fontWeight: 'bold' },
    italicStyle = { fontStyle: 'italic' },
    underlineStyle = { textDecorationLine: 'underline' },
    strikeStyle = { textDecorationLine: 'line-through' },
    onPressUser = null,
    onPressHashtag = null,
    textColor = undefined,
  } = options;

  if (typeof text !== 'string') text = String(text || '');

  const parts = text.split(HC_REGEX);

  return parts.map((part, index) => {
    if (!part) return null;

    // Bold **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <Text key={index} style={boldStyle}>
          {renderHellocatString(part.slice(2, -2), { ...options, boldStyle })}
        </Text>
      );
    }

    // Underline *_text_*
    if (part.startsWith('*_') && part.endsWith('_*') && part.length >= 4) {
      return (
        <Text key={index} style={underlineStyle}>
          {renderHellocatString(part.slice(2, -2), { ...options, underlineStyle })}
        </Text>
      );
    }

    // Italic *~text~*
    if (part.startsWith('*~') && part.endsWith('~*') && part.length >= 4) {
      return (
        <Text key={index} style={italicStyle}>
          {renderHellocatString(part.slice(2, -2), { ...options, italicStyle })}
        </Text>
      );
    }

    // Strike *-text-*
    if (part.startsWith('*-') && part.endsWith('-*') && part.length >= 4) {
      return (
        <Text key={index} style={strikeStyle}>
          {renderHellocatString(part.slice(2, -2), { ...options, strikeStyle })}
        </Text>
      );
    }

    // Web URLs
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return (
        <Text
          key={index}
          style={[{ textDecorationLine: 'underline', color: '#5d8ffc' }, linkStyle]}
          onPress={() => Linking.openURL(part).catch(() => {})}
        >
          {part}
        </Text>
      );
    }

    // Hashtags
    if (/^#[a-zA-Z0-9_\u0080-\uFFFF-]+$/.test(part)) {
      return (
        <Text
          key={index}
          style={[{ color: '#5d8ffc', fontWeight: '500' }, hashtagStyle]}
          onPress={() => onPressHashtag && onPressHashtag(part)}
        >
          {part}
        </Text>
      );
    }

    // User tags @username
    if (/^@[a-zA-Z0-9_-]+$/.test(part)) {
      return (
        <Text
          key={index}
          style={[{ color: '#5d8ffc', fontWeight: '600' }, userStyle]}
          onPress={() => onPressUser && onPressUser(part.slice(1))}
        >
          {part}
        </Text>
      );
    }

    // Emojis :emoji_code:
    if (/^:[a-zA-Z0-9_+-]+:$/.test(part)) {
      const code = part.slice(1, -1);
      const char = parseEmojiCode(code);
      return (
        <Text key={index}>
          {char}
        </Text>
      );
    }

    // Embedded %img%url%img%
    if (part.startsWith('%img%') && part.endsWith('%img%') && part.length >= 10) {
      const imgUrl = part.slice(5, -5).trim();
      return (
        <Image
          key={index}
          source={{ uri: imgUrl }}
          style={{ width: 180, height: 180, borderRadius: 8, marginVertical: 4 }}
          resizeMode="cover"
        />
      );
    }

    // Regular plain text
    return (
      <Text key={index} style={textColor ? { color: textColor } : undefined}>
        {part}
      </Text>
    );
  });
}
