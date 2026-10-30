import React from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { userDisplayName } from '../utils';
import { safeUri } from '../safe';

export function Screen({ children, style }) {
  const { theme } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: theme.bg }, style]}>{children}</View>;
}

const renderable = (c) => {
  if (c == null || typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') return c;
  if (React.isValidElement(c)) return c;
  if (Array.isArray(c)) return c.map((x, i) => (React.isValidElement(x) ? React.cloneElement(x, { key: x.key != null ? x.key : i }) : renderable(x)));
  return '';
};

export function AppText({ children, style, muted, bold, size, ...rest }) {
  const { theme } = useTheme();
  return (
    <Text
      {...rest}
      style={[{ color: theme.text, fontFamily: bold ? 'Nunito-Black' : 'Nunito-Regular', fontSize: size || 15 }, muted && { opacity: 0.6 }, style]}
    >
      {renderable(children)}
    </Text>
  );
}

export function Button({ title, onPress, loading, disabled, secondary, danger, style, small }) {
  const { theme } = useTheme();
  const bg = danger ? '#e5484d' : secondary ? 'transparent' : theme.buttonBg;
  const fg = secondary ? theme.link : theme.buttonText;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        styles.btn,
        small && { paddingVertical: 7, paddingHorizontal: 14 },
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1 },
        secondary && { borderWidth: 1, borderColor: theme.link },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: danger ? '#fff' : fg, fontFamily: 'Nunito-Black', fontSize: small ? 13 : 15 }}>{title}</Text>}
    </TouchableOpacity>
  );
}

export const Input = React.forwardRef(function Input({ style, ...props }, ref) {
  const { theme } = useTheme();
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={theme.inputText + '99'}
      autoCapitalize="none"
      {...props}
      style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText, borderColor: theme.dark ? '#ffffff20' : '#00000015', fontFamily: 'Nunito-Regular' }, style]}
    />
  );
});

export function Avatar({ user, size = 44, online }) {
  const { theme } = useTheme();
  const name = userDisplayName(user);
  const letter = (name[0] || '?').toUpperCase();
  const uri = safeUri(user && user.profile_picture);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [uri]);
  return (
    <View style={{ width: size, height: size }}>
      {uri && !failed ? (
        <Image source={{ uri }} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#8884' }} />
      ) : (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#aeb4b7', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontFamily: 'Nunito-Black', fontSize: size * 0.45 }}>{letter}</Text>
        </View>
      )}
      {online ? (
        <View style={{ position: 'absolute', right: 0, bottom: 0, width: size * 0.28, height: size * 0.28, borderRadius: size, backgroundColor: theme.active, borderWidth: 2, borderColor: theme.bg }} />
      ) : null}
    </View>
  );
}

export function Center({ children }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</View>;
}

export function Loading() {
  const { theme } = useTheme();
  return <Center><ActivityIndicator size="large" color={theme.link} /></Center>;
}

export function Empty({ text }) {
  return <Center><AppText muted style={{ textAlign: 'center' }}>{text}</AppText></Center>;
}

export function Card({ children, style }) {
  const { theme } = useTheme();
  return <View style={[{ backgroundColor: theme.cardBg, borderRadius: 12, padding: 14, marginHorizontal: 12, marginVertical: 6 }, style]}>{children}</View>;
}

export function Row({ children, style }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  btn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10 },
});
