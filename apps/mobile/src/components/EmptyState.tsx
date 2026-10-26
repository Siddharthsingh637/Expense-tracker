import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Text from './Text';
import Button from './Button';
import { Colors, Spacing } from '@/theme';

export interface EmptyStateProps {
  icon: React.ReactNode; // lucide icon
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}

export default function EmptyState({
  icon,
  title,
  subtitle,
  action,
  style,
}: EmptyStateProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconContainer}>{icon}</View>
      <Text variant="bodyBold" center style={styles.title}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="body" center style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
      {action ? (
        <View style={styles.actionContainer}>
          <Button
            variant="ghost"
            label={action.label}
            onPress={action.onPress}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
  },
  iconContainer: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    color: Colors.text,
  },
  subtitle: {
    color: Colors.text2,
    marginTop: Spacing.sm,
  },
  actionContainer: {
    marginTop: Spacing.xl,
  },
});
