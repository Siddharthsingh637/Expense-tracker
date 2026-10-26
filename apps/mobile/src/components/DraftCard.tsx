import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Text from './Text';
import Button from './Button';
import { Colors, Radius, Spacing } from '@/theme';

export interface DraftCardProps {
  label?: string; // default: "AI Draft"
  confidence: number; // 0–1
  reason: string;
  children: React.ReactNode; // preview of the draft content
  onConfirm: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function DraftCard({
  label = 'AI Draft',
  confidence,
  reason,
  children,
  onConfirm,
  onEdit,
  onDiscard,
  loading = false,
  style,
}: DraftCardProps) {
  const clampedConfidence = Math.min(1, Math.max(0, confidence));
  const confidencePercent = Math.round(clampedConfidence * 100);

  return (
    <View style={[styles.card, style]}>
      {/* Top row: Label & Confidence bar */}
      <View style={styles.topRow}>
        <Text variant="caption" style={styles.label}>
          {label.toUpperCase()}
        </Text>
        <View
          style={styles.confidenceContainer}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`${confidencePercent}% confidence`}
          accessibilityValue={{ min: 0, max: 100, now: confidencePercent }}
        >
          <View style={styles.confidenceTrack}>
            <View
              style={[
                styles.confidenceFill,
                { width: `${confidencePercent}%` },
              ]}
            />
          </View>
        </View>
      </View>

      {/* Reason text */}
      {reason ? (
        <Text variant="caption" style={styles.reasonText}>
          {reason}
        </Text>
      ) : null}

      {/* Draft preview area */}
      <View style={styles.previewContainer}>{children}</View>

      {/* Bottom row: Confirm, Edit, Discard buttons */}
      <View style={styles.buttonRow}>
        <View style={styles.buttonWrapper}>
          <Button
            variant="destructive"
            size="sm"
            label="Discard"
            disabled={loading}
            onPress={onDiscard}
            fullWidth
          />
        </View>
        <View style={styles.buttonWrapper}>
          <Button
            variant="ghost"
            size="sm"
            label="Edit"
            disabled={loading}
            onPress={onEdit}
            fullWidth
          />
        </View>
        <View style={styles.buttonWrapper}>
          <Button
            variant="primary"
            size="sm"
            label="Confirm"
            loading={loading}
            disabled={loading}
            onPress={onConfirm}
            fullWidth
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: Spacing.base,
    gap: Spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: Colors.muted,
    letterSpacing: 1.2,
  },
  confidenceContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  confidenceTrack: {
    width: 64,
    height: 4,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
  },
  reasonText: {
    color: Colors.text2,
    fontStyle: 'italic',
  },
  previewContainer: {
    paddingVertical: Spacing.xs,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  buttonWrapper: {
    flex: 1,
  },
});
