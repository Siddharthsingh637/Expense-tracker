import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Text from './Text';
import { Colors, Radius, Spacing } from '@/theme';
import { formatMoney } from '@/lib/format';

export interface BudgetBarProps {
  allocatedPaise: number;
  spentPaise: number;
  label?: string;
  showAmount?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function BudgetBar({
  allocatedPaise,
  spentPaise,
  label,
  showAmount = false,
  style,
}: BudgetBarProps) {
  const ratio =
    allocatedPaise > 0
      ? spentPaise / allocatedPaise
      : spentPaise > 0
      ? 1
      : 0;
  const clampedProgress = Math.min(1, Math.max(0, ratio));
  const progressPercent = Math.round(clampedProgress * 100);

  let barColor: string = Colors.onTrack;
  if (ratio > 1.0) {
    barColor = Colors.overBudget;
  } else if (ratio > 0.8) {
    barColor = '#D97706';
  }

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Budget progress'}
      accessibilityValue={{
        min: 0,
        max: allocatedPaise,
        now: spentPaise,
        text: `${Math.round(ratio * 100)}%`,
      }}
    >
      {label || showAmount ? (
        <View style={styles.headerRow}>
          {label ? (
            <Text variant="label" style={styles.label} numberOfLines={1}>
              {label}
            </Text>
          ) : (
            <View />
          )}
          {showAmount ? (
            <Text variant="caption" color={Colors.text2} style={styles.amountText}>
              {formatMoney(spentPaise)} / {formatMoney(allocatedPaise)}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${progressPercent}%`,
              backgroundColor: barColor,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  label: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  amountText: {
    textAlign: 'right',
  },
  track: {
    height: 6,
    width: '100%',
    backgroundColor: Colors.surface2,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.full,
  },
});
