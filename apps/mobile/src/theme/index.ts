/**
 * Financer design tokens — single source of truth.
 * Dark-only. Never use inline colour strings; always import from here.
 */

export const Colors = {
  // Backgrounds
  bg: '#0B0A0D',
  surface: '#131116',
  surface2: '#1A171E',

  // Text
  text: '#E8DFCF',
  text2: '#A89F8E',
  muted: '#6F675A',

  // Accent
  accent: '#4B2A7B',
  accentLight: '#7B5BB0',

  // Semantic — use ONLY for money states
  income: '#4A7C59',       // desaturated green
  expense: '#C0392B',      // desaturated red
  overBudget: '#C0392B',
  onTrack: '#4A7C59',

  // Structural
  hairline: 'rgba(232,223,207,0.10)',
  overlay: 'rgba(11,10,13,0.72)',
  transparent: 'transparent',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

/** Font family names — loaded via expo-font in root _layout */
export const Fonts = {
  /** Headings and large amount display */
  serif: 'Fraunces_400Regular',
  serifBold: 'Fraunces_700Bold',
  /** All UI text */
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 28,
  xxl: 36,
  hero: 52,
} as const;

export const LineHeight = {
  tight: 1.15,
  normal: 1.45,
  relaxed: 1.65,
} as const;

/** Minimum touch target per Android accessibility guidelines */
export const TouchTarget = 44;

export const ZIndex = {
  sheet: 100,
  fab: 200,
  toast: 300,
  modal: 400,
} as const;

/** Animation durations in ms */
export const Duration = {
  fast: 150,
  normal: 250,
  slow: 400,
} as const;

/** The complete theme object — pass through context if needed */
const theme = {
  Colors,
  Spacing,
  Radius,
  Fonts,
  FontSize,
  TouchTarget,
  ZIndex,
  Duration,
} as const;

export type Theme = typeof theme;
export default theme;
