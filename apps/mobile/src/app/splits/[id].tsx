import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ArrowRight, CheckCircle2, Circle } from 'lucide-react-native';

import { Colors, Spacing, Radius, TouchTarget } from '@/theme';
import { Text, AmountText, Avatar, Divider, Button } from '@/components';
import { usePaisaStore } from '@/data/local/store';
import { computeBalances, simplifyDebts } from '@/engine/splits';
import { formatMoney, formatDate } from '@/lib/format';

export default function SplitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupBills = usePaisaStore((s) => s.groupBills);
  const people = usePaisaStore((s) => s.people);
  const billSettlements = usePaisaStore((s) => s.billSettlements);
  const addSettlement = usePaisaStore((s) => s.addSettlement);
  const updateSettlement = usePaisaStore((s) => s.updateSettlement);
  const updateGroupBill = usePaisaStore((s) => s.updateGroupBill);

  const bill = groupBills.find((b) => b.id === id);

  if (!bill) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text variant="body" color={Colors.muted} center style={{ margin: Spacing.xxxl }}>
          Split not found.
        </Text>
      </SafeAreaView>
    );
  }

  const balances = computeBalances(bill);
  const transfers = simplifyDebts(balances);
  const total = Object.values(bill.payments).reduce((s, v) => s + v, 0);

  function getPerson(personId: string) {
    return people.find((p) => p.id === personId);
  }

  function getSettlement(fromId: string, toId: string) {
    return billSettlements.find(
      (s) => s.groupBillId === bill!.id && s.fromPersonId === fromId && s.toPersonId === toId
    );
  }

  function handleToggleSettlement(fromId: string, toId: string, amount: number) {
    const existing = getSettlement(fromId, toId);
    const nowIso = new Date().toISOString();

    if (existing) {
      const willBePaid = !existing.isPaid;
      updateSettlement(existing.id, {
        isPaid: willBePaid,
        paidAmountPaise: willBePaid ? amount : 0,
        paidAt: willBePaid ? nowIso : undefined,
      });
    } else {
      addSettlement({
        groupBillId: bill!.id,
        fromPersonId: fromId,
        toPersonId: toId,
        amountPaise: amount,
        paidAmountPaise: amount,
        isPaid: true,
        paidAt: nowIso,
      });
    }

    // Check if all transfers are now settled
    const updatedSettlements = usePaisaStore.getState().billSettlements;
    const allSettled = transfers.every((t) => {
      const s = updatedSettlements.find(
        (rec) => rec.groupBillId === bill!.id && rec.fromPersonId === t.fromPersonId && rec.toPersonId === t.toPersonId
      );
      return s ? s.isPaid : false;
    });

    if (allSettled !== bill!.isSettled) {
      updateGroupBill(bill!.id, { isSettled: allSettled });
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <Text variant="bodySemiBold" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          {bill.title}
        </Text>
        <View style={{ width: TouchTarget }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Summary */}
        <View style={styles.summaryCard}>
          <Text variant="caption" color={Colors.muted}>Total</Text>
          <AmountText paise={total} variant="large" />
          <Text variant="caption" color={Colors.muted}>
            {formatDate(bill.date)} · {bill.personIds.length} people · {bill.method} split
          </Text>
          {bill.isSettled ? (
            <View style={styles.settledBadge}>
              <CheckCircle2 size={14} color={Colors.income} />
              <Text variant="caption" color={Colors.income}>Fully Settled</Text>
            </View>
          ) : null}
        </View>

        {/* Balances */}
        <View style={styles.section}>
          <Text variant="bodySemiBold" style={styles.sectionTitle}>Balances</Text>
          {balances.map((b, i) => {
            const person = getPerson(b.personId);
            const isCreditor = b.net > 0;
            return (
              <View key={b.personId}>
                <View style={styles.balanceRow}>
                  <View style={styles.personInfo}>
                    <Avatar name={person?.name ?? '?'} isMe={person?.isMe} size={32} />
                    <View>
                      <Text variant="bodyMedium">{person?.name ?? b.personId}</Text>
                      <Text variant="caption" color={Colors.muted}>
                        paid {formatMoney(b.paid)} · share {formatMoney(b.share)}
                      </Text>
                    </View>
                  </View>
                  <AmountText
                    paise={Math.abs(b.net)}
                    variant="medium"
                    color={b.net === 0 ? Colors.muted : isCreditor ? Colors.income : Colors.expense}
                    showSign={false}
                  />
                </View>
                {i < balances.length - 1 && <Divider inset={44} />}
              </View>
            );
          })}
        </View>

        {/* Settlement plan */}
        <View style={styles.section}>
          <Text variant="bodySemiBold" style={styles.sectionTitle}>
            Settle up — {transfers.length} transfer{transfers.length !== 1 ? 's' : ''}
          </Text>
          {transfers.length === 0 ? (
            <Text variant="body" color={Colors.income}>Everyone is settled! 🎉</Text>
          ) : (
            transfers.map((t, i) => {
              const from = getPerson(t.fromPersonId);
              const to = getPerson(t.toPersonId);
              const settlement = getSettlement(t.fromPersonId, t.toPersonId);
              const isPaid = settlement?.isPaid ?? false;

              return (
                <View key={i} style={styles.transferCard}>
                  <View style={styles.transferRow}>
                    <Avatar name={from?.name ?? '?'} isMe={from?.isMe} size={28} />
                    <View style={styles.transferArrow}>
                      <Text variant="caption" color={Colors.muted}>pays</Text>
                      <AmountText paise={t.amountPaise} variant="medium" />
                      <ArrowRight size={14} color={Colors.muted} />
                    </View>
                    <Avatar name={to?.name ?? '?'} isMe={to?.isMe} size={28} />
                  </View>
                  <View style={styles.transferFooter}>
                    <Text variant="caption" color={Colors.muted}>
                      {from?.name} → {to?.name}
                    </Text>
                    <Pressable
                      style={[styles.markPaidBtn, isPaid && styles.markPaidBtnActive]}
                      onPress={() => handleToggleSettlement(t.fromPersonId, t.toPersonId, t.amountPaise)}
                      accessibilityRole="button"
                    >
                      {isPaid ? (
                        <>
                          <CheckCircle2 size={14} color={Colors.income} />
                          <Text variant="caption" color={Colors.income}>Paid</Text>
                        </>
                      ) : (
                        <>
                          <Circle size={14} color={Colors.muted} />
                          <Text variant="caption" color={Colors.text}>Mark as paid</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                  {i < transfers.length - 1 && <Divider style={{ marginTop: Spacing.sm }} />}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  backBtn: { width: TouchTarget, height: TouchTarget, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.base, gap: Spacing.base, paddingBottom: 40 },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  settledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(46, 204, 113, 0.12)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    marginTop: Spacing.xs,
  },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.sm,
  },
  sectionTitle: { marginBottom: Spacing.xs },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    minHeight: TouchTarget,
  },
  personInfo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  transferCard: {
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  transferRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  transferArrow: { alignItems: 'center', gap: 2 },
  transferFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
  },
  markPaidBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface2,
  },
  markPaidBtnActive: {
    backgroundColor: 'rgba(46, 204, 113, 0.12)',
  },
});
