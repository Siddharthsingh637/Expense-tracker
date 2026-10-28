import { router } from 'expo-router';
import { useState } from 'react';
import {
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { Colors, Spacing, Radius, Fonts, FontSize, TouchTarget } from '@/theme';
import { Text, Button, Keypad, AmountText } from '@/components';
import { useFinancerStore } from '@/data/local/store';
import { rupeesToPaise } from '@/lib/format';

const START_DAYS = [1, 5, 10, 15, 20, 25];

export default function OnboardingBudgetScreen() {
  const currentMonth = useFinancerStore((s) => s.currentMonth);
  const monthBudgets = useFinancerStore((s) => s.monthBudgets);
  const budgetStartDay = useFinancerStore((s) => s.budgetStartDay);
  const existingBudget = monthBudgets.find((b) => b.month === currentMonth);

  const [amountStr, setAmountStr] = useState(
    existingBudget && existingBudget.totalPaise > 0 ? String(Math.floor(existingBudget.totalPaise / 100)) : ''
  );
  const [startDay, setStartDay] = useState(existingBudget?.startDay ?? budgetStartDay ?? 1);

  const setMonthBudget = useFinancerStore((s) => s.setMonthBudget);
  const setBudgetStartDay = useFinancerStore((s) => s.setBudgetStartDay);
  const completeOnboarding = useFinancerStore((s) => s.completeOnboarding);

  const paise = amountStr ? rupeesToPaise(Number(amountStr)) : 0;
  const canContinue = paise >= 100_00; // min ₹100

  function handleContinue() {
    if (!canContinue) return;
    setBudgetStartDay(startDay);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setMonthBudget({ month, totalPaise: paise, startDay });
    router.push('/(auth)/onboarding-map');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          scrollEnabled={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text variant="bodySemiBold" color={Colors.muted}>
              Step 1 of 2
            </Text>
            <Text variant="serifBold" style={styles.title}>
              How much do you have this month?
            </Text>
            <Text variant="body" color={Colors.text2}>
              Enter the money you want to budget — salary, stipend, or whatever you receive.
            </Text>
          </View>

          {/* Amount display */}
          <View style={styles.amountArea}>
            {paise > 0 ? (
              <AmountText paise={paise} variant="hero" animated />
            ) : (
              <Text variant="serifBold" style={styles.placeholder}>
                ₹0
              </Text>
            )}
          </View>

          {/* Budget start day */}
          <View style={styles.startDayArea}>
            <Text variant="label" color={Colors.text2} style={styles.startDayLabel}>
              Budget starts on the{' '}
              <Text variant="label" color={Colors.accentLight}>
                {startDay}
                {ordinal(startDay)}
              </Text>{' '}
              of each month
            </Text>
            <View style={styles.startDayRow}>
              {START_DAYS.map((d) => (
                <Pressable
                  key={d}
                  style={[
                    styles.dayChip,
                    d === startDay && styles.dayChipActive,
                  ]}
                  onPress={() => {
                    setStartDay(d);
                    Haptics.selectionAsync();
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={`Budget starts on ${d}${ordinal(d)}`}
                  accessibilityState={{ selected: d === startDay }}
                >
                  <Text
                    variant="bodySemiBold"
                    color={d === startDay ? Colors.text : Colors.text2}
                  >
                    {d}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Keypad */}
          <Keypad value={amountStr} onChange={setAmountStr} style={styles.keypad} />

          {/* Continue */}
          <View style={styles.footer}>
            <Button
              label="Set up budget categories →"
              onPress={handleContinue}
              variant="primary"
              fullWidth
              size="lg"
              disabled={!canContinue}
            />
            {!canContinue && amountStr.length > 0 && (
              <Text variant="caption" color={Colors.muted} center>
                Enter at least ₹100
              </Text>
            )}
            <Button
              label="Skip for now"
              onPress={() => {
                completeOnboarding();
                router.replace('/(tabs)');
              }}
              variant="ghost"
              fullWidth
              size="md"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ordinal(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.xl,
  },
  header: {
    paddingTop: Spacing.xl,
    gap: Spacing.sm,
  },
  title: {
    fontSize: FontSize.xl,
    lineHeight: 34,
    color: Colors.text,
  },
  amountArea: {
    alignItems: 'center',
    minHeight: 80,
    justifyContent: 'center',
  },
  placeholder: {
    fontSize: FontSize.hero,
    color: Colors.muted,
  },
  startDayArea: {
    gap: Spacing.sm,
  },
  startDayLabel: {
    lineHeight: 20,
  },
  startDayRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  dayChip: {
    width: 44,
    height: TouchTarget,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  keypad: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  footer: {
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
});
