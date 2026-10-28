import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  Search,
  CreditCard,
  Trash2,
  Image as ImageIcon,
  SlidersHorizontal,
  X,
} from 'lucide-react-native';

import { Colors, Spacing, Radius, TouchTarget, Fonts, FontSize } from '@/theme';
import { Text, EmptyState, Divider, Chip, Button } from '@/components';
import { useFinancerStore } from '@/data/local/store';
import { useToastStore } from '@/lib/toast-store';
import { formatMoney, formatDate, toYYYYMM } from '@/lib/format';
import { Transaction, PaymentMode } from '@/engine/types';
import { PAYMENT_MODE_LABELS } from '@/lib/constants';

type DateFilter = 'all' | 'this_month' | 'last_30_days';

export default function TransactionListScreen() {
  const transactions = useFinancerStore((s) => s.transactions);
  const categories = useFinancerStore((s) => s.categories);
  const currentMonth = useFinancerStore((s) => s.currentMonth);
  const deleteTransaction = useFinancerStore((s) => s.deleteTransaction);
  const restoreTransaction = useFinancerStore((s) => s.restoreTransaction);
  const showToast = useToastStore((s) => s.showToast);

  // Filters State
  const [search, setSearch] = useState('');
  const [selectedCatId, setSelectedCatId] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [hasBillOnly, setHasBillOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedCatId !== 'all') count++;
    if (dateFilter !== 'all') count++;
    if (paymentFilter !== 'all') count++;
    if (hasBillOnly) count++;
    return count;
  }, [selectedCatId, dateFilter, paymentFilter, hasBillOnly]);

  // Reset all filters
  function resetFilters() {
    setSelectedCatId('all');
    setDateFilter('all');
    setPaymentFilter('all');
    setHasBillOnly(false);
    setSearch('');
    Haptics.selectionAsync();
  }

  // Filtered transactions
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const now = new Date();
    const thirtyDaysAgoStr = new Date(now.getTime() - 30 * 86_400_000)
      .toISOString()
      .split('T')[0];

    return transactions
      .filter((t) => t.amount > 0 && !t.isTransfer)
      .filter((t) => {
        // Search query
        if (q && !t.place.toLowerCase().includes(q) && !t.note.toLowerCase().includes(q)) {
          return false;
        }
        // Category filter
        if (selectedCatId !== 'all' && t.categoryId !== selectedCatId) {
          return false;
        }
        // Date range filter
        if (dateFilter === 'this_month') {
          if (!t.date.startsWith(currentMonth)) return false;
        } else if (dateFilter === 'last_30_days') {
          if (t.date < thirtyDaysAgoStr) return false;
        }
        // Payment mode filter
        if (paymentFilter !== 'all' && t.paymentMode !== paymentFilter) {
          return false;
        }
        // Has bill filter
        if (hasBillOnly && !t.billPhotoUri) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.date === a.date ? (b.createdAt > a.createdAt ? 1 : -1) : b.date > a.date ? 1 : -1));
  }, [
    transactions,
    search,
    selectedCatId,
    dateFilter,
    currentMonth,
    paymentFilter,
    hasBillOnly,
  ]);

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of filtered) {
      const key = t.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).sort(([a], [b]) => (b > a ? 1 : -1));
  }, [filtered]);

  // Total amount of currently filtered transactions
  const totalFilteredPaise = useMemo(() => {
    return filtered.reduce((s, t) => s + t.amount, 0);
  }, [filtered]);

  // Delete transaction with Undo Toast
  function handleDelete(txn: Transaction) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    deleteTransaction(txn.id);

    showToast({
      message: `Deleted ${txn.place || 'Expense'} (${formatMoney(txn.amount)})`,
      actions: [
        {
          label: 'Undo',
          onPress: () => {
            restoreTransaction(txn);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            showToast({ message: 'Expense restored' });
          },
        },
      ],
    });
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <Text variant="bodySemiBold">All Transactions</Text>
        <Pressable
          onPress={() => {
            setShowFilters(!showFilters);
            Haptics.selectionAsync();
          }}
          style={[styles.filterToggleBtn, activeFilterCount > 0 && styles.filterToggleActive]}
          accessibilityRole="button"
          accessibilityLabel={`Filter transactions. ${activeFilterCount} active filters`}
        >
          <SlidersHorizontal
            size={18}
            color={activeFilterCount > 0 ? Colors.accentLight : Colors.text2}
          />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text variant="captionBold" color={Colors.text}>
                {activeFilterCount}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Search Input */}
      <View style={styles.searchRow}>
        <Search size={16} color={Colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search place or note…"
          placeholderTextColor={Colors.muted}
          accessibilityLabel="Search transactions"
        />
        {search.length > 0 && (
          <Pressable
            onPress={() => setSearch('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <X size={16} color={Colors.muted} />
          </Pressable>
        )}
      </View>

      {/* Expandable Filter Chips Section */}
      {showFilters && (
        <View style={styles.filtersPanel}>
          {/* Category Filter Chips */}
          <View style={styles.filterGroup}>
            <Text variant="caption" color={Colors.muted}>
              Category:
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
              <Chip
                label="All"
                selected={selectedCatId === 'all'}
                onPress={() => setSelectedCatId('all')}
              />
              {categories.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  selected={selectedCatId === c.id}
                  color={c.color}
                  onPress={() => setSelectedCatId(c.id)}
                />
              ))}
            </ScrollView>
          </View>

          {/* Date Range Chips */}
          <View style={styles.filterGroup}>
            <Text variant="caption" color={Colors.muted}>
              Date Range:
            </Text>
            <View style={styles.filterChipRow}>
              <Chip
                label="All Time"
                selected={dateFilter === 'all'}
                onPress={() => setDateFilter('all')}
              />
              <Chip
                label="This Month"
                selected={dateFilter === 'this_month'}
                onPress={() => setDateFilter('this_month')}
              />
              <Chip
                label="Last 30 Days"
                selected={dateFilter === 'last_30_days'}
                onPress={() => setDateFilter('last_30_days')}
              />
            </View>
          </View>

          {/* Payment Mode & Bill Photo Toggle */}
          <View style={styles.filterGroup}>
            <Text variant="caption" color={Colors.muted}>
              Payment Mode:
            </Text>
            <View style={styles.filterChipRow}>
              <Chip
                label="All"
                selected={paymentFilter === 'all'}
                onPress={() => setPaymentFilter('all')}
              />
              {(['upi', 'cash', 'card'] as PaymentMode[]).map((m) => (
                <Chip
                  key={m}
                  label={PAYMENT_MODE_LABELS[m]}
                  selected={paymentFilter === m}
                  onPress={() => setPaymentFilter(m)}
                />
              ))}
              <Chip
                label="Has Receipt"
                selected={hasBillOnly}
                icon={<ImageIcon size={14} color={hasBillOnly ? Colors.text : Colors.muted} />}
                onPress={() => setHasBillOnly(!hasBillOnly)}
              />
            </View>
          </View>

          {/* Clear Filters Button */}
          {activeFilterCount > 0 && (
            <Pressable
              style={styles.resetFiltersBtn}
              onPress={resetFilters}
              accessibilityRole="button"
            >
              <Text variant="captionBold" color={Colors.accentLight}>
                Reset all filters
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Subheader: Results count & Total spend */}
      <View style={styles.statsRow}>
        <Text variant="caption" color={Colors.muted}>
          Showing {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
        </Text>
        <Text variant="label" color={Colors.text2}>
          Total: <Text variant="bodySemiBold" color={Colors.text}>{formatMoney(totalFilteredPaise)}</Text>
        </Text>
      </View>

      {/* Transaction List */}
      {grouped.length === 0 ? (
        <EmptyState
          icon={<CreditCard size={40} color={Colors.muted} />}
          title={search || activeFilterCount > 0 ? 'No matching transactions' : 'No transactions yet'}
          subtitle={
            search || activeFilterCount > 0
              ? 'Try adjusting your filters or search terms'
              : 'Tap + to add your first expense'
          }
          action={
            activeFilterCount > 0
              ? { label: 'Clear filters', onPress: resetFilters }
              : undefined
          }
        />
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={([date]) => date}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: [date, txns] }) => (
            <View style={styles.dayGroup}>
              <View style={styles.dayHeader}>
                <Text variant="captionBold" color={Colors.muted} style={styles.dayLabel}>
                  {formatDate(date).toUpperCase()}
                </Text>
                <Text variant="caption" color={Colors.muted}>
                  {formatMoney(txns.reduce((s, t) => s + t.amount, 0))}
                </Text>
              </View>

              <View style={styles.dayCard}>
                {txns.map((txn, i) => {
                  const cat = categories.find((c) => c.id === txn.categoryId);
                  return (
                    <View key={txn.id}>
                      <Pressable
                        style={styles.txnRow}
                        onPress={() => router.push(`/transaction/${txn.id}`)}
                        accessibilityRole="button"
                        accessibilityLabel={`${txn.place}, ${formatMoney(txn.amount)}, ${cat?.name}`}
                      >
                        <View
                          style={[
                            styles.catDot,
                            { backgroundColor: cat?.color ?? Colors.muted },
                          ]}
                        />
                        <View style={styles.txnInfo}>
                          <View style={styles.placeTitleRow}>
                            <Text variant="bodyMedium" numberOfLines={1}>
                              {txn.place || 'Expense'}
                            </Text>
                            {txn.billPhotoUri ? (
                              <ImageIcon size={12} color={Colors.muted} />
                            ) : null}
                          </View>
                          <Text variant="caption" color={Colors.muted}>
                            {cat?.name} · {PAYMENT_MODE_LABELS[txn.paymentMode]}
                            {txn.note ? ` · "${txn.note}"` : ''}
                          </Text>
                        </View>

                        <Text variant="bodySemiBold" color={Colors.expense}>
                          {formatMoney(txn.amount)}
                        </Text>

                        {/* Direct delete button with undo */}
                        <Pressable
                          style={styles.deleteActionBtn}
                          onPress={() => handleDelete(txn)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${txn.place}`}
                        >
                          <Trash2 size={16} color={Colors.muted} />
                        </Pressable>
                      </Pressable>
                      {i < txns.length - 1 && <Divider inset={Spacing.xl + 10} />}
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        />
      )}
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
  backBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterToggleBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterToggleActive: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.full,
  },
  filterBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.base,
    marginTop: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: FontSize.base,
  },
  filtersPanel: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  filterGroup: {
    gap: 4,
  },
  filterChipRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  resetFiltersBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  list: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.xxxl + 60,
    gap: Spacing.base,
  },
  dayGroup: { gap: Spacing.xs },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  dayLabel: { letterSpacing: 0.8 },
  dayCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    overflow: 'hidden',
  },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    minHeight: TouchTarget,
  },
  catDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  txnInfo: { flex: 1, gap: 2 },
  placeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deleteActionBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.xs,
  },
});
