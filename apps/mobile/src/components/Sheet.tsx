import React, { useEffect, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './Text';
import { Colors, Radius, Spacing } from '@/theme';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Sheet height as fraction of screen height, default 0.6 */
  snapFraction?: number;
  /** If true, renders a full-height sheet (modal style) */
  fullHeight?: boolean;
  title?: string;
  showHandle?: boolean;
  avoidKeyboard?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function Sheet({
  visible,
  onClose,
  children,
  snapFraction = 0.6,
  fullHeight = false,
  title,
  showHandle = true,
  avoidKeyboard = true,
}: SheetProps) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [isMounted, setIsMounted] = useState(visible);

  const sheetHeight = fullHeight
    ? screenHeight - insets.top
    : Math.round(screenHeight * snapFraction);

  const translateY = useSharedValue(sheetHeight);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      translateY.value = sheetHeight;
      translateY.value = withSpring(0, {
        damping: 28,
        stiffness: 220,
      });
      backdropOpacity.value = withTiming(1, { duration: 250 });
    } else if (isMounted) {
      backdropOpacity.value = withTiming(0, { duration: 200 });
      translateY.value = withTiming(sheetHeight, { duration: 200 }, (finished) => {
        if (finished) {
          runOnJS(setIsMounted)(false);
        }
      });
    }
  }, [visible, sheetHeight, isMounted, backdropOpacity, translateY]);

  useEffect(() => {
    if (!visible) return;
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      }
    );
    return () => backHandler.remove();
  }, [visible, onClose]);

  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!isMounted) {
    return null;
  }

  const sheetBody = (
    <Animated.View
      style={[
        styles.sheet,
        {
          height: sheetHeight,
          paddingBottom: Math.max(insets.bottom, Spacing.base),
        },
        animatedSheetStyle,
      ]}
    >
      {showHandle && (
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>
      )}
      {title ? (
        <View style={styles.header}>
          <Text variant="serifBold" numberOfLines={1}>
            {title}
          </Text>
        </View>
      ) : null}
      <View style={styles.content}>{children}</View>
    </Animated.View>
  );

  return (
    <Modal
      visible={isMounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Close sheet backdrop"
          style={[StyleSheet.absoluteFill, styles.backdrop, animatedBackdropStyle]}
          onPress={onClose}
        />
        {avoidKeyboard ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardContainer}
          >
            {sheetBody}
          </KeyboardAvoidingView>
        ) : (
          sheetBody
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: Colors.overlay,
  },
  keyboardContainer: {
    justifyContent: 'flex-end',
    width: '100%',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    width: '100%',
    overflow: 'hidden',
  },
  handleContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.hairline,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.hairline,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
  },
});
