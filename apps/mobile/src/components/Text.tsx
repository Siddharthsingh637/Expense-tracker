import React from 'react';
import {
  Text as RNText,
  StyleSheet,
  StyleProp,
  TextStyle,
} from 'react-native';
import { Colors, Fonts, FontSize } from '@/theme';

export type TextVariant =
  | 'serif'
  | 'serifBold'
  | 'body'
  | 'bodyMedium'
  | 'bodySemiBold'
  | 'bodyBold'
  | 'label'
  | 'caption'
  | 'captionBold';

export interface TextProps extends React.ComponentProps<typeof RNText> {
  variant?: TextVariant;
  color?: string; // override, defaults from variant
  center?: boolean;
  numberOfLines?: number;
}

export default function Text({
  variant = 'body',
  color,
  center = false,
  numberOfLines,
  style,
  children,
  ...rest
}: TextProps) {
  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[
        styles.base,
        styles[variant],
        center && styles.center,
        color ? { color } : styles.defaultColor,
        style,
      ]}
      {...rest}
    >
      {children}
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
  center: {
    textAlign: 'center',
  },
  serif: {
    fontFamily: Fonts.serif,
    fontSize: FontSize.xl,
    lineHeight: 34,
  },
  serifBold: {
    fontFamily: Fonts.serifBold,
    fontSize: FontSize.xl,
    lineHeight: 34,
  },
  body: {
    fontFamily: Fonts.sans,
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  bodyMedium: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  bodySemiBold: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  bodyBold: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  caption: {
    fontFamily: Fonts.sans,
    fontSize: FontSize.xs,
    lineHeight: 15,
  },
  captionBold: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: FontSize.xs,
    lineHeight: 15,
  },
});
