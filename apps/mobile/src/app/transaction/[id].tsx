import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  ChevronLeft,
  Trash2,
  Edit3,
  Image as ImageIcon,
  X,
  Check,
  Camera,
  Maximize2,
} from 'lucide-react-native';

import { Colors, Spacing, Radius, TouchTarget, Fonts, FontSize } from '@/theme';
import { Text, AmountText, Divider, Button, Chip } from '@/components';
import { useFinancerStore } from '@/data/local/store';
import { photoSource } from '@/data/remote/photo-source';
import { useToastStore } from '@/lib/toast-store';
import {
  formatMoney,
  formatDate,
  formatTime,
  rupeesToPaise,
} from '@/lib/format';
import { PAYMENT_MODE_LABELS } from '@/lib/constants';
import { PaymentMode } from '@/engine/types';

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const transactions = useFinancerStore((s) => s.transactions);
  const categories = useFinancerStore((s) => s.categories);
  const updateTransaction = useFinancerStore((s) => s.updateTransaction);
  const deleteTransaction = useFinancerStore((s) => s.deleteTransaction);
  const restoreTransaction = useFinancerStore((s) => s.restoreTransaction);
  const showToast = useToastStore((s) => s.showToast);

  const txn = transactions.find((t) => t.id === id);

  // Edit Mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editAmountStr, setEditAmountStr] = useState(
    txn ? String(txn.amount / 100) : ''
  );
  const [editPlace, setEditPlace] = useState(txn?.place ?? '');
  const [editCategoryId, setEditCategoryId] = useState(txn?.categoryId ?? '');
  const [editPaymentMode, setEditPaymentMode] = useState<PaymentMode>(
    txn?.paymentMode ?? 'upi'
  );
  const [editNote, setEditNote] = useState(txn?.note ?? '');
  const [editDate, setEditDate] = useState(txn?.date ?? '');
  const [editTime, setEditTime] = useState(txn?.time ?? '');
  const [editPhotoUri, setEditPhotoUri] = useState<string | undefined>(
    txn?.billPhotoUri
  );

  // Full-screen image viewer modal
  const [isPhotoViewerOpen, setIsPhotoViewerOpen] = useState(false);

  if (!txn) {
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
          <Text variant="bodySemiBold">Transaction</Text>
          <View style={{ width: TouchTarget }} />
        </View>
        <View style={styles.notFound}>
          <Text variant="body" color={Colors.muted} center>
            Transaction not found.
          </Text>
          <Button
            label="Go back"
            variant="ghost"
            onPress={() => router.back()}
            style={{ marginTop: Spacing.base }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const cat = categories.find((c) => c.id === txn.categoryId);

  // Delete transaction with Undo Toast
  function handleDelete() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const deletedTxn = { ...txn! };
    deleteTransaction(txn!.id);
    router.back();

    showToast({
      message: `Deleted ${deletedTxn.place || 'Expense'} (${formatMoney(deletedTxn.amount)})`,
      actions: [
        {
          label: 'Undo',
          onPress: () => {
            restoreTransaction(deletedTxn);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            showToast({ message: 'Expense restored' });
          },
        },
      ],
    });
  }

  // Save Edits
  function handleSaveEdit() {
    const parsedAmount = rupeesToPaise(Number(editAmountStr) || 0);
    if (parsedAmount <= 0) return;

    updateTransaction(txn!.id, {
      amount: parsedAmount,
      place: editPlace.trim() || 'Expense',
      categoryId: editCategoryId,
      paymentMode: editPaymentMode,
      note: editNote.trim(),
      date: editDate.trim(),
      time: editTime.trim(),
      billPhotoUri: editPhotoUri,
      provenance: txn!.provenance === 'ai_confirmed' ? 'ai_edited' : txn!.provenance,
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsEditing(false);
    showToast({ message: 'Transaction updated' });
  }

  // Pick/replace bill photo
  async function handlePickImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setEditPhotoUri(result.assets[0].uri);
        Haptics.selectionAsync();
      }
    } catch {
      // Ignore
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (isEditing) {
              setIsEditing(false);
            } else {
              router.back();
            }
          }}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={isEditing ? 'Cancel edit' : 'Back'}
        >
          {isEditing ? (
            <X size={20} color={Colors.text2} />
          ) : (
            <ChevronLeft size={22} color={Colors.text} />
          )}
        </Pressable>
        <Text variant="bodySemiBold">
          {isEditing ? 'Edit Expense' : 'Transaction'}
        </Text>
        <Pressable
          onPress={() => {
            if (isEditing) {
              handleSaveEdit();
            } else {
              setIsEditing(true);
            }
            Haptics.selectionAsync();
          }}
          style={styles.actionBtn}
          accessibilityRole="button"
          accessibilityLabel={isEditing ? 'Save changes' : 'Edit transaction'}
          hitSlop={8}
        >
          {isEditing ? (
            <Check size={20} color={Colors.accentLight} />
          ) : (
            <Edit3 size={18} color={Colors.text2} />
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {!isEditing ? (
          // ================= VIEW MODE =================
          <>
            {/* Amount Hero */}
            <View style={styles.amountSection}>
              {cat && (
                <View
                  style={[styles.catBadge, { backgroundColor: cat.color + '22' }]}
                >
                  <View
                    style={[styles.catDot, { backgroundColor: cat.color }]}
                  />
                  <Text variant="label" color={cat.color}>
                    {cat.name}
                  </Text>
                </View>
              )}
              <AmountText
                paise={txn.amount}
                variant="hero"
                color={Colors.expense}
              />
              <Text variant="serifBold" style={styles.placeTitle}>
                {txn.place || 'Expense'}
              </Text>
              <Text variant="caption" color={Colors.muted}>
                {formatDate(txn.date)} · {formatTime(txn.time)} ·{' '}
                {PAYMENT_MODE_LABELS[txn.paymentMode]}
              </Text>
            </View>

            <Divider />

            {/* Field Details */}
            <View style={styles.detailsCard}>
              <View style={styles.detailRow}>
                <Text variant="label" color={Colors.muted}>
                  Place / Merchant
                </Text>
                <Text variant="bodySemiBold">{txn.place || '—'}</Text>
              </View>
              <Divider />
              <View style={styles.detailRow}>
                <Text variant="label" color={Colors.muted}>
                  Category
                </Text>
                <Text variant="bodySemiBold">{cat?.name ?? 'Other'}</Text>
              </View>
              <Divider />
              <View style={styles.detailRow}>
                <Text variant="label" color={Colors.muted}>
                  Payment Mode
                </Text>
                <Text variant="bodySemiBold">
                  {PAYMENT_MODE_LABELS[txn.paymentMode]}
                </Text>
              </View>
              {txn.note ? (
                <>
                  <Divider />
                  <View style={styles.detailRow}>
                    <Text variant="label" color={Colors.muted}>
                      Note
                    </Text>
                    <Text variant="body" style={styles.noteText}>
                      {txn.note}
                    </Text>
                  </View>
                </>
              ) : null}
              <Divider />
              <View style={styles.detailRow}>
                <Text variant="label" color={Colors.muted}>
                  Provenance
                </Text>
                <Text variant="body" color={Colors.text2}>
                  {txn.provenance === 'user'
                    ? 'Manually added by you'
                    : txn.provenance === 'ai_confirmed'
                    ? 'AI suggestion (confirmed)'
                    : 'AI suggestion (edited)'}
                </Text>
              </View>
            </View>

            {/* Bill Photo Section */}
            {txn.billPhotoUri ? (
              <View style={styles.photoCard}>
                <View style={styles.photoHeader}>
                  <View style={styles.photoTitleRow}>
                    <ImageIcon size={16} color={Colors.accentLight} />
                    <Text variant="bodySemiBold">Receipt Photo</Text>
                  </View>
                  <Pressable
                    onPress={() => setIsPhotoViewerOpen(true)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="View full photo"
                  >
                    <Maximize2 size={16} color={Colors.muted} />
                  </Pressable>
                </View>
                <Pressable
                  onPress={() => setIsPhotoViewerOpen(true)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Tap to enlarge receipt photo"
                >
                  <Image
                    source={photoSource(txn.billPhotoUri)}
                    style={styles.photoPreview}
                    resizeMode="cover"
                  />
                </Pressable>
              </View>
            ) : null}

            <Divider />

            {/* Delete Button */}
            <Button
              label="Delete transaction"
              onPress={handleDelete}
              variant="destructive"
              fullWidth
              size="lg"
              icon={<Trash2 size={18} color={Colors.expense} />}
            />
          </>
        ) : (
          // ================= EDIT MODE =================
          <View style={styles.editForm}>
            {/* Amount Input */}
            <View style={styles.editField}>
              <Text variant="label" color={Colors.text2}>
                Amount (₹)
              </Text>
              <TextInput
                style={styles.editInput}
                value={editAmountStr}
                onChangeText={setEditAmountStr}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={Colors.muted}
                accessibilityLabel="Edit amount"
              />
            </View>

            {/* Place Input */}
            <View style={styles.editField}>
              <Text variant="label" color={Colors.text2}>
                Place / Merchant
              </Text>
              <TextInput
                style={styles.editInput}
                value={editPlace}
                onChangeText={setEditPlace}
                placeholder="Merchant name"
                placeholderTextColor={Colors.muted}
                accessibilityLabel="Edit merchant name"
              />
            </View>

            {/* Category Selector */}
            <View style={styles.editField}>
              <Text variant="label" color={Colors.text2}>
                Category
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsScroll}
              >
                {categories.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    selected={editCategoryId === c.id}
                    color={c.color}
                    onPress={() => setEditCategoryId(c.id)}
                  />
                ))}
              </ScrollView>
            </View>

            {/* Payment Mode Selector */}
            <View style={styles.editField}>
              <Text variant="label" color={Colors.text2}>
                Payment Mode
              </Text>
              <View style={styles.paymentModesRow}>
                {(['upi', 'cash', 'card'] as PaymentMode[]).map((m) => (
                  <Pressable
                    key={m}
                    style={[
                      styles.modeChip,
                      editPaymentMode === m && styles.modeChipSelected,
                    ]}
                    onPress={() => setEditPaymentMode(m)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: editPaymentMode === m }}
                  >
                    <Text
                      variant="bodySemiBold"
                      color={editPaymentMode === m ? Colors.text : Colors.text2}
                    >
                      {PAYMENT_MODE_LABELS[m]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Date & Time */}
            <View style={styles.dateTimeRow}>
              <View style={[styles.editField, { flex: 1 }]}>
                <Text variant="caption" color={Colors.muted}>
                  Date (YYYY-MM-DD)
                </Text>
                <TextInput
                  style={styles.editInput}
                  value={editDate}
                  onChangeText={setEditDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.muted}
                  accessibilityLabel="Edit date"
                />
              </View>
              <View style={[styles.editField, { flex: 1 }]}>
                <Text variant="caption" color={Colors.muted}>
                  Time (HH:MM)
                </Text>
                <TextInput
                  style={styles.editInput}
                  value={editTime}
                  onChangeText={setEditTime}
                  placeholder="HH:MM"
                  placeholderTextColor={Colors.muted}
                  accessibilityLabel="Edit time"
                />
              </View>
            </View>

            {/* Note */}
            <View style={styles.editField}>
              <Text variant="label" color={Colors.text2}>
                Note
              </Text>
              <TextInput
                style={[styles.editInput, styles.noteInput]}
                value={editNote}
                onChangeText={setEditNote}
                placeholder="Optional note"
                placeholderTextColor={Colors.muted}
                multiline
                numberOfLines={2}
                accessibilityLabel="Edit note"
              />
            </View>

            {/* Receipt Photo in Edit Mode */}
            <View style={styles.editField}>
              <Text variant="label" color={Colors.text2}>
                Receipt Photo
              </Text>
              {editPhotoUri ? (
                <View style={styles.editPhotoPreviewRow}>
                  <Image
                    source={photoSource(editPhotoUri)}
                    style={styles.photoThumbnail}
                  />
                  <View style={{ gap: Spacing.xs }}>
                    <Button
                      label="Change photo"
                      variant="ghost"
                      size="sm"
                      onPress={handlePickImage}
                    />
                    <Button
                      label="Remove photo"
                      variant="destructive"
                      size="sm"
                      onPress={() => setEditPhotoUri(undefined)}
                    />
                  </View>
                </View>
              ) : (
                <Button
                  label="Attach receipt photo"
                  variant="ghost"
                  icon={<Camera size={16} color={Colors.text} />}
                  onPress={handlePickImage}
                />
              )}
            </View>

            {/* Save Button */}
            <View style={{ gap: Spacing.sm, marginTop: Spacing.base }}>
              <Button
                label="Save changes"
                variant="primary"
                fullWidth
                size="lg"
                onPress={handleSaveEdit}
              />
              <Button
                label="Cancel"
                variant="ghost"
                fullWidth
                onPress={() => setIsEditing(false)}
              />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Full-Screen Bill Photo Viewer Modal */}
      {txn.billPhotoUri && (
        <Modal
          visible={isPhotoViewerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsPhotoViewerOpen(false)}
        >
          <View style={styles.photoModalBackdrop}>
            <SafeAreaView style={styles.photoModalHeader}>
              <Pressable
                onPress={() => setIsPhotoViewerOpen(false)}
                style={styles.modalCloseBtn}
                accessibilityRole="button"
                accessibilityLabel="Close photo viewer"
                hitSlop={8}
              >
                <X size={24} color={Colors.text} />
              </Pressable>
              <Text variant="bodySemiBold">Receipt Photo</Text>
              <View style={{ width: TouchTarget }} />
            </SafeAreaView>

            <View style={styles.photoModalContent}>
              <Image
                source={photoSource(txn.billPhotoUri)}
                style={styles.photoFull}
                resizeMode="contain"
              />
            </View>
          </View>
        </Modal>
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
  actionBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  scroll: {
    padding: Spacing.base,
    gap: Spacing.base,
    paddingBottom: 60,
  },
  amountSection: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  placeTitle: {
    fontSize: FontSize.lg,
    color: Colors.text,
  },
  detailsCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  noteText: {
    flex: 1,
    textAlign: 'right',
    color: Colors.text2,
  },
  photoCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: Spacing.sm,
  },
  photoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  photoTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  photoPreview: {
    width: '100%',
    height: 180,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
  },
  photoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,10,13,0.95)',
  },
  photoModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  modalCloseBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoModalContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.base,
  },
  photoFull: {
    width: '100%',
    height: '100%',
  },
  // Edit Form Styles
  editForm: {
    gap: Spacing.base,
  },
  editField: {
    gap: Spacing.xs,
  },
  editInput: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.hairline,
    height: 48,
    paddingHorizontal: Spacing.base,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: FontSize.base,
  },
  noteInput: {
    height: 64,
    paddingVertical: Spacing.sm,
    textAlignVertical: 'top',
  },
  chipsScroll: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingVertical: 2,
  },
  paymentModesRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  modeChip: {
    flex: 1,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeChipSelected: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accentLight,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  editPhotoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  photoThumbnail: {
    width: 60,
    height: 60,
    borderRadius: Radius.sm,
  },
});
