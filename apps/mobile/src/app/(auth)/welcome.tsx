import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, FontSize, Fonts, Spacing, Radius, TouchTarget } from '@/theme';

import { Text as AppText } from '@/components';
import { Button } from '@/components';
import { authenticate, ApiError } from '@/data/remote/api';
import { startSyncService } from '@/data/remote/sync';
import { useSyncStatus } from '@/lib/sync-status';
import { activateGuestStore, activateStoreForUser, useFinancerStore } from '@/data/local/store';

type AuthMode = 'welcome' | 'signin' | 'register';

export default function WelcomeScreen() {
  const [mode, setMode] = useState<AuthMode>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isOnboarded = useFinancerStore((s) => s.isOnboarded);

  async function handleContinue() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const session = await authenticate(mode === 'signin' ? 'login' : 'register', email, password);
      await activateStoreForUser(session.user.id);
      if (name.trim()) {
        useFinancerStore.getState().updatePerson('me', { name: name.trim() });
      }
      try {
        startSyncService((status, message) => useSyncStatus.getState().setStatus(status, message));
      } catch {
        // Safe when offline
      }
      const onboarded = useFinancerStore.getState().isOnboarded;
      router.replace(onboarded ? '/(tabs)' : '/(auth)/onboarding-budget');
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Could not connect to your account.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero */}
          <View style={styles.hero}>
            <AppText variant="serifBold" style={styles.wordmark}>
              Financer
            </AppText>
            <AppText variant="body" color={Colors.text2} center style={styles.tagline}>
              Track fast. Budget smart. Settle fair.
            </AppText>
          </View>

          {mode === 'welcome' && (
            <View style={styles.actions}>
              <Button
                label="Get started"
                onPress={() => setMode('register')}
                variant="primary"
                fullWidth
                size="lg"
              />
              <Button
                label="Sign in"
                onPress={() => setMode('signin')}
                variant="ghost"
                fullWidth
                size="lg"
              />
              <Button
                label="Use as guest"
                accessibilityLabel="Use as guest"
                onPress={() => {
                  void activateGuestStore().then(() => {
                    const onboarded = useFinancerStore.getState().isOnboarded;
                    router.replace(onboarded ? '/(tabs)' : '/(auth)/onboarding-budget');
                  });
                }}
                variant="ghost"
                fullWidth
                size="lg"
              />
            </View>
          )}

          {(mode === 'signin' || mode === 'register') && (
            <View style={styles.form}>
              {mode === 'register' && (
                <View style={styles.field}>
                  <AppText variant="label" color={Colors.text2} style={styles.fieldLabel}>
                    Your name
                  </AppText>
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Rahul"
                    placeholderTextColor={Colors.muted}
                    autoCapitalize="words"
                    returnKeyType="next"
                    accessibilityLabel="Your name"
                  />
                </View>
              )}
              <View style={styles.field}>
                <AppText variant="label" color={Colors.text2} style={styles.fieldLabel}>
                  Email
                </AppText>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={Colors.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="next"
                  accessibilityLabel="Email address"
                />
              </View>
              <View style={styles.field}>
                <AppText variant="label" color={Colors.text2} style={styles.fieldLabel}>
                  Password
                </AppText>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={Colors.muted}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleContinue}
                  accessibilityLabel="Password"
                />
                {mode === 'register' && password.length > 0 && password.length < 12 ? (
                  <AppText variant="caption" color={Colors.muted}>Use at least 12 characters for your password.</AppText>
                ) : null}
              </View>

              <Button
                label={mode === 'signin' ? 'Sign in' : 'Create account'}
                onPress={handleContinue}
                variant="primary"
                fullWidth
                size="lg"
                loading={loading}
                disabled={!email || !password || (mode === 'register' && (!name.trim() || password.length < 12))}
              />
              {error ? <AppText variant="caption" color={Colors.overBudget}>{error}</AppText> : null}

              <Pressable
                onPress={() => setMode(mode === 'signin' ? 'register' : 'signin')}
                style={styles.switchMode}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  mode === 'signin' ? 'Switch to create account' : 'Switch to sign in'
                }
              >
                <AppText variant="body" color={Colors.text2} center>
                  {mode === 'signin'
                    ? "Don't have an account? "
                    : 'Already have an account? '}
                  <AppText variant="bodySemiBold" color={Colors.accentLight}>
                    {mode === 'signin' ? 'Register' : 'Sign in'}
                  </AppText>
                </AppText>
              </Pressable>
            </View>
          )}

          <AppText variant="caption" color={Colors.muted} center style={styles.disclaimer}>
            Guest data stays on this device and is not automatically transferred. Account data syncs when you are signed in and online. No bank access required.
          </AppText>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    justifyContent: 'center',
    gap: Spacing.xl,
  },
  hero: {
    alignItems: 'center',
    paddingTop: Spacing.xxxl,
    gap: Spacing.sm,
  },
  wordmark: {
    fontSize: 56,
    color: Colors.text,
    letterSpacing: -1,
  },
  tagline: {
    marginTop: Spacing.sm,
    maxWidth: 260,
  },
  actions: {
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  form: {
    gap: Spacing.base,
    marginTop: Spacing.xl,
  },
  field: {
    gap: Spacing.xs,
  },
  fieldLabel: {
    marginLeft: 2,
  },
  input: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.hairline,
    height: 48,
    paddingHorizontal: Spacing.base,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: FontSize.base,
  },
  switchMode: {
    alignItems: 'center',
    minHeight: TouchTarget,
    justifyContent: 'center',
  },
  disclaimer: {
    marginTop: Spacing.lg,
    lineHeight: 18,
  },
});
