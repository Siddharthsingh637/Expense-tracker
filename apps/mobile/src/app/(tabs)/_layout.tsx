import { Tabs, router, usePathname } from 'expo-router';
import { StyleSheet, View, Pressable, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, PieChart, Users, BarChart2, Bot, Plus } from 'lucide-react-native';
import { useRef, useCallback, useState } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useWindowDimensions } from 'react-native';

import { Colors, Spacing, ZIndex, Radius, TouchTarget, Fonts, FontSize, Duration } from '@/theme';
import { Text } from '@/components';
import { useFinancerStore } from '@/data/local/store';

// ---------------------------------------------------------------------------
// Tab bar icon helper
// ---------------------------------------------------------------------------

function TabIcon({
  Icon,
  focused,
  label,
}: {
  Icon: React.FC<{ size: number; color: string }>;
  focused: boolean;
  label: string;
}) {
  return (
    <View style={tabStyles.iconWrapper} accessibilityLabel={label}>
      <Icon size={22} color={focused ? Colors.accentLight : Colors.muted} />
      <Text
        variant="caption"
        color={focused ? Colors.accentLight : Colors.muted}
        style={tabStyles.tabLabel}
      >
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Draggable FAB
// ---------------------------------------------------------------------------

const FAB_SIZE = 56;
const EDGE_MARGIN = Spacing.base;
const TAB_BAR_HEIGHT = 64; // approx

function FAB() {
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fabPosition = useFinancerStore((s) => s.fabPosition);
  const fabY = useFinancerStore((s) => s.fabY);
  const setFabPosition = useFinancerStore((s) => s.setFabPosition);
  const setFabY = useFinancerStore((s) => s.setFabY);

  // Initial X based on stored edge
  const initialX =
    fabPosition === 'right'
      ? SCREEN_W - FAB_SIZE - EDGE_MARGIN
      : EDGE_MARGIN;
  const initialY =
    fabY > 0
      ? fabY
      : SCREEN_H - TAB_BAR_HEIGHT - insets.bottom - FAB_SIZE - Spacing.xl;

  const x = useSharedValue(initialX);
  const y = useSharedValue(initialY);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const openQuickAdd = useCallback(() => {
    router.push('/quick-add');
  }, []);

  const snapToEdge = useCallback(
    (currentX: number, currentY: number) => {
      // Clamp Y: stay above tab bar, below status bar
      const minY = insets.top + Spacing.xl;
      const maxY = SCREEN_H - TAB_BAR_HEIGHT - insets.bottom - FAB_SIZE - Spacing.sm;
      const clampedY = Math.min(Math.max(currentY, minY), maxY);

      // Snap to nearest edge
      const snapRight = currentX + FAB_SIZE / 2 > SCREEN_W / 2;
      const snapX = snapRight
        ? SCREEN_W - FAB_SIZE - EDGE_MARGIN
        : EDGE_MARGIN;

      x.value = withSpring(snapX, { damping: 18, stiffness: 200 });
      y.value = withSpring(clampedY, { damping: 18, stiffness: 200 });

      // Persist to store
      runOnJS(setFabPosition)(snapRight ? 'right' : 'left');
      runOnJS(setFabY)(clampedY);
      runOnJS(triggerHaptic)();
    },
    [SCREEN_W, SCREEN_H, insets, x, y, setFabPosition, setFabY, triggerHaptic],
  );

  const drag = Gesture.Pan()
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = startX.value + e.translationX;
      y.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      runOnJS(snapToEdge)(x.value, y.value);
    });

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(openQuickAdd)();
  });

  const composed = Gesture.Exclusive(drag, tap);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[styles.fab, animStyle]}
        accessibilityRole="button"
        accessibilityLabel="Quick add expense"
      >
        <Plus size={26} color={Colors.text} strokeWidth={2.5} />
      </Animated.View>
    </GestureDetector>
  );
}

// ---------------------------------------------------------------------------
// Tab layout
// ---------------------------------------------------------------------------

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const fabPosition = useFinancerStore((s) => s.fabPosition);
  const isTabScreen = ['/', '/budget', '/splits', '/insights'].includes(pathname);

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: [styles.tabBar, { paddingBottom: insets.bottom }],
          tabBarBackground: () => <View style={styles.tabBarBg} />,
          tabBarShowLabel: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ focused }) => (
              <TabIcon Icon={Home} focused={focused} label="Home" />
            ),
          }}
        />
        <Tabs.Screen
          name="budget"
          options={{
            title: 'Budget',
            tabBarIcon: ({ focused }) => (
              <TabIcon Icon={PieChart} focused={focused} label="Budget" />
            ),
          }}
        />
        <Tabs.Screen
          name="splits"
          options={{
            title: 'Splits',
            tabBarIcon: ({ focused }) => (
              <TabIcon Icon={Users} focused={focused} label="Splits" />
            ),
          }}
        />
        <Tabs.Screen
          name="insights"
          options={{
            title: 'Insights',
            tabBarIcon: ({ focused }) => (
              <TabIcon Icon={BarChart2} focused={focused} label="Insights" />
            ),
          }}
        />
      </Tabs>

      {/* Keep floating controls out of pushed screens such as Settings. */}
      {isTabScreen && <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          style={[
            styles.aiFab,
            {
              bottom: TAB_BAR_HEIGHT + insets.bottom + Spacing.xl + 4,
              left: fabPosition === 'right' ? Spacing.base : undefined,
              right: fabPosition === 'left' ? Spacing.base : undefined,
            },
          ]}
          onPress={() => router.push('/ai-assistant')}
          accessibilityRole="button"
          accessibilityLabel="Open AI assistant"
        >
          <Bot size={22} color={Colors.accentLight} />
        </Pressable>
      </View>}

      {/* Draggable FAB */}
      {isTabScreen && <View style={StyleSheet.absoluteFill} pointerEvents="box-none"><FAB /></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: TAB_BAR_HEIGHT,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    backgroundColor: Colors.surface,
    elevation: 0,
    shadowOpacity: 0,
  },
  tabBarBg: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: ZIndex.fab,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  aiFab: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: ZIndex.fab,
    elevation: 7,
  },
});

const tabStyles = StyleSheet.create({
  iconWrapper: {
    alignItems: 'center',
    gap: 3,
    paddingTop: Spacing.xs,
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.2,
  },
});
