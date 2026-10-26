import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Text from './Text';
import { Colors, Radius, Spacing, ZIndex } from '@/theme';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastProps {
  message: string;
  actions?: ToastAction[];
  duration?: number; // ms, default 4000
  visible: boolean;
  onHide: () => void;
}

export function useToast() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [actions, setActions] = useState<ToastAction[] | undefined>(undefined);
  const [duration, setDuration] = useState<number | undefined>(undefined);

  const show = useCallback(
    ({
      message: msg,
      actions: acts,
      duration: dur,
    }: {
      message: string;
      actions?: ToastAction[];
      duration?: number;
    }) => {
      setMessage(msg);
      setActions(acts);
      setDuration(dur);
      setVisible(true);
    },
    []
  );

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  return {
    visible,
    message,
    actions,
    duration,
    show,
    hide,
  };
}

export default function Toast({
  message,
  actions,
  duration = 4000,
  visible,
  onHide,
}: ToastProps) {
  const [isMounted, setIsMounted] = useState(visible);
  const translateY = useSharedValue(60);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      translateY.value = 60;
      opacity.value = 0;
      translateY.value = withSpring(0, { damping: 24, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 150 });

      const timer = setTimeout(() => {
        onHide();
      }, duration);

      return () => clearTimeout(timer);
    } else if (isMounted) {
      opacity.value = withTiming(0, { duration: 200 });
      translateY.value = withTiming(60, { duration: 200 }, (finished) => {
        if (finished) {
          runOnJS(setIsMounted)(false);
        }
      });
    }
  }, [visible, duration, isMounted, onHide, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!isMounted) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.container, animatedStyle]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.toastCard}>
        <Text variant="body" style={styles.message} numberOfLines={2}>
          {message}
        </Text>
        {actions && actions.length > 0 ? (
          <View style={styles.actionsContainer}>
            {actions.map((action, index) => (
              <Pressable
                key={`${action.label}-${index}`}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => {
                  action.onPress();
                  onHide();
                }}
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && styles.actionButtonPressed,
                ]}
              >
                <Text
                  variant="bodySemiBold"
                  color={Colors.accentLight}
                  style={styles.actionLabel}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    right: 16,
    zIndex: ZIndex.toast,
  },
  toastCard: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderLeftWidth: 4,
    borderLeftColor: Colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    // Subtle shadow for dark mode elevation
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  message: {
    color: Colors.text,
    flex: 1,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  actionButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  actionLabel: {
    color: Colors.accentLight,
  },
});
