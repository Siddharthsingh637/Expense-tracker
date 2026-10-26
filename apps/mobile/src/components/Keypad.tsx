import React from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Delete } from 'lucide-react-native';
import { Colors, Fonts, Radius, Spacing, TouchTarget } from '@/theme';

export interface KeypadProps {
  value: string; // current numeric string e.g. "1234"
  onChange: (value: string) => void;
  allowDecimal?: boolean; // default false (paise stored as integers)
  style?: StyleProp<ViewStyle>;
}

const MAX_LENGTH = 10;

export default function Keypad({
  value,
  onChange,
  allowDecimal = false,
  style,
}: KeypadProps) {
  const triggerHaptic = () => {
    Haptics.selectionAsync().catch(() => {});
  };

  const handleDigit = (digit: string) => {
    triggerHaptic();
    if (value.length >= MAX_LENGTH) return;
    if (value === '0') {
      onChange(digit);
    } else {
      onChange(value + digit);
    }
  };

  const handleDecimal = () => {
    if (!allowDecimal) return;
    triggerHaptic();
    if (value.length >= MAX_LENGTH) return;
    if (!value.includes('.')) {
      onChange(value === '' ? '0.' : value + '.');
    }
  };

  const handleBackspace = () => {
    triggerHaptic();
    if (value.length <= 1) {
      onChange('');
    } else {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <View style={[styles.container, style]}>
      {/* Row 1 */}
      <View style={styles.row}>
        {['7', '8', '9'].map((digit) => (
          <Pressable
            key={digit}
            accessibilityRole="button"
            accessibilityLabel={digit}
            onPress={() => handleDigit(digit)}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
          >
            <Text style={styles.keyText}>{digit}</Text>
          </Pressable>
        ))}
      </View>

      {/* Row 2 */}
      <View style={styles.row}>
        {['4', '5', '6'].map((digit) => (
          <Pressable
            key={digit}
            accessibilityRole="button"
            accessibilityLabel={digit}
            onPress={() => handleDigit(digit)}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
          >
            <Text style={styles.keyText}>{digit}</Text>
          </Pressable>
        ))}
      </View>

      {/* Row 3 */}
      <View style={styles.row}>
        {['1', '2', '3'].map((digit) => (
          <Pressable
            key={digit}
            accessibilityRole="button"
            accessibilityLabel={digit}
            onPress={() => handleDigit(digit)}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
          >
            <Text style={styles.keyText}>{digit}</Text>
          </Pressable>
        ))}
      </View>

      {/* Row 4 */}
      <View style={styles.row}>
        {allowDecimal ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decimal point"
            onPress={handleDecimal}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
          >
            <Text style={styles.keyText}>.</Text>
          </Pressable>
        ) : (
          <View style={[styles.key, styles.blankKey]} accessible={false} />
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="0"
          onPress={() => handleDigit('0')}
          style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
        >
          <Text style={styles.keyText}>0</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Backspace"
          onPress={handleBackspace}
          style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
        >
          <Delete size={22} color={Colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.sm,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  key: {
    flex: 1,
    minHeight: 52,
    height: 52,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blankKey: {
    backgroundColor: Colors.transparent,
  },
  keyPressed: {
    opacity: 0.6,
  },
  keyText: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 22,
    color: Colors.text,
    includeFontPadding: false,
    textAlign: 'center',
  },
});
