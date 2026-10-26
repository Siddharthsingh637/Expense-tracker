import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/theme';
import { activateGuestStore, activateStoreForUser, usePaisaStore } from '@/data/local/store';
import { Toast } from '@/components';
import { useToastStore } from '@/lib/toast-store';
import { restoreSession, hasSession } from '@/data/remote/api';
import { startSyncService, syncNow } from '@/data/remote/sync';
import { useSyncStatus } from '@/lib/sync-status';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const isOnboarded = usePaisaStore((s) => s.isOnboarded);
  const toast = useToastStore();
  const [authReady, setAuthReady] = useState(false);
  const pathname = usePathname();

  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    let mounted = true;
    void restoreSession().then(async (session) => {
      if (!mounted) return;
      if (session) {
        await activateStoreForUser(session.user.id);
        startSyncService((status, message) => useSyncStatus.getState().setStatus(status, message));
      } else await activateGuestStore();
      setAuthReady(true);
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && hasSession()) void syncNow();
    });
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if ((!fontsLoaded && !fontError) || !authReady) return;
    const inOnboarding = pathname?.includes('onboarding-budget') || pathname?.includes('onboarding-map');
    if (hasSession() && !isOnboarded) {
      if (!inOnboarding) {
        router.replace('/(auth)/onboarding-budget');
      }
      return;
    }
    if (!hasSession() && !isOnboarded) {
      if (!pathname?.includes('welcome')) {
        router.replace('/(auth)/welcome');
      }
      return;
    }
    if (isOnboarded && (inOnboarding || pathname?.includes('welcome'))) {
      router.replace('/(tabs)');
    }
  }, [fontsLoaded, fontError, isOnboarded, authReady, pathname]);

  if ((!fontsLoaded && !fontError) || !authReady) {
    return <View style={{ flex: 1, backgroundColor: Colors.bg }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="quick-add"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="ai-assistant"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            presentation: 'card',
            animation: 'slide_from_right',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="transaction/list"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        <Stack.Screen
          name="transaction/[id]"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        <Stack.Screen
          name="splits/new"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        <Stack.Screen
          name="splits/[id]"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        <Stack.Screen
          name="splits/people"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        <Stack.Screen
          name="budget/category/[id]"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
      </Stack>
      <Toast
        visible={toast.visible}
        message={toast.message}
        actions={toast.actions}
        duration={toast.duration}
        onHide={toast.hideToast}
      />
    </GestureHandlerRootView>
  );
}
