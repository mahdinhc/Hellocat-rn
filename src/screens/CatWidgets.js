import React, { useState, useEffect } from 'react';
import { View, Image, TextInput, TouchableOpacity, Text, Modal, Pressable } from 'react-native';
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

export function SearchBar({ value, onChangeText, placeholder = 'Search', style }) {
  const { theme } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.inputBg, borderRadius: 22, paddingHorizontal: 12, height: 42, marginHorizontal: 12, marginTop: 10, marginBottom: 4, borderWidth: 1, borderColor: theme.dark ? '#ffffff20' : '#00000012' }, style]}>
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

export function SortMenu({ value, onChange, options = [['new', 'Newest', 'time-outline'], ['top', 'Top', 'trending-up-outline']] }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o[0] === value) || options[0];
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 12, marginRight: 12, marginTop: 10, marginBottom: 4, borderRadius: 22, backgroundColor: theme.inputBg, borderWidth: 1, borderColor: theme.dark ? '#ffffff20' : '#00000012' }}>
        <Ionicons name={cur[2]} size={16} color={theme.inputText} />
        <Text style={{ color: theme.inputText, fontFamily: 'Nunito-Bold', fontSize: 13, marginHorizontal: 5 }}>{cur[1]}</Text>
        <Ionicons name="chevron-down" size={14} color={theme.inputText} style={{ opacity: 0.6 }} />
      </TouchableOpacity>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: '#0006', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: 240, borderRadius: 14, backgroundColor: theme.cardBg, paddingVertical: 6 }}>
            <Text style={{ color: theme.cardText, opacity: 0.6, fontFamily: 'Nunito-Bold', fontSize: 12, paddingHorizontal: 16, paddingVertical: 8 }}>SORT BY</Text>
            {options.map((o) => (
              <TouchableOpacity key={o[0]} onPress={() => { onChange(o[0]); setOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
                <Ionicons name={o[2]} size={18} color={theme.cardText} />
                <Text style={{ flex: 1, marginLeft: 10, color: theme.cardText, fontFamily: 'Nunito-Regular', fontSize: 15 }}>{o[1]}</Text>
                {value === o[0] ? <Ionicons name="checkmark" size={20} color={theme.link} /> : null}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
