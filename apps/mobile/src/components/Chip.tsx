import React from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Colors, Fonts, FontSize, Radius, Spacing } from '@/theme';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: React.ReactNode;
  color?: string; // accent color when selected, defaults to Colors.accent
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

export default function Chip({
  label,
  selected = false,
  onPress,
  icon,
  color,
  disabled = false,
  style,
}: ChipProps) {
  const activeColor = color ?? Colors.accent;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.selected : styles.unselected,
        selected && color ? { backgroundColor: activeColor } : undefined,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {icon ? <View style={styles.iconContainer}>{icon}</View> : null}
      <Text
        style={[
          styles.label,
          selected ? styles.labelSelected : styles.labelUnselected,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 34,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  selected: {
    backgroundColor: Colors.accent,
  },
  unselected: {
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  iconContainer: {
    marginRight: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSize.sm,
    includeFontPadding: false,
  },
  labelSelected: {
    color: Colors.text,
  },
  labelUnselected: {
    color: Colors.text2,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
});
