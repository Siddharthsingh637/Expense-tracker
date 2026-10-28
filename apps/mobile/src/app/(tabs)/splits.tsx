/**
 * Splits tab — Phase A stub. Full implementation in Phase D.
 */
import { ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Users, Plus, ArrowRight } from 'lucide-react-native';

import { Colors, Spacing, Radius, TouchTarget } from '@/theme';
import { Text, AmountText, EmptyState, Divider, Avatar } from '@/components';
import { useFinancerStore } from '@/data/local/store';
import { computeBalances } from '@/engine/splits';
import { formatMoney, formatDate } from '@/lib/format';
import { ME_PERSON_ID } from '@/lib/constants';

export default function SplitsScreen() {
  const groupBills = useFinancerStore((s) => s.groupBills);
  const people = useFinancerStore((s) => s.people);

  const openBills = groupBills.filter((b) => !b.isSettled);
  const settledBills = groupBills.filter((b) => b.isSettled);

  function getMyNet(billId: string) {
    const bill = groupBills.find((b) => b.id === billId);
    if (!bill) return 0;
    const balances = computeBalances(bill);
    return balances.find((b) => b.personId === ME_PERSON_ID)?.net ?? 0;
  }

  function getPersonName(id: string) {
    return people.find((p) => p.id === id)?.name ?? 'Unknown';
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text variant="serifBold" style={styles.title}>Splits</Text>
          <Pressable
            style={styles.addBtn}
            onPress={() => router.push('/splits/new')}
            accessibilityRole="button"
            accessibilityLabel="New group bill"
          >
            <Plus size={16} color={Colors.text} />
            <Text variant="label" color={Colors.text}>New bill</Text>
          </Pressable>
        </View>

        {/* People quick-link */}
        <Pressable
          style={styles.peopleRow}
          onPress={() => router.push('/splits/people')}
          accessibilityRole="button"
          accessibilityLabel="Manage people"
        >
          <View style={styles.avatarStack}>
            {people.filter((p) => !p.isArchived).slice(0, 4).map((p, i) => (
              <View key={p.id} style={[styles.avatarWrap, { marginLeft: i > 0 ? -8 : 0 }]}>
                <Avatar name={p.name} isMe={p.isMe} size={28} />
              </View>
            ))}
          </View>
          <Text variant="label" color={Colors.text2}>Manage people</Text>
          <ArrowRight size={14} color={Colors.muted} />
        </Pressable>

        {/* Open bills */}
        {openBills.length === 0 && settledBills.length === 0 ? (
          <EmptyState
            icon={<Users size={40} color={Colors.muted} />}
            title="No group bills"
            subtitle="Tap 'New bill' to split expenses with friends"
            action={{ label: 'New group bill', onPress: () => router.push('/splits/new') }}
          />
        ) : (
          <>
            {openBills.length > 0 && (
              <View style={styles.section}>
                <Text variant="bodySemiBold" color={Colors.text2} style={styles.sectionLabel}>
                  Open ({openBills.length})
                </Text>
                {openBills.map((bill, i) => {
                  const myNet = getMyNet(bill.id);
                  const isCreditor = myNet > 0;
                  const isDebtor = myNet < 0;
                  return (
                    <View key={bill.id}>
                      <Pressable
                        style={styles.billRow}
                        onPress={() => router.push(`/splits/${bill.id}`)}
                        accessibilityRole="button"
                        accessibilityLabel={`${bill.title}, ${isCreditor ? 'you are owed' : isDebtor ? 'you owe' : 'settled'} ${formatMoney(Math.abs(myNet))}`}
                      >
                        <View style={styles.billInfo}>
                          <Text variant="bodyMedium" numberOfLines={1}>{bill.title}</Text>
                          <Text variant="caption" color={Colors.muted}>
                            {formatDate(bill.date)} · {bill.personIds.length} people
                          </Text>
                        </View>
                        <View style={styles.billNet}>
                          {myNet === 0 ? (
                            <Text variant="label" color={Colors.muted}>Settled</Text>
                          ) : (
                            <>
                              <Text variant="caption" color={isCreditor ? Colors.income : Colors.expense}>
                                {isCreditor ? 'You are owed' : 'You owe'}
                              </Text>
                              <AmountText
                                paise={Math.abs(myNet)}
                                variant="medium"
                                color={isCreditor ? Colors.income : Colors.expense}
                              />
                            </>
                          )}
                        </View>
                      </Pressable>
                      {i < openBills.length - 1 && <Divider inset={Spacing.sm} />}
                    </View>
                  );
                })}
              </View>
            )}

            {settledBills.length > 0 && (
              <View style={styles.section}>
                <Text variant="bodySemiBold" color={Colors.text2} style={styles.sectionLabel}>
                  Settled
                </Text>
                {settledBills.slice(0, 5).map((bill, i) => (
                  <View key={bill.id}>
                    <Pressable
                      style={styles.billRow}
                      onPress={() => router.push(`/splits/${bill.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`${bill.title}, settled`}
                    >
                      <View style={styles.billInfo}>
                        <Text variant="bodyMedium" color={Colors.text2} numberOfLines={1}>{bill.title}</Text>
                        <Text variant="caption" color={Colors.muted}>{formatDate(bill.date)}</Text>
                      </View>
                      <Text variant="label" color={Colors.muted}>✓ Done</Text>
                    </Pressable>
                    {i < Math.min(settledBills.length, 5) - 1 && <Divider inset={Spacing.sm} />}
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.base, gap: Spacing.base, paddingBottom: 100 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.sm,
  },
  title: { fontSize: 28, color: Colors.text },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    height: 36,
  },
  peopleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    minHeight: TouchTarget,
  },
  avatarStack: { flexDirection: 'row' },
  avatarWrap: { zIndex: 1 },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.sm,
  },
  sectionLabel: { marginBottom: Spacing.xs },
  billRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: TouchTarget,
    gap: Spacing.sm,
  },
  billInfo: { flex: 1, gap: 2 },
  billNet: { alignItems: 'flex-end', gap: 2 },
});
