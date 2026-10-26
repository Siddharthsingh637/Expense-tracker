import React, { useState } from 'react';
import { View, StyleSheet, Pressable, LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { Colors, Spacing, Radius } from '@/theme';
import { Text } from '@/components';
import { formatMoney } from '@/lib/format';

interface DailySpendBarChartProps {
  daysInMonth: number;
  dailySpend: Record<number, number>; // day (1..N) -> paise
  monthLabel: string;
  height?: number;
}

export default function DailySpendBarChart({
  daysInMonth,
  dailySpend,
  monthLabel,
  height = 140,
}: DailySpendBarChartProps) {
  const [containerWidth, setContainerWidth] = useState(320);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    if (width > 0) {
      setContainerWidth(width);
    }
  };

  // Find max daily spend for normalization
  let maxSpend = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const val = dailySpend[d] ?? 0;
    if (val > maxSpend) maxSpend = val;
  }
  // If no spend, set a minimum scale of ₹500 so bars can still render baseline
  const effectiveMax = Math.max(maxSpend, 50000);

  const chartHeight = height - 28; // reserve 28px for x-axis labels
  const paddingLeft = 6;
  const paddingRight = 6;
  const availableWidth = containerWidth - paddingLeft - paddingRight;
  const slotWidth = availableWidth / daysInMonth;
  const barWidth = Math.max(3, slotWidth - 3);

  const activeDay = selectedDay !== null ? selectedDay : null;
  const activeSpend = activeDay ? dailySpend[activeDay] ?? 0 : null;

  return (
    <View style={styles.container} onLayout={handleLayout}>
      {/* Selected Day Tooltip */}
      <View style={styles.tooltipRow}>
        <Text variant="caption" color={Colors.muted}>
          DAILY BREAKDOWN
        </Text>
        {activeDay !== null ? (
          <View style={styles.tooltipPill}>
            <Text variant="captionBold" color={Colors.text}>
              Day {activeDay}: {formatMoney(activeSpend ?? 0)}
            </Text>
          </View>
        ) : (
          <Text variant="caption" color={Colors.text2}>
            Tap a bar for details
          </Text>
        )}
      </View>

      {/* SVG Chart */}
      <Svg width={containerWidth} height={height}>
        {/* Background Gridlines */}
        <Line
          x1={paddingLeft}
          y1={chartHeight * 0.5}
          x2={containerWidth - paddingRight}
          y2={chartHeight * 0.5}
          stroke={Colors.hairline}
          strokeDasharray="4, 4"
          strokeWidth={1}
        />
        <Line
          x1={paddingLeft}
          y1={chartHeight}
          x2={containerWidth - paddingRight}
          y2={chartHeight}
          stroke={Colors.hairline}
          strokeWidth={1}
        />

        {/* Daily Bars */}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const spend = dailySpend[day] ?? 0;
          const barHeight = spend > 0 ? Math.max(4, (spend / effectiveMax) * (chartHeight - 10)) : 2;
          const x = paddingLeft + (day - 1) * slotWidth + (slotWidth - barWidth) / 2;
          const y = chartHeight - barHeight;
          const isSelected = activeDay === day;
          const barFill = isSelected
            ? Colors.accentLight
            : spend > 0
            ? Colors.accent
            : Colors.surface2;

          return (
            <React.Fragment key={day}>
              <Rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={Math.min(2, barWidth / 2)}
                fill={barFill}
              />
              {/* X-axis labels at intervals: 1, 5, 10, 15, 20, 25, and end */}
              {(day === 1 || day % 5 === 0 || day === daysInMonth) && (
                <SvgText
                  x={x + barWidth / 2}
                  y={height - 8}
                  fill={Colors.muted}
                  fontSize={10}
                  textAnchor="middle"
                >
                  {day}
                </SvgText>
              )}
            </React.Fragment>
          );
        })}
      </Svg>

      {/* Invisible Touch Layer for Bars */}
      <View style={[StyleSheet.absoluteFill, { top: 28, height: chartHeight }]}>
        <View style={[styles.touchRow, { paddingHorizontal: paddingLeft }]}>
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            return (
              <Pressable
                key={day}
                style={{ flex: 1, height: '100%' }}
                onPress={() => setSelectedDay(selectedDay === day ? null : day)}
                accessibilityLabel={`Day ${day}: ${formatMoney(dailySpend[day] ?? 0)}`}
                accessibilityRole="button"
              />
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
  tooltipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 24,
  },
  tooltipPill: {
    backgroundColor: Colors.surface2,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  touchRow: {
    flexDirection: 'row',
    height: '100%',
  },
});
