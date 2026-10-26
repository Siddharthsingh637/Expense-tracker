import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Colors, Spacing, Radius } from '@/theme';
import { Text } from '@/components';
import { formatMoney } from '@/lib/format';

export interface CategoryDonutSlice {
  categoryId: string;
  name: string;
  color: string;
  amountPaise: number;
}

interface CategoryDonutChartProps {
  slices: CategoryDonutSlice[];
  totalPaise: number;
  size?: number;
}

export default function CategoryDonutChart({
  slices,
  totalPaise,
  size = 160,
}: CategoryDonutChartProps) {
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Filter non-zero slices
  const validSlices = slices.filter((s) => s.amountPaise > 0);
  const effectiveTotal = Math.max(
    totalPaise,
    validSlices.reduce((sum, s) => sum + s.amountPaise, 0)
  );

  let accumulatedLength = 0;

  return (
    <View style={styles.container}>
      <Text variant="caption" color={Colors.muted} style={styles.label}>
        CATEGORY ALLOCATION
      </Text>

      <View style={styles.chartWrapper}>
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={size} height={size}>
            <G rotation="-90" origin={`${center}, ${center}`}>
              {/* Background Track */}
              <Circle
                cx={center}
                cy={center}
                r={radius}
                stroke={Colors.surface2}
                strokeWidth={strokeWidth}
                fill="none"
              />

              {/* Slices */}
              {effectiveTotal > 0 &&
                validSlices.map((slice) => {
                  const fraction = slice.amountPaise / effectiveTotal;
                  const dashLength = fraction * circumference;
                  const dashOffset = -accumulatedLength;
                  accumulatedLength += dashLength;

                  return (
                    <Circle
                      key={slice.categoryId}
                      cx={center}
                      cy={center}
                      r={radius}
                      stroke={slice.color || Colors.accent}
                      strokeWidth={strokeWidth}
                      strokeDasharray={`${dashLength} ${circumference}`}
                      strokeDashoffset={dashOffset}
                      fill="none"
                    />
                  );
                })}
            </G>
          </Svg>

          {/* Center Info */}
          <View style={styles.centerInfo}>
            <Text variant="serifBold" style={styles.centerAmount} numberOfLines={1}>
              {formatMoney(totalPaise)}
            </Text>
            <Text variant="caption" color={Colors.muted}>
              Total Spend
            </Text>
          </View>
        </View>

        {/* Legend */}
        <View style={styles.legendContainer}>
          {validSlices.slice(0, 6).map((slice) => {
            const percent =
              effectiveTotal > 0
                ? Math.round((slice.amountPaise / effectiveTotal) * 100)
                : 0;
            return (
              <View key={slice.categoryId} style={styles.legendItem}>
                <View style={styles.legendLeft}>
                  <View style={[styles.legendDot, { backgroundColor: slice.color }]} />
                  <Text variant="caption" color={Colors.text} numberOfLines={1} style={{ maxWidth: 85 }}>
                    {slice.name}
                  </Text>
                </View>
                <View style={styles.legendRight}>
                  <Text variant="caption" color={Colors.text2}>
                    {percent}%
                  </Text>
                  <Text variant="captionBold" color={Colors.text}>
                    {formatMoney(slice.amountPaise)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.sm,
  },
  label: {
    letterSpacing: 0.8,
  },
  chartWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.base,
  },
  centerInfo: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  centerAmount: {
    fontSize: 16,
    color: Colors.text,
  },
  legendContainer: {
    flex: 1,
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  legendLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
