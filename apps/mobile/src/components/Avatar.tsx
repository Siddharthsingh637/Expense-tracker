import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Colors, Fonts } from '@/theme';

export interface AvatarProps {
  name: string;
  size?: number; // default 36
  isMe?: boolean;
  style?: StyleProp<ViewStyle>;
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  const first = parts[0].charAt(0).toUpperCase();
  const last = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first}${last}`;
}

export default function Avatar({
  name,
  size = 36,
  isMe = false,
  style,
}: AvatarProps) {
  const initials = getInitials(name);
  const fontSize = Math.round(size * 0.38);

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        isMe ? styles.me : styles.other,
        style,
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={isMe ? `${name} (You)` : name}
    >
      <Text
        style={[
          styles.initials,
          {
            fontSize,
            lineHeight: Math.round(fontSize * 1.2),
          },
        ]}
        numberOfLines={1}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  me: {
    backgroundColor: Colors.accent,
  },
  other: {
    backgroundColor: Colors.surface2,
  },
  initials: {
    fontFamily: Fonts.sansSemiBold,
    color: Colors.text,
    includeFontPadding: false,
    textAlign: 'center',
  },
});
