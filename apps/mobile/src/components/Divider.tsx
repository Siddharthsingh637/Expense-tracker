import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors } from '@/theme';

export interface DividerProps {
  style?: StyleProp<ViewStyle>;
  vertical?: boolean;
  inset?: number; // horizontal inset on each side (or vertical inset if vertical)
}

export default function Divider({
  style,
  vertical = false,
  inset,
}: DividerProps) {
  return (
    <View
      style={[
        vertical ? styles.vertical : styles.horizontal,
        inset !== undefined
          ? vertical
            ? { marginVertical: inset }
            : { marginHorizontal: inset }
          : undefined,
        style,
      ]}
      accessible={false}
    />
  );
}

const styles = StyleSheet.create({
  horizontal: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.hairline,
    width: '100%',
  },
  vertical: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Colors.hairline,
    height: '100%',
  },
});
