import React, { useState, useEffect } from 'react';
import { View, Image, TextInput, TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { safeUri } from '../safe';

export function CatIcon({ cat, size = 44, style }) {
  const { theme } = useTheme();
  const uri = safeUri(cat && cat.icon);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  const radius = size * 0.28;
  if (uri && !failed) {
    return <Image source={{ uri }} onError={() => setFailed(true)} style={[{ width: size, height: size, borderRadius: radius, backgroundColor: '#8883' }, style]} />;
  }
  const letter = ((cat && cat.slug) || '?')[0].toUpperCase();
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: theme.buttonBg, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ color: theme.buttonText, fontFamily: 'Nunito-Black', fontSize: size * 0.46 }}>{letter}</Text>
    </View>
  );
}

export function CatBanner({ cat, height = 130 }) {
  const { theme } = useTheme();
  const uri = safeUri(cat && cat.banner);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  if (uri && !failed) return <Image source={{ uri }} onError={() => setFailed(true)} resizeMode="cover" style={{ width: '100%', height, backgroundColor: '#8883' }} />;
  return <View style={{ width: '100%', height, backgroundColor: theme.buttonBg, opacity: 0.85 }} />;
}

export function SearchBar({ value, onChangeText, placeholder = 'Search' }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.inputBg, borderRadius: 22, paddingHorizontal: 12, height: 42, marginHorizontal: 12, marginTop: 10, marginBottom: 4, borderWidth: 1, borderColor: theme.dark ? '#ffffff20' : '#00000012' }}>
      <Ionicons name="search" size={18} color={theme.inputText} style={{ opacity: 0.55 }} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.dark ? '#ffffff66' : '#00000066'}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, marginLeft: 8, color: theme.inputText, fontFamily: 'Nunito-Regular', fontSize: 15, paddingVertical: 0 }}
      />
      {value ? <TouchableOpacity onPress={() => onChangeText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="close-circle" size={18} color={theme.inputText} style={{ opacity: 0.55 }} /></TouchableOpacity> : null}
    </View>
  );
}
