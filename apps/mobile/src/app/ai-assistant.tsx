/**
 * AI Assistant — Full-screen modal chat with Draft Cards,
 * local query engine, suggested prompts, and undoable actions.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  X,
  Bot,
  Send,
  Sparkles,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Tag,
  CreditCard,
  Users,
  Check,
} from 'lucide-react-native';

import { Colors, Spacing, Radius, TouchTarget } from '@/theme';
import { Text, DraftCard, Chip, Avatar, AmountText } from '@/components';
import { usePaisaStore } from '@/data/local/store';
import { aiService } from '@/ai';
import { AIProcessedMessage } from '@/ai/types';
import { formatMoney, toISODate } from '@/lib/format';
import { useToastStore } from '@/lib/toast-store';
import { myShare } from '@/engine/splits';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  timestamp: string;
  text?: string;
  processed?: AIProcessedMessage;
  status?: 'active' | 'confirmed' | 'discarded';
  savedId?: string;
  retryQuery?: string;
}

const SUGGESTED_PROMPTS = [
  'Paid ₹250 at Dominos with Riya, split equally',
  'How much did I spend on food this week?',
  'How much left in budget?',
  'Propose a budget for next month',
  '₹50 chai stall cash',
];

export default function AIAssistantScreen() {
  const aiEnabled = usePaisaStore((s) => s.aiEnabled);
  const transactions = usePaisaStore((s) => s.transactions);
  const allocations = usePaisaStore((s) => s.budgetAllocations);
  const currentMonth = usePaisaStore((s) => s.currentMonth);
  const categories = usePaisaStore((s) => s.categories);
  const people = usePaisaStore((s) => s.people);

  // Actions
  const addTransaction = usePaisaStore((s) => s.addTransaction);
  const deleteTransaction = usePaisaStore((s) => s.deleteTransaction);
  const addGroupBill = usePaisaStore((s) => s.addGroupBill);
  const addPerson = usePaisaStore((s) => s.addPerson);
  const setBudgetAllocation = usePaisaStore((s) => s.setBudgetAllocation);
  const showToast = useToastStore((s) => s.showToast);

  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      timestamp: 'Just now',
      text: "Hi, I’m Paisa AI. I can help with money questions, your recorded spending, budgets, and bill splits. I’ll only use your expense data when it helps answer what you asked.",
    },
  ]);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 150);
  }, [messages, isProcessing]);

  async function handleSend(textToSend?: string) {
    const query = (textToSend ?? input).trim();
    if (!query || isProcessing) return;

    setInput('');
    const userMsgId = `user-${Date.now()}`;
    const newMessages: ChatMessage[] = [
      ...messages,
      {
        id: userMsgId,
        sender: 'user',
        timestamp: 'Just now',
        text: query,
      },
    ];
    setMessages(newMessages);
    setIsProcessing(true);

    try {
      const processed = await aiService.processMessage(query, {
        transactions,
        allocations,
        currentMonth,
        conversationHistory: newMessages.slice(-8).map((message) => ({
          role: message.sender,
          text: message.text ?? '',
        })),
      });

      const assistantMsgId = `assistant-${Date.now()}`;
      setMessages([
        ...newMessages,
        {
          id: assistantMsgId,
          sender: 'assistant',
          timestamp: 'Just now',
          processed,
          status: 'active',
        },
      ]);
    } catch {
      setMessages([
        ...newMessages,
        {
          id: `assistant-err-${Date.now()}`,
          sender: 'assistant',
          timestamp: 'Just now',
          text: "I couldn't process that right now. Please try again.",
          retryQuery: query,
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  }

  // Confirm Expense Draft
  function handleConfirmExpense(msgId: string, processed: AIProcessedMessage) {
    if (processed.intent !== 'expense') return;
    const { data } = processed.draft;

    const amount = data.amount ?? 0;
    const place = data.place || 'Unknown Merchant';
    const categoryId = data.categoryId || 'cat-0';
    const paymentMode = data.paymentMode || 'upi';
    const date = data.date || toISODate(new Date());
    const time =
      data.time ||
      new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

    const newTxn = addTransaction({
      amount,
      place,
      categoryId,
      paymentMode,
      date,
      time,
      note: data.note || '',
      provenance: 'ai_confirmed',
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, status: 'confirmed', savedId: newTxn.id } : m
      )
    );

    const catObj = categories.find((c) => c.id === categoryId);
    showToast({
      message: `${formatMoney(amount)} · ${place} · ${catObj?.name ?? 'Expense'}`,
      actions: [
        {
          label: 'Undo',
          onPress: () => {
            deleteTransaction(newTxn.id);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId ? { ...m, status: 'active', savedId: undefined } : m
              )
            );
            showToast({ message: 'Transaction undone' });
          },
        },
      ],
    });
  }

  // Confirm Split Draft
  function handleConfirmSplit(msgId: string, processed: AIProcessedMessage) {
    if (processed.intent !== 'split') return;
    const { data } = processed.draft;

    const rawNames = data.personNames ?? [];
    const createdPersonIds: string[] = ['me'];

    // Ensure people exist
    for (const name of rawNames) {
      const existing = people.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      if (existing) {
        createdPersonIds.push(existing.id);
      } else {
        const newPersonId = `person-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        addPerson({
          name,
          isMe: false,
          isArchived: false,
        });
        createdPersonIds.push(newPersonId);
      }
    }

    const totalPaise =
      data.payments && data.payments.me ? data.payments.me : 0;
    const title = data.title || 'Group Expense';
    const date = data.date || toISODate(new Date());

    const bill = addGroupBill({
      title,
      date,
      personIds: createdPersonIds,
      payments: { me: totalPaise },
      method: data.method || 'equal',
      isSettled: false,
      categoryId: data.categoryId || 'cat-0',
    });

    // Accounting rule: only my share counts as an expense in budget
    const shareAmount = myShare(bill, 'me');
    const myShareTxn = addTransaction({
      amount: shareAmount,
      place: title,
      categoryId: data.categoryId || 'cat-0',
      note: `My share of ${title}`,
      paymentMode: 'upi',
      date,
      time: '12:00',
      provenance: 'ai_confirmed',
      splitId: bill.id,
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, status: 'confirmed', savedId: bill.id } : m
      )
    );

    showToast({
      message: `Group bill '${title}' created · Your share: ${formatMoney(shareAmount)}`,
      actions: [
        {
          label: 'Undo',
          onPress: () => {
            deleteTransaction(myShareTxn.id);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId ? { ...m, status: 'active', savedId: undefined } : m
              )
            );
            showToast({ message: 'Bill split undone' });
          },
        },
      ],
    });
  }

  // Confirm Budget Proposal
  function handleConfirmBudget(msgId: string, processed: AIProcessedMessage) {
    if (processed.intent !== 'budget_proposal') return;
    const { data: proposedAllocations } = processed.draft;

    for (const alloc of proposedAllocations) {
      setBudgetAllocation({
        month: alloc.month,
        categoryId: alloc.categoryId,
        allocatedPaise: alloc.allocatedPaise,
      });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: 'confirmed' } : m))
    );

    const totalAllocated = proposedAllocations.reduce(
      (sum, a) => sum + a.allocatedPaise,
      0
    );
    showToast({
      message: `Budget updated: ${formatMoney(totalAllocated)} distributed across ${proposedAllocations.length} categories`,
    });
  }

  function handleDiscard(msgId: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: 'discarded' } : m))
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.botIconBadge}>
            <Bot size={20} color={Colors.accentLight} />
          </View>
          <View>
            <Text variant="bodySemiBold">AI Assistant</Text>
            <View style={styles.statusRow}>
              <View style={styles.onlineDot} />
              <Text variant="caption" color={Colors.muted}>
                Local engine · Draft mode
              </Text>
            </View>
          </View>
        </View>

        <Pressable
          onPress={() => router.back()}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close AI assistant"
          hitSlop={8}
        >
          <X size={20} color={Colors.text2} />
        </Pressable>
      </View>

      {/* Disabled Banner if AI is turned off */}
      {!aiEnabled && (
        <View style={styles.disabledBanner}>
          <AlertCircle size={20} color={Colors.overBudget} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyMedium" color={Colors.text}>
              AI features are disabled
            </Text>
            <Text variant="caption" color={Colors.text2}>
              Turn on AI features in Settings to use smart drafts and question answering.
            </Text>
          </View>
          <Pressable
            style={styles.settingsLink}
            onPress={() => router.push('/settings')}
          >
            <Text variant="captionBold" color={Colors.accentLight}>
              Settings
            </Text>
            <ArrowRight size={14} color={Colors.accentLight} />
          </Pressable>
        </View>
      )}

      {/* Chat Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.chatScroll}
        contentContainerStyle={styles.chatContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {messages.map((msg) => {
          if (msg.sender === 'user') {
            return (
              <View key={msg.id} style={styles.userBubbleContainer}>
                <View style={styles.userBubble}>
                  <Text variant="body" color={Colors.text}>
                    {msg.text}
                  </Text>
                </View>
              </View>
            );
          }

          // Assistant text message
          if (msg.text) {
            return (
              <View key={msg.id} style={styles.assistantBubbleContainer}>
                <View style={styles.botAvatarMini}>
                  <Sparkles size={14} color={Colors.accentLight} />
                </View>
                <View style={styles.assistantBubble}>
                  <Text variant="body" color={Colors.text}>
                    {msg.text}
                  </Text>
                  {msg.retryQuery ? (
                    <Pressable onPress={() => handleSend(msg.retryQuery)} accessibilityRole="button" accessibilityLabel="Retry message">
                      <Text variant="label" color={Colors.accentLight} style={{ marginTop: Spacing.sm }}>Try again</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          }

          // Assistant processed intent output
          if (msg.processed) {
            const { intent, draft } = msg.processed;
            const isConfirmed = msg.status === 'confirmed';
            const isDiscarded = msg.status === 'discarded';

            if (intent === 'conversation') {
              return (
                <View key={msg.id} style={styles.assistantBubbleContainer}>
                  <View style={styles.botAvatarMini}>
                    <Sparkles size={14} color={Colors.accentLight} />
                  </View>
                  <View style={styles.assistantBubble}>
                    <Text variant="body" color={Colors.text}>{draft.data}</Text>
                  </View>
                </View>
              );
            }

            return (
              <View key={msg.id} style={styles.assistantDraftContainer}>
                <View style={styles.botAvatarMini}>
                  <Sparkles size={14} color={Colors.accentLight} />
                </View>

                <View style={{ flex: 1 }}>
                  {isConfirmed ? (
                    <View style={styles.resolvedCard}>
                      <CheckCircle2 size={18} color={Colors.income} />
                      <Text variant="label" color={Colors.income}>
                        {intent === 'expense'
                          ? 'Expense added to your ledger'
                          : intent === 'split'
                          ? 'Group bill & share confirmed'
                          : 'Budget proposal applied'}
                      </Text>
                    </View>
                  ) : isDiscarded ? (
                    <View style={styles.resolvedCard}>
                      <Text variant="caption" color={Colors.muted}>
                        Draft discarded · No changes made to your data
                      </Text>
                    </View>
                  ) : intent === 'question' ? (
                    // Question Answer Card
                    <View style={styles.questionCard}>
                      <View style={styles.questionHeader}>
                        <Text variant="caption" color={Colors.muted} style={styles.capsLabel}>
                          FROM YOUR RECORDED DATA
                        </Text>
                        <Text variant="caption" color={Colors.text2}>
                          May exclude unsynced or unrecorded spending
                        </Text>
                      </View>
                      <Text variant="body" style={styles.questionAnswerText}>
                        {draft.data.answer}
                      </Text>

                      {draft.data.breakdown && draft.data.breakdown.length > 0 && (
                        <View style={styles.breakdownTable}>
                          {draft.data.breakdown.map((row, idx) => (
                            <View key={idx} style={styles.breakdownRow}>
                              <Text variant="caption" color={Colors.text2} style={{ flex: 1 }}>
                                {row.label}
                              </Text>
                              <Text variant="label" color={Colors.text}>
                                {row.value}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : intent === 'expense' ? (
                    // Expense Draft Card
                    <DraftCard
                      label="AI EXPENSE DRAFT"
                      confidence={draft.confidence}
                      reason={draft.reason}
                      onConfirm={() => handleConfirmExpense(msg.id, msg.processed!)}
                      onEdit={() => {
                        router.push('/quick-add');
                      }}
                      onDiscard={() => handleDiscard(msg.id)}
                    >
                      <View style={styles.draftContent}>
                        <View style={styles.expenseHero}>
                          <AmountText
                            paise={draft.data.amount ?? 0}
                            variant="large"
                            color={Colors.expense}
                          />
                          <Text variant="bodyBold" style={{ marginTop: Spacing.xs }}>
                            {draft.data.place || 'Unknown Merchant'}
                          </Text>
                        </View>

                        <View style={styles.draftChipsRow}>
                          {(() => {
                            const cat = categories.find((c) => c.id === draft.data.categoryId);
                            return (
                              <View style={styles.metaChip}>
                                <Tag size={12} color={cat?.color ?? Colors.muted} />
                                <Text variant="caption" color={Colors.text}>
                                  {cat?.name ?? 'Other'}
                                </Text>
                              </View>
                            );
                          })()}

                          <View style={styles.metaChip}>
                            <CreditCard size={12} color={Colors.muted} />
                            <Text variant="caption" color={Colors.text}>
                              {(draft.data.paymentMode ?? 'UPI').toUpperCase()}
                            </Text>
                          </View>

                          <View style={styles.metaChip}>
                            <Calendar size={12} color={Colors.muted} />
                            <Text variant="caption" color={Colors.text2}>
                              {draft.data.date ?? 'Today'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </DraftCard>
                  ) : intent === 'split' ? (
                    // Split Draft Card
                    <DraftCard
                      label="AI SPLIT DRAFT"
                      confidence={draft.confidence}
                      reason={draft.reason}
                      onConfirm={() => handleConfirmSplit(msg.id, msg.processed!)}
                      onEdit={() => {
                        router.push('/splits/new');
                      }}
                      onDiscard={() => handleDiscard(msg.id)}
                    >
                      <View style={styles.draftContent}>
                        <View style={styles.splitHeaderRow}>
                          <View>
                            <Text variant="bodyBold">{draft.data.title || 'Group Bill'}</Text>
                            <Text variant="caption" color={Colors.text2}>
                              Split equally among {((draft.data.personNames?.length ?? 0) + 1)} people
                            </Text>
                          </View>
                          <AmountText
                            paise={draft.data.payments?.me ?? 0}
                            variant="medium"
                            color={Colors.text}
                          />
                        </View>

                        <View style={styles.splitPeopleRow}>
                          <Users size={14} color={Colors.muted} />
                          <Text variant="caption" color={Colors.text2}>
                            Me, {(draft.data.personNames ?? []).join(', ')}
                          </Text>
                        </View>

                        <View style={styles.myShareHighlight}>
                          <Text variant="caption" color={Colors.muted}>
                            Your actual budget expense:
                          </Text>
                          <Text variant="bodyBold" color={Colors.income}>
                            {formatMoney(
                              Math.round(
                                (draft.data.payments?.me ?? 0) /
                                  ((draft.data.personNames?.length ?? 0) + 1)
                              )
                            )}
                          </Text>
                        </View>
                      </View>
                    </DraftCard>
                  ) : (
                    // Budget Proposal Draft Card
                    <DraftCard
                      label="AI BUDGET PROPOSAL"
                      confidence={draft.confidence}
                      reason={draft.reason}
                      onConfirm={() => handleConfirmBudget(msg.id, msg.processed!)}
                      onEdit={() => {
                        router.push('/budget');
                      }}
                      onDiscard={() => handleDiscard(msg.id)}
                    >
                      <View style={styles.draftContent}>
                        <Text variant="caption" color={Colors.text2}>
                          Proposed category distribution for {currentMonth}:
                        </Text>
                        <View style={styles.budgetProposalsList}>
                          {draft.data.slice(0, 5).map((alloc) => {
                            const cat = categories.find((c) => c.id === alloc.categoryId);
                            return (
                              <View key={alloc.id} style={styles.budgetRow}>
                                <View style={styles.catDotRow}>
                                  <View
                                    style={[
                                      styles.catDot,
                                      { backgroundColor: cat?.color ?? Colors.muted },
                                    ]}
                                  />
                                  <Text variant="caption" color={Colors.text}>
                                    {cat?.name ?? 'Category'}
                                  </Text>
                                </View>
                                <Text variant="label" color={Colors.text}>
                                  {formatMoney(alloc.allocatedPaise)}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    </DraftCard>
                  )}
                </View>
              </View>
            );
          }

          return null;
        })}

        {/* Typing indicator */}
        {isProcessing && (
          <View style={styles.assistantBubbleContainer}>
            <View style={styles.botAvatarMini}>
              <Sparkles size={14} color={Colors.accentLight} />
            </View>
            <View style={[styles.assistantBubble, styles.typingBubble]}>
              <ActivityIndicator size="small" color={Colors.accentLight} />
              <Text variant="caption" color={Colors.text2}>
                Thinking…
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Suggested prompts chips */}
      <View style={styles.suggestedContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.suggestedScroll}
        >
          {SUGGESTED_PROMPTS.map((prompt, idx) => (
            <Pressable
              key={idx}
              style={styles.suggestionChip}
              onPress={() => handleSend(prompt)}
              disabled={isProcessing || !aiEnabled}
              accessibilityRole="button"
              accessibilityLabel={prompt}
            >
              <Sparkles size={12} color={Colors.accentLight} />
              <Text variant="caption" color={Colors.text}>
                {prompt}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Input bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder={
              aiEnabled ? 'Ask a question or enter an expense...' : 'AI disabled in Settings'
            }
            placeholderTextColor={Colors.muted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => handleSend()}
            returnKeyType="send"
            editable={aiEnabled && !isProcessing}
            accessibilityLabel="Message input"
          />

          <Pressable
            style={[
              styles.sendBtn,
              (!input.trim() || isProcessing || !aiEnabled) && styles.sendBtnDisabled,
            ]}
            onPress={() => handleSend()}
            disabled={!input.trim() || isProcessing || !aiEnabled}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            hitSlop={8}
          >
            <Send
              size={18}
              color={input.trim() && aiEnabled ? Colors.text : Colors.muted}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    backgroundColor: Colors.surface,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  botIconBadge: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: 1,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.income,
  },
  closeBtn: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: Spacing.base,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  settingsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: Spacing.xs,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    padding: Spacing.base,
    gap: Spacing.base,
    paddingBottom: Spacing.xl,
  },
  userBubbleContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  userBubble: {
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
    borderBottomRightRadius: 4,
    maxWidth: '82%',
  },
  assistantBubbleContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  botAvatarMini: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.hairline,
    marginTop: 2,
  },
  assistantBubble: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderBottomLeftRadius: 4,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.hairline,
    maxWidth: '85%',
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  assistantDraftContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    width: '100%',
  },
  draftContent: {
    gap: Spacing.sm,
  },
  expenseHero: {
    gap: 2,
  },
  draftChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  splitHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  splitPeopleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  myShareHighlight: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  budgetProposalsList: {
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  catDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  catDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  questionCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  capsLabel: {
    letterSpacing: 0.8,
  },
  questionAnswerText: {
    lineHeight: 22,
  },
  breakdownTable: {
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    paddingTop: Spacing.xs,
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  resolvedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    padding: Spacing.base,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  suggestedContainer: {
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.xs,
  },
  suggestedScroll: {
    paddingHorizontal: Spacing.base,
    gap: Spacing.xs,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.surface2,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.hairline,
    minHeight: 34,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  input: {
    flex: 1,
    minHeight: TouchTarget,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.base,
    color: Colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  sendBtn: {
    width: TouchTarget,
    height: TouchTarget,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.surface2,
    opacity: 0.6,
  },
});
