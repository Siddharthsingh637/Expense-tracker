import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Colors } from '@/theme';

export interface ProgressRingProps {
  size: number; // diameter in dp
  progress: number; // 0–1, clamped
  strokeWidth?: number; // default 3
  color?: string; // default Colors.accent
  backgroundColor?: string; // default Colors.hairline
  children?: React.ReactNode;
}

export default function ProgressRing({
  size,
  progress,
  strokeWidth = 3,
  color = Colors.accent,
  backgroundColor = Colors.hairline,
  children,
}: ProgressRingProps) {
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const strokeDashoffset = circumference * (1 - clampedProgress);
  const progressPercent = Math.round(clampedProgress * 100);

  return (
    <View
      style={[styles.container, { width: size, height: size }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Progress ${progressPercent}%`}
      accessibilityValue={{ min: 0, max: 100, now: progressPercent }}
    >
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${center}, ${center}`}>
          {/* Background Ring */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={backgroundColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Foreground Progress Arc */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
          />
        </G>
      </Svg>
      {children ? <View style={styles.childContainer}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  childContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
