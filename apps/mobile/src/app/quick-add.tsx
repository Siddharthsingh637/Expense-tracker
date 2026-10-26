import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  X,
  Camera,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Clock,
  Calendar,
  FileText,
  Users,
  Check,
} from 'lucide-react-native';

import { Colors, Spacing, Radius, TouchTarget, Fonts, FontSize } from '@/theme';
import {
  Text,
  AmountText,
  Button,
  Chip,
  Keypad,
  Divider,
  DraftCard,
} from '@/components';
import { usePaisaStore } from '@/data/local/store';
import { photoSource } from '@/data/remote/photo-source';
import { aiService } from '@/ai';
import { useToastStore } from '@/lib/toast-store';
import {
  formatMoney,
  formatDateTime,
  toISODate,
  toHHMM,
  rupeesToPaise,
} from '@/lib/format';
import { PaymentMode, TransactionProvenance } from '@/engine/types';
import { PAYMENT_MODE_LABELS } from '@/lib/constants';

export default function QuickAddScreen() {
  const categories = usePaisaStore((s) => s.categories);
  const transactions = usePaisaStore((s) => s.transactions);
  const lastUsedPaymentMode = usePaisaStore((s) => s.lastUsedPaymentMode);
  const aiEnabled = usePaisaStore((s) => s.aiEnabled);
  const addTransaction = usePaisaStore((s) => s.addTransaction);
  const deleteTransaction = usePaisaStore((s) => s.deleteTransaction);
  const showToast = useToastStore((s) => s.showToast);

  // Form State
  const [amountStr, setAmountStr] = useState('');
  const [place, setPlace] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(() => {
    return categories[0]?.id ?? 'cat-0';
  });
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(lastUsedPaymentMode);
  const [billPhotoUri, setBillPhotoUri] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [time, setTime] = useState(() => toHHMM(new Date()));

  // Modes & UI toggles
  const [showKeypad, setShowKeypad] = useState(true);
  const [isManualExpanded, setIsManualExpanded] = useState(false);
  const [provenance, setProvenance] = useState<TransactionProvenance>('user');

  // AI Natural Language input
  const [nlInput, setNlInput] = useState('');
  const [aiDraft, setAiDraft] = useState<{
    amount?: number;
    place?: string;
    categoryId?: string;
    paymentMode?: PaymentMode;
    confidence: number;
    reason: string;
  } | null>(null);
  const [isParsingAI, setIsParsingAI] = useState(false);

  // Recent merchants derived from transaction history for autocomplete
  const recentPlaces = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.place && t.place.trim().length > 0) {
        set.add(t.place.trim());
      }
    }
    return Array.from(set).slice(0, 10);
  }, [transactions]);

  // Amount in paise
  const amountPaise = amountStr ? rupeesToPaise(Number(amountStr)) : 0;
  const canSave = amountPaise > 0;

  // Auto-suggest category when place changes
  useEffect(() => {
    if (!place.trim()) return;

    let isCurrent = true;
    aiService.suggestCategory(place, amountPaise).then((draft) => {
      if (!isCurrent) return;
      const matched = categories.find(
        (c) => c.name.toLowerCase() === draft.data.toLowerCase()
      );
      if (matched) {
        setSelectedCategoryId(matched.id);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [place, categories, amountPaise]);

  // Handle Natural Language Parse
  async function handleParseNaturalLanguage() {
    if (!nlInput.trim()) return;
    setIsParsingAI(true);
    try {
      const draft = await aiService.parseEntry(nlInput);
      const parsedAmount = draft.data.amount ?? 0;
      const parsedPlace = draft.data.place ?? '';
      const parsedMode = draft.data.paymentMode ?? 'upi';

      let matchedCatId = selectedCategoryId;
      if (parsedPlace) {
        const catDraft = await aiService.suggestCategory(parsedPlace, parsedAmount);
        const matched = categories.find(
          (c) => c.name.toLowerCase() === catDraft.data.toLowerCase()
        );
        if (matched) matchedCatId = matched.id;
      }

      setAiDraft({
        amount: parsedAmount,
        place: parsedPlace,
        categoryId: matchedCatId,
        paymentMode: parsedMode,
        confidence: draft.confidence,
        reason: draft.reason,
      });
    } catch {
      // Graceful fallback
    } finally {
      setIsParsingAI(false);
    }
  }

  function handleConfirmAiDraft() {
    if (!aiDraft) return;
    if (aiDraft.amount && aiDraft.amount > 0) {
      setAmountStr(String(aiDraft.amount / 100));
    }
    if (aiDraft.place) setPlace(aiDraft.place);
    if (aiDraft.categoryId) setSelectedCategoryId(aiDraft.categoryId);
    if (aiDraft.paymentMode) setPaymentMode(aiDraft.paymentMode);
    setProvenance('ai_confirmed');
    setAiDraft(null);
    setNlInput('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleEditAiDraft() {
    if (!aiDraft) return;
    if (aiDraft.amount && aiDraft.amount > 0) {
      setAmountStr(String(aiDraft.amount / 100));
    }
    if (aiDraft.place) setPlace(aiDraft.place);
    if (aiDraft.categoryId) setSelectedCategoryId(aiDraft.categoryId);
    if (aiDraft.paymentMode) setPaymentMode(aiDraft.paymentMode);
    setProvenance('ai_edited');
    setAiDraft(null);
  }

  function handleDiscardAiDraft() {
    setAiDraft(null);
  }

  // Camera / Photo Picker
  async function handlePickImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setBillPhotoUri(result.assets[0].uri);
        Haptics.selectionAsync();
      }
    } catch {
      // Ignore canceled or unavailable
    }
  }

  // Save Transaction
  function handleSave() {
    if (!canSave) return;

    const selectedCat = categories.find((c) => c.id === selectedCategoryId);
    const finalPlace = place.trim() || selectedCat?.name || 'Expense';

    const newTxn = addTransaction({
      amount: amountPaise,
      categoryId: selectedCategoryId,
      place: finalPlace,
      note: note.trim(),
      paymentMode,
      billPhotoUri,
      date,
      time,
      provenance,
    });

    // Haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Close sheet
    router.back();

    // Trigger Toast with Undo and Edit
    const message = `${formatMoney(amountPaise)} · ${finalPlace} · ${selectedCat?.name ?? 'Expense'}`;

    showToast({
      message,
      actions: [
        {
          label: 'Undo',
          onPress: () => {
            deleteTransaction(newTxn.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            showToast({ message: 'Expense undone' });
          },
        },
        {
          label: 'Edit',
          onPress: () => {
            router.push(`/transaction/${newTxn.id}`);
          },
        },
      ],
    });
  }

  // Split this bill action
  function handleSplitThisBill() {
    router.back();
    router.push({
      pathname: '/splits/new',
      params: {
        prefillAmount: amountPaise,
        prefillTitle: place.trim() || 'Shared Bill',
        prefillCategory: selectedCategoryId,
      },
    });
  }

  const selectedCat = categories.find((c) => c.id === selectedCategoryId);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Drag Handle */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text variant="bodySemiBold">Add Expense</Text>
            <View style={styles.timeBadge}>
              <Clock size={12} color={Colors.muted} />
              <Text variant="caption" color={Colors.muted}>
                {formatDateTime(date, time)}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => router.back()}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close quick add"
            hitSlop={8}
          >
            <X size={20} color={Colors.text2} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Optional Natural Language Input (AI) */}
          {aiEnabled && (
            <View style={styles.nlContainer}>
              <View style={styles.nlInputRow}>
                <Sparkles size={16} color={Colors.accentLight} />
                <TextInput
                  style={styles.nlInput}
                  value={nlInput}
                  onChangeText={setNlInput}
                  placeholder='e.g. "50 chai stall upi" or "250 pizza"'
                  placeholderTextColor={Colors.muted}
                  returnKeyType="done"
                  onSubmitEditing={handleParseNaturalLanguage}
                  accessibilityLabel="Natural language entry input"
                />
                {nlInput.trim().length > 0 && (
                  <Button
                    label={isParsingAI ? '...' : 'Parse'}
                    variant="ghost"
                    size="sm"
                    onPress={handleParseNaturalLanguage}
                    loading={isParsingAI}
                  />
                )}
              </View>

              {/* AI Draft Card Preview */}
              {aiDraft && (
                <DraftCard
                  confidence={aiDraft.confidence}
                  reason={aiDraft.reason}
                  onConfirm={handleConfirmAiDraft}
                  onEdit={handleEditAiDraft}
                  onDiscard={handleDiscardAiDraft}
                  style={styles.draftCard}
                >
                  <View style={styles.draftContent}>
                    <Text variant="bodyBold" color={Colors.text}>
                      {aiDraft.amount ? formatMoney(aiDraft.amount) : '₹0'}
                      {aiDraft.place ? ` · ${aiDraft.place}` : ''}
                    </Text>
                    <Text variant="caption" color={Colors.text2}>
                      Mode: {PAYMENT_MODE_LABELS[aiDraft.paymentMode ?? 'upi']}
                    </Text>
                  </View>
                </DraftCard>
              )}
            </View>
          )}

          {/* Amount Display & Keypad Switcher */}
          <Pressable
            style={styles.amountBox}
            onPress={() => setShowKeypad(!showKeypad)}
            accessibilityRole="button"
            accessibilityLabel={`Amount ${formatMoney(amountPaise)}. Tap to toggle keypad`}
          >
            {amountPaise > 0 ? (
              <AmountText paise={amountPaise} variant="hero" color={Colors.text} />
            ) : (
              <Text variant="serifBold" style={styles.amountPlaceholder}>
                ₹0
              </Text>
            )}
            <Text variant="caption" color={Colors.muted}>
              {showKeypad ? 'Tap amount to hide keypad' : 'Tap amount to open keypad'}
            </Text>
          </Pressable>

          {/* Place Input with Autocomplete Chips */}
          <View style={styles.fieldSection}>
            <Text variant="label" color={Colors.text2}>
              Where?
            </Text>
            <View style={styles.placeRow}>
              <TextInput
                style={styles.placeInput}
                value={place}
                onChangeText={setPlace}
                placeholder="Place / Merchant (e.g. Chai stall)"
                placeholderTextColor={Colors.muted}
                accessibilityLabel="Place or merchant name"
              />
              {/* Camera icon for receipt photo */}
              <Pressable
                style={[
                  styles.cameraBtn,
                  billPhotoUri ? styles.cameraBtnActive : null,
                ]}
                onPress={handlePickImage}
                accessibilityRole="button"
                accessibilityLabel="Attach bill photo"
              >
                <Camera
                  size={18}
                  color={billPhotoUri ? Colors.accentLight : Colors.text2}
                />
              </Pressable>
            </View>

            {/* Bill photo thumbnail with remove */}
            {billPhotoUri && (
              <View style={styles.photoThumbnailContainer}>
                <Image source={photoSource(billPhotoUri)} style={styles.photoThumbnail} />
                <View style={styles.photoInfo}>
                  <Text variant="caption" color={Colors.text2}>
                    Bill receipt attached
                  </Text>
                  <Pressable
                    onPress={() => setBillPhotoUri(undefined)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                  >
                    <Text variant="captionBold" color={Colors.expense}>
                      Remove
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Recents chips */}
            {recentPlaces.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recentsScroll}
              >
                {recentPlaces.map((recent) => (
                  <Chip
                    key={recent}
                    label={recent}
                    selected={place.toLowerCase() === recent.toLowerCase()}
                    onPress={() => {
                      setPlace(recent);
                      Haptics.selectionAsync();
                    }}
                  />
                ))}
              </ScrollView>
            )}
          </View>

          {/* Category Suggestion & Selection Chips */}
          <View style={styles.fieldSection}>
            <View style={styles.sectionHeaderRow}>
              <Text variant="label" color={Colors.text2}>
                Category
              </Text>
              {selectedCat && (
                <Text variant="caption" color={selectedCat.color}>
                  Auto-selected: {selectedCat.name}
                </Text>
              )}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsScroll}
            >
              {categories
                .filter((c) => !c.isArchived)
                .map((cat) => {
                  const isSelected = cat.id === selectedCategoryId;
                  return (
                    <Chip
                      key={cat.id}
                      label={cat.name}
                      selected={isSelected}
                      color={cat.color}
                      onPress={() => {
                        setSelectedCategoryId(cat.id);
                        Haptics.selectionAsync();
                      }}
                    />
                  );
                })}
            </ScrollView>
          </View>

          {/* Payment Mode Chips */}
          <View style={styles.fieldSection}>
            <Text variant="label" color={Colors.text2}>
              Payment Mode
            </Text>
            <View style={styles.paymentModesRow}>
              {(['upi', 'cash', 'card'] as PaymentMode[]).map((mode) => (
                <Pressable
                  key={mode}
                  style={[
                    styles.modeChip,
                    paymentMode === mode && styles.modeChipSelected,
                  ]}
                  onPress={() => {
                    setPaymentMode(mode);
                    Haptics.selectionAsync();
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={PAYMENT_MODE_LABELS[mode]}
                  accessibilityState={{ selected: paymentMode === mode }}
                >
                  <Text
                    variant="bodySemiBold"
                    color={paymentMode === mode ? Colors.text : Colors.text2}
                  >
                    {PAYMENT_MODE_LABELS[mode]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* "Manual Entry" Expandable Toggle */}
          <Pressable
            style={styles.manualToggle}
            onPress={() => {
              setIsManualExpanded(!isManualExpanded);
              Haptics.selectionAsync();
            }}
            accessibilityRole="button"
            accessibilityLabel="Toggle manual entry options"
          >
            <Text variant="label" color={Colors.accentLight}>
              {isManualExpanded ? 'Less options' : 'Manual entry & Split options'}
            </Text>
            {isManualExpanded ? (
              <ChevronUp size={16} color={Colors.accentLight} />
            ) : (
              <ChevronDown size={16} color={Colors.accentLight} />
            )}
          </Pressable>

          {/* Expanded Manual Fields */}
          {isManualExpanded && (
            <View style={styles.manualForm}>
              <Divider />

              {/* Date & Time */}
              <View style={styles.manualRow}>
                <View style={styles.manualField}>
                  <Text variant="caption" color={Colors.muted}>
                    Date (YYYY-MM-DD)
                  </Text>
                  <TextInput
                    style={styles.manualInput}
                    value={date}
                    onChangeText={setDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.muted}
                    accessibilityLabel="Expense date"
                  />
                </View>
                <View style={styles.manualField}>
                  <Text variant="caption" color={Colors.muted}>
                    Time (HH:MM)
                  </Text>
                  <TextInput
                    style={styles.manualInput}
                    value={time}
                    onChangeText={setTime}
                    placeholder="HH:MM"
                    placeholderTextColor={Colors.muted}
                    accessibilityLabel="Expense time"
                  />
                </View>
              </View>

              {/* Note */}
              <View style={styles.fieldSection}>
                <Text variant="caption" color={Colors.muted}>
                  Optional Note
                </Text>
                <TextInput
                  style={[styles.manualInput, styles.noteInput]}
                  value={note}
                  onChangeText={setNote}
                  placeholder="e.g. Lunch with team or refund"
                  placeholderTextColor={Colors.muted}
                  multiline
                  numberOfLines={2}
                  accessibilityLabel="Expense note"
                />
              </View>

              {/* "Split this bill" bridge */}
              <Pressable
                style={styles.splitBillBtn}
                onPress={handleSplitThisBill}
                accessibilityRole="button"
                accessibilityLabel="Split this bill with friends"
              >
                <Users size={18} color={Colors.accentLight} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodySemiBold" color={Colors.text}>
                    Split this bill with friends
                  </Text>
                  <Text variant="caption" color={Colors.muted}>
                    Prefill this amount in a new group bill
                  </Text>
                </View>
              </Pressable>
            </View>
          )}

          {/* Custom Numeric Keypad */}
          {showKeypad && (
            <View style={styles.keypadWrapper}>
              <Keypad
                value={amountStr}
                onChange={setAmountStr}
                style={styles.keypad}
              />
            </View>
          )}

          {/* Save Button */}
          <View style={styles.footer}>
            <Button
              label={amountPaise > 0 ? `Save ${formatMoney(amountPaise)}` : 'Enter amount'}
              onPress={handleSave}
              variant="primary"
              fullWidth
              size="lg"
              disabled={!canSave}
              icon={<Check size={20} color={Colors.text} />}
              iconPosition="right"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  flex: { flex: 1 },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.hairline,
    borderRadius: Radius.full,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  closeBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    padding: Spacing.base,
    gap: Spacing.base,
    paddingBottom: Spacing.xxxl,
  },
  nlContainer: {
    gap: Spacing.xs,
  },
  nlInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.hairline,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  nlInput: {
    flex: 1,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: FontSize.sm,
  },
  draftCard: {
    marginTop: Spacing.xs,
  },
  draftContent: {
    gap: 2,
    paddingVertical: Spacing.xs,
  },
  amountBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    gap: 4,
  },
  amountPlaceholder: {
    fontSize: FontSize.hero,
    color: Colors.muted,
  },
  fieldSection: {
    gap: Spacing.xs,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  placeInput: {
    flex: 1,
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
  cameraBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBtnActive: {
    borderColor: Colors.accentLight,
  },
  photoThumbnailContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface2,
    padding: Spacing.sm,
    borderRadius: Radius.md,
  },
  photoThumbnail: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
  },
  photoInfo: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recentsScroll: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingVertical: 2,
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
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeChipSelected: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accentLight,
  },
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    minHeight: TouchTarget,
  },
  manualForm: {
    gap: Spacing.base,
  },
  manualRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  manualField: {
    flex: 1,
    gap: 4,
  },
  manualInput: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.hairline,
    height: 44,
    paddingHorizontal: Spacing.base,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: FontSize.sm,
  },
  noteInput: {
    height: 64,
    paddingVertical: Spacing.sm,
    textAlignVertical: 'top',
  },
  splitBillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.hairline,
    minHeight: TouchTarget,
  },
  keypadWrapper: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  keypad: {},
  footer: {
    paddingTop: Spacing.sm,
  },
});
