import { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Plus, Check, Users } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { Colors, Spacing, Radius, TouchTarget, FontSize } from '@/theme';
import { Text, Button, AmountText, Avatar, Divider, Chip } from '@/components';
import { usePaisaStore } from '@/data/local/store';
import { useToastStore } from '@/lib/toast-store';
import { computeBalances, simplifyDebts } from '@/engine/splits';
import { GroupBill, SplitMethod, Paise } from '@/engine/types';
import { rupeesToPaise, formatMoney, toISODate } from '@/lib/format';

const METHODS: Array<{ id: SplitMethod; label: string }> = [
  { id: 'equal', label: 'Equal' },
  { id: 'custom', label: 'Exact ₹' },
  { id: 'percent', label: '%' },
  { id: 'shares', label: 'Shares' },
];

export default function NewSplitScreen() {
  const people = usePaisaStore((s) => s.people);
  const categories = usePaisaStore((s) => s.categories);
  const addPerson = usePaisaStore((s) => s.addPerson);
  const addGroupBill = usePaisaStore((s) => s.addGroupBill);
  const addSettlement = usePaisaStore((s) => s.addSettlement);
  const showToast = useToastStore((s) => s.showToast);

  const activePeople = useMemo(() => people.filter((p) => !p.isArchived), [people]);

  // Form state
  const [title, setTitle] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [categoryId, setCategoryId] = useState<string | undefined>(() => categories[0]?.id);
  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>(() => {
    const me = activePeople.find((p) => p.isMe)?.id ?? 'me';
    const others = activePeople.filter((p) => !p.isMe).slice(0, 1).map((p) => p.id);
    return [me, ...others];
  });
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('equal');

  // Custom shares
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [percentShares, setPercentShares] = useState<Record<string, string>>({});
  const [sharesWeights, setSharesWeights] = useState<Record<string, string>>({});

  // Payer state: single payer vs multi-payer
  const [multiPayer, setMultiPayer] = useState(false);
  const [singlePayerId, setSinglePayerId] = useState<string>('me');
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>({});

  // Inline new friend
  const [newFriendName, setNewFriendName] = useState('');
  const [isAddingFriend, setIsAddingFriend] = useState(false);

  const totalPaise = rupeesToPaise(Number(amountRupees) || 0);

  // Toggle participant
  function togglePerson(id: string) {
    Haptics.selectionAsync();
    setSelectedPersonIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev; // keep at least 1
        return prev.filter((p) => p !== id);
      }
      return [...prev, id];
    });
  }

  // Quick add friend
  function handleAddFriend() {
    const trimmed = newFriendName.trim();
    if (!trimmed) return;
    addPerson({ name: trimmed, isMe: false, isArchived: false });
    const mePerson = people.find((p) => p.isMe);
    // Find newly generated person after store update
    setTimeout(() => {
      const latestPeople = usePaisaStore.getState().people;
      const created = latestPeople.find((p) => p.name === trimmed && !p.isMe);
      if (created) {
        setSelectedPersonIds((prev) => [...prev, created.id]);
      }
    }, 50);
    setNewFriendName('');
    setIsAddingFriend(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  // Build transient GroupBill to calculate preview
  const draftBill: GroupBill = useMemo(() => {
    let payments: Record<string, Paise> = {};
    if (!multiPayer) {
      payments = { [singlePayerId]: totalPaise };
    } else {
      for (const id of selectedPersonIds) {
        const p = rupeesToPaise(Number(payerAmounts[id]) || 0);
        if (p > 0) payments[id] = p;
      }
    }

    const cShares: Record<string, Paise> = {};
    if (splitMethod === 'custom') {
      for (const id of selectedPersonIds) {
        cShares[id] = rupeesToPaise(Number(customAmounts[id]) || 0);
      }
    }

    const pShares: Record<string, number> = {};
    if (splitMethod === 'percent') {
      for (const id of selectedPersonIds) {
        pShares[id] = Number(percentShares[id]) || 0;
      }
    }

    const sWeights: Record<string, number> = {};
    if (splitMethod === 'shares') {
      for (const id of selectedPersonIds) {
        sWeights[id] = Number(sharesWeights[id]) || 1;
      }
    }

    return {
      id: 'draft',
      title: title || 'New Bill',
      date,
      personIds: selectedPersonIds,
      payments,
      method: splitMethod,
      categoryId,
      isSettled: false,
      createdAt: new Date().toISOString(),
      customShares: splitMethod === 'custom' ? cShares : undefined,
      percentShares: splitMethod === 'percent' ? pShares : undefined,
      shareWeights: splitMethod === 'shares' ? sWeights : undefined,
    };
  }, [
    title,
    date,
    selectedPersonIds,
    multiPayer,
    singlePayerId,
    totalPaise,
    payerAmounts,
    splitMethod,
    customAmounts,
    percentShares,
    sharesWeights,
    categoryId,
  ]);

  const balances = useMemo(() => computeBalances(draftBill), [draftBill]);
  const transfers = useMemo(() => simplifyDebts(balances), [balances]);

  // Validation
  const totalPaidSum = Object.values(draftBill.payments).reduce((sum, v) => sum + (v ?? 0), 0);
  const isValidTotal = totalPaise > 0 && totalPaidSum === totalPaise;
  const hasParticipants = selectedPersonIds.length >= 2;
  const canSave = title.trim().length > 0 && isValidTotal && hasParticipants;

  function handleSave() {
    if (!canSave) return;
    try {
      const savedBill = addGroupBill({
        title: title.trim(),
        date,
        personIds: selectedPersonIds,
        payments: draftBill.payments,
        method: splitMethod,
        categoryId,
        isSettled: false,
        customShares: draftBill.customShares,
        percentShares: draftBill.percentShares,
        shareWeights: draftBill.shareWeights,
      });

      // Automatically register initial settlement transfers
      for (const transfer of transfers) {
        addSettlement({
          groupBillId: savedBill.id,
          fromPersonId: transfer.fromPersonId,
          toPersonId: transfer.toPersonId,
          amountPaise: transfer.amountPaise,
          paidAmountPaise: 0,
          isPaid: false,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ message: `Created "${title.trim()}"` });
      router.replace(`/splits/${savedBill.id}`);
    } catch {
      showToast({ message: 'Could not create group bill' });
    }
  }

  function getPerson(id: string) {
    return people.find((p) => p.id === id);
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
        <Text variant="bodySemiBold">New group bill</Text>
        <View style={{ width: TouchTarget }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Title & Amount Card */}
          <View style={styles.card}>
            <Text variant="caption" color={Colors.muted}>Details</Text>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="What was this for? (e.g. Dinner, Rent)"
              placeholderTextColor={Colors.muted}
            />
            <View style={styles.amountInputRow}>
              <Text variant="serifBold" style={{ fontSize: 28, color: Colors.accentLight }}>₹</Text>
              <TextInput
                style={styles.amountInput}
                value={amountRupees}
                onChangeText={setAmountRupees}
                placeholder="0"
                placeholderTextColor={Colors.muted}
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Categories */}
          <View style={styles.card}>
            <Text variant="caption" color={Colors.muted}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
              {categories.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  selected={categoryId === c.id}
                  onPress={() => setCategoryId(c.id)}
                />
              ))}
            </ScrollView>
          </View>

          {/* Participants */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text variant="caption" color={Colors.muted}>
                Participants ({selectedPersonIds.length})
              </Text>
              <Pressable
                onPress={() => setIsAddingFriend((v) => !v)}
                style={styles.inlineAddBtn}
              >
                <Plus size={14} color={Colors.accentLight} />
                <Text variant="caption" color={Colors.accentLight}>Add friend</Text>
              </Pressable>
            </View>

            {isAddingFriend && (
              <View style={styles.addFriendBox}>
                <TextInput
                  style={styles.friendInput}
                  value={newFriendName}
                  onChangeText={setNewFriendName}
                  placeholder="Friend's name…"
                  placeholderTextColor={Colors.muted}
                  autoFocus
                  onSubmitEditing={handleAddFriend}
                />
                <Button label="Add" onPress={handleAddFriend} size="sm" variant="primary" />
              </View>
            )}

            <View style={styles.peopleList}>
              {activePeople.map((person) => {
                const selected = selectedPersonIds.includes(person.id);
                return (
                  <Pressable
                    key={person.id}
                    style={[styles.personChip, selected && styles.personChipSelected]}
                    onPress={() => togglePerson(person.id)}
                  >
                    <Avatar name={person.name} isMe={person.isMe} size={24} />
                    <Text variant="caption" color={selected ? Colors.text : Colors.muted}>
                      {person.name}
                    </Text>
                    {selected && <Check size={14} color={Colors.accentLight} />}
                  </Pressable>
                );
              })}
            </View>
            {selectedPersonIds.length < 2 && (
              <Text variant="caption" color={Colors.overBudget}>
                Select at least 2 participants to split with
              </Text>
            )}
          </View>

          {/* Paid by */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text variant="caption" color={Colors.muted}>Paid by</Text>
              <Pressable onPress={() => setMultiPayer((v) => !v)}>
                <Text variant="caption" color={Colors.accentLight}>
                  {multiPayer ? 'Single payer' : 'Multiple payers'}
                </Text>
              </Pressable>
            </View>

            {!multiPayer ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                {selectedPersonIds.map((id) => {
                  const p = getPerson(id);
                  return (
                    <Chip
                      key={id}
                      label={p?.name ?? id}
                      selected={singlePayerId === id}
                      onPress={() => setSinglePayerId(id)}
                    />
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.shareInputsList}>
                {selectedPersonIds.map((id) => {
                  const p = getPerson(id);
                  return (
                    <View key={id} style={styles.shareInputRow}>
                      <Avatar name={p?.name ?? '?'} isMe={p?.isMe} size={28} />
                      <Text variant="bodyMedium" style={{ flex: 1 }}>{p?.name ?? id}</Text>
                      <View style={styles.rupeeInputWrapper}>
                        <Text variant="caption" color={Colors.muted}>₹</Text>
                        <TextInput
                          style={styles.shareTextInput}
                          value={payerAmounts[id] ?? ''}
                          onChangeText={(val) => setPayerAmounts((prev) => ({ ...prev, [id]: val }))}
                          placeholder="0"
                          placeholderTextColor={Colors.muted}
                          keyboardType="numeric"
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Split Method */}
          <View style={styles.card}>
            <Text variant="caption" color={Colors.muted}>Split method</Text>
            <View style={styles.methodSelector}>
              {METHODS.map((m) => (
                <Pressable
                  key={m.id}
                  style={[styles.methodBtn, splitMethod === m.id && styles.methodBtnActive]}
                  onPress={() => {
                    setSplitMethod(m.id);
                    Haptics.selectionAsync();
                  }}
                >
                  <Text
                    variant="caption"
                    color={splitMethod === m.id ? Colors.text : Colors.muted}
                  >
                    {m.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Custom Inputs per Method */}
            {splitMethod === 'custom' && (
              <View style={styles.shareInputsList}>
                {selectedPersonIds.map((id) => {
                  const p = getPerson(id);
                  return (
                    <View key={id} style={styles.shareInputRow}>
                      <Text variant="bodyMedium" style={{ flex: 1 }}>{p?.name ?? id}</Text>
                      <View style={styles.rupeeInputWrapper}>
                        <Text variant="caption" color={Colors.muted}>₹</Text>
                        <TextInput
                          style={styles.shareTextInput}
                          value={customAmounts[id] ?? ''}
                          onChangeText={(val) => setCustomAmounts((prev) => ({ ...prev, [id]: val }))}
                          placeholder="0"
                          placeholderTextColor={Colors.muted}
                          keyboardType="numeric"
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {splitMethod === 'percent' && (
              <View style={styles.shareInputsList}>
                {selectedPersonIds.map((id) => {
                  const p = getPerson(id);
                  return (
                    <View key={id} style={styles.shareInputRow}>
                      <Text variant="bodyMedium" style={{ flex: 1 }}>{p?.name ?? id}</Text>
                      <View style={styles.rupeeInputWrapper}>
                        <TextInput
                          style={styles.shareTextInput}
                          value={percentShares[id] ?? ''}
                          onChangeText={(val) => setPercentShares((prev) => ({ ...prev, [id]: val }))}
                          placeholder="0"
                          placeholderTextColor={Colors.muted}
                          keyboardType="numeric"
                        />
                        <Text variant="caption" color={Colors.muted}>%</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {splitMethod === 'shares' && (
              <View style={styles.shareInputsList}>
                {selectedPersonIds.map((id) => {
                  const p = getPerson(id);
                  return (
                    <View key={id} style={styles.shareInputRow}>
                      <Text variant="bodyMedium" style={{ flex: 1 }}>{p?.name ?? id}</Text>
                      <View style={styles.rupeeInputWrapper}>
                        <TextInput
                          style={styles.shareTextInput}
                          value={sharesWeights[id] ?? '1'}
                          onChangeText={(val) => setSharesWeights((prev) => ({ ...prev, [id]: val }))}
                          placeholder="1"
                          placeholderTextColor={Colors.muted}
                          keyboardType="numeric"
                        />
                        <Text variant="caption" color={Colors.muted}>share(s)</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Balance Preview */}
          {totalPaise > 0 && selectedPersonIds.length >= 2 && (
            <View style={styles.card}>
              <Text variant="caption" color={Colors.muted}>Breakdown preview</Text>
              {balances.map((b, i) => {
                const p = getPerson(b.personId);
                const isCreditor = b.net > 0;
                return (
                  <View key={b.personId}>
                    <View style={styles.previewRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                        <Avatar name={p?.name ?? '?'} isMe={p?.isMe} size={24} />
                        <Text variant="caption">{p?.name ?? b.personId}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text variant="caption" color={Colors.muted}>
                          share {formatMoney(b.share)} · paid {formatMoney(b.paid)}
                        </Text>
                        <AmountText
                          paise={Math.abs(b.net)}
                          color={b.net === 0 ? Colors.muted : isCreditor ? Colors.income : Colors.expense}
                          showSign={false}
                        />
                      </View>
                    </View>
                    {i < balances.length - 1 && <Divider />}
                  </View>
                );
              })}
            </View>
          )}

          {/* Action button */}
          <Button
            label="Create group bill"
            onPress={handleSave}
            variant="primary"
            size="lg"
            disabled={!canSave}
            style={{ marginTop: Spacing.sm, marginBottom: Spacing.xxl }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
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
  scroll: { padding: Spacing.base, gap: Spacing.base },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleInput: {
    fontSize: FontSize.lg,
    color: Colors.text,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    paddingVertical: Spacing.xs,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  amountInput: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  categoryRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingVertical: 2,
  },
  inlineAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
  },
  addFriendBox: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  friendInput: {
    flex: 1,
    height: 38,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    color: Colors.text,
  },
  peopleList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  personChipSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.surface,
  },
  methodSelector: {
    flexDirection: 'row',
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    padding: 2,
    gap: 2,
  },
  methodBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },
  methodBtnActive: {
    backgroundColor: Colors.surface,
  },
  shareInputsList: {
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  shareInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rupeeInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface2,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    gap: 4,
    minWidth: 90,
  },
  shareTextInput: {
    height: 36,
    color: Colors.text,
    textAlign: 'right',
    minWidth: 50,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
});
