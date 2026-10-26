import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Colors, Fonts, FontSize, Radius, Spacing, TouchTarget } from '@/theme';

export type ButtonVariant = 'primary' | 'ghost' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const SM_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };

export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const isInteractive = !disabled && !loading;

  const indicatorColor =
    variant === 'destructive' ? Colors.expense : Colors.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={!isInteractive}
      hitSlop={size === 'sm' ? SM_HIT_SLOP : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !isInteractive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        (disabled || loading) && styles.disabled,
        pressed && isInteractive && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size={size === 'sm' ? 'small' : 'small'}
          color={indicatorColor}
        />
      ) : (
        <View style={styles.contentRow}>
          {icon && iconPosition === 'left' && (
            <View style={styles.iconContainer}>{icon}</View>
          )}
          <Text
            style={[
              styles.label,
              styles[`label_${variant}`],
              styles[`label_${size}`],
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {icon && iconPosition === 'right' && (
            <View style={styles.iconContainer}>{icon}</View>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },

  // Variants
  primary: {
    backgroundColor: Colors.accent,
  },
  ghost: {
    backgroundColor: Colors.transparent,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  destructive: {
    backgroundColor: Colors.transparent,
    borderWidth: 1,
    borderColor: Colors.expense,
  },

  // Sizes
  sm: {
    height: 36,
    paddingHorizontal: Spacing.md,
  },
  md: {
    height: 48,
    minHeight: TouchTarget,
    paddingHorizontal: Spacing.base,
  },
  lg: {
    height: 56,
    minHeight: TouchTarget,
    paddingHorizontal: Spacing.lg,
  },

  // Text labels
  label: {
    fontFamily: Fonts.sansSemiBold,
    includeFontPadding: false,
    textAlign: 'center',
  },
  label_primary: {
    color: Colors.text,
  },
  label_ghost: {
    color: Colors.text,
  },
  label_destructive: {
    color: Colors.expense,
  },

  label_sm: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  label_md: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  label_lg: {
    fontSize: FontSize.md,
    lineHeight: 24,
  },
});
