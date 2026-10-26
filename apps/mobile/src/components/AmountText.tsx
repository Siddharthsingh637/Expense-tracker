import React, { useEffect, useState } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text as RNText,
  TextStyle,
} from 'react-native';
import {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Colors, Fonts } from '@/theme';
import { formatMoney } from '@/lib/format';

export interface AmountTextProps {
  paise: number;
  variant?: 'hero' | 'large' | 'medium';
  color?: string;
  showSign?: boolean;
  animated?: boolean; // animate count-up on mount
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

export default function AmountText({
  paise,
  variant = 'large',
  color = Colors.text,
  showSign = false,
  animated = false,
  style,
  accessibilityLabel,
}: AmountTextProps) {
  const animatedValue = useSharedValue(0);
  const [displayPaise, setDisplayPaise] = useState<number>(animated ? 0 : paise);

  useEffect(() => {
    if (!animated) {
      setDisplayPaise(paise);
      return;
    }
    animatedValue.value = 0;
    animatedValue.value = withTiming(paise, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });
  }, [paise, animated, animatedValue]);

  useAnimatedReaction(
    () => Math.round(animatedValue.value),
    (current, prev) => {
      if (animated && current !== prev) {
        runOnJS(setDisplayPaise)(current);
      }
    },
    [animated]
  );

  const formattedAmount = formatMoney(animated ? displayPaise : paise, {
    showSign,
  });

  const resolvedAccessibilityLabel =
    accessibilityLabel ?? formatMoney(paise, { showSign });

  return (
    <RNText
      accessible
      accessibilityRole="text"
      accessibilityLabel={resolvedAccessibilityLabel}
      style={[
        styles.base,
        styles[variant],
        color !== Colors.text ? { color } : styles.defaultColor,
        style,
      ]}
    >
      {formattedAmount}
    </RNText>
  );
}

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
  },
  defaultColor: {
    color: Colors.text,
  },
  hero: {
    fontFamily: Fonts.serifBold,
    fontSize: 52,
    lineHeight: 56,
  },
  large: {
    fontFamily: Fonts.serif,
    fontSize: 36,
    lineHeight: 40,
  },
  medium: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    lineHeight: 32,
  },
});
