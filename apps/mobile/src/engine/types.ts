/**
 * Core domain types for the Paisa expense tracker.
 * All amounts are stored as integer paise (₹1 = 100 paise) — never floats.
 * This file has zero React imports; it is safe to import in engine tests.
 */

// ---------------------------------------------------------------------------
// Scalar aliases — enforce intent at the type level
// ---------------------------------------------------------------------------

/** Integer paise value (₹1 = 100). Never store as float. */
export type Paise = number;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type PaymentMode = 'cash' | 'upi' | 'card';

export type TransactionProvenance = 'user' | 'ai_confirmed' | 'ai_edited';

export type CategoryType = 'fixed' | 'variable' | 'savings';

export type SplitMethod = 'equal' | 'custom' | 'percent' | 'shares' | 'itemized';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  icon: string;      // lucide-react-native icon name
  color: string;     // hex colour token
  isArchived: boolean;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface Transaction {
  id: string;
  /** Positive = expense (money out). Negative = income / refund. */
  amount: Paise;
  categoryId: string;
  /** Short merchant / place name shown on cards */
  place: string;
  note: string;
  paymentMode: PaymentMode;
  billPhotoUri?: string;
  /** ISO date: YYYY-MM-DD (local) */
  date: string;
  /** Local time: HH:MM */
  time: string;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  provenance: TransactionProvenance;
  /** Set when this transaction was auto-created from a group bill */
  splitId?: string;
  /** True for intra-budget category transfers (not real spending) */
  isTransfer?: boolean;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export interface MonthBudget {
  id: string;
  /** YYYY-MM */
  month: string;
  /** Total money available this month */
  totalPaise: Paise;
  /** Day of month the budget period starts (1–28) */
  startDay: number;
}

export interface BudgetAllocation {
  id: string;
  /** YYYY-MM */
  month: string;
  categoryId: string;
  allocatedPaise: Paise;
}

// ---------------------------------------------------------------------------
// People & Splits
// ---------------------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
  upiId?: string;
  /** True for the device owner; always present, never archived */
  isMe: boolean;
  isArchived: boolean;
}

export interface SplitItem {
  id: string;
  description: string;
  amountPaise: Paise;
  /** Person IDs who share this item */
  assignedPersonIds: string[];
}

export interface GroupBill {
  id: string;
  title: string;
  /** ISO date: YYYY-MM-DD */
  date: string;
  /** All participant person IDs */
  personIds: string[];
  /** personId → amount paid by that person */
  payments: Record<string, Paise>;
  method: SplitMethod;
  /** Custom paise amounts per person (method: 'custom') */
  customShares?: Record<string, Paise>;
  /** Percent per person, 0–100 (method: 'percent') */
  percentShares?: Record<string, number>;
  /** Integer weight/units per person (method: 'shares') */
  shareWeights?: Record<string, number>;
  /** Item list (method: 'itemized') */
  items?: SplitItem[];
  /** Additional tax on top of item subtotals (method: 'itemized') */
  taxPaise?: Paise;
  /** Additional tip (method: 'itemized') */
  tipPaise?: Paise;
  categoryId?: string;
  isSettled: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Computed split results (never stored, always derived)
// ---------------------------------------------------------------------------

export interface PersonBalance {
  personId: string;
  /** How much this person actually paid */
  paid: Paise;
  /** This person's fair share of the total */
  share: Paise;
  /** net = paid − share.  > 0 → creditor; < 0 → debtor */
  net: Paise;
}

export interface SettlementTransfer {
  fromPersonId: string;
  toPersonId: string;
  amountPaise: Paise;
  isPaid: boolean;
  paidAmountPaise: Paise;
}

// ---------------------------------------------------------------------------
// Group Bill Settlement record (stored separately from Transaction)
// ---------------------------------------------------------------------------

export interface BillSettlement {
  id: string;
  groupBillId: string;
  fromPersonId: string;
  toPersonId: string;
  amountPaise: Paise;
  paidAmountPaise: Paise;
  isPaid: boolean;
  paidAt?: string;
}

// ---------------------------------------------------------------------------
// Engine computed types
// ---------------------------------------------------------------------------

export interface BudgetPeriod {
  /** Inclusive start date: YYYY-MM-DD */
  start: string;
  /** Inclusive end date: YYYY-MM-DD */
  end: string;
}

export interface CategorySpendResult {
  categoryId: string;
  allocatedPaise: Paise;
  spentPaise: Paise;
  remainingPaise: Paise;
  isOverBudget: boolean;
}

export interface PaceResult {
  leftPaise: Paise;
  daysLeft: number;
  safePerDayPaise: Paise;
  projectedSpendPaise: Paise;
  isOnTrack: boolean;
}

export interface MonthReport {
  month: string;
  totalSpentPaise: Paise;
  totalAllocatedPaise: Paise;
  totalBudgetPaise: Paise;
  savedOrOverspentPaise: Paise;  // negative = overspent
  cashPaidOutPaise: Paise;
  categoryBreakdown: CategorySpendResult[];
  biggestChanges: Array<{
    categoryId: string;
    currentPaise: Paise;
    previousAvgPaise: Paise;
    deltaPercent: number;
  }>;
  duplicateSuspects: Array<{ txnIds: string[]; reason: string }>;
}

// ---------------------------------------------------------------------------
// AI types (interface lives in src/ai/types.ts; draft shape lives here
// so engine can reference it without importing AI layer)
// ---------------------------------------------------------------------------

export interface AIDraft<T> {
  data: T;
  /** 0–1 */
  confidence: number;
  /** One-line explanation shown in DraftCard */
  reason: string;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// App-level store shape (used by Zustand store)
// ---------------------------------------------------------------------------

export interface AIFeatureToggles {
  entryParsing: boolean;
  categorization: boolean;
  splitDrafting: boolean;
  budgetSuggestions: boolean;
  summaries: boolean;
}

export interface AppState {
  isOnboarded: boolean;
  /** YYYY-MM */
  currentMonth: string;
  budgetStartDay: number;
  categories: Category[];
  transactions: Transaction[];
  monthBudgets: MonthBudget[];
  budgetAllocations: BudgetAllocation[];
  groupBills: GroupBill[];
  billSettlements: BillSettlement[];
  people: Person[];
  aiEnabled: boolean;
  aiFeatureToggles: AIFeatureToggles;
  lastUsedPaymentMode: PaymentMode;
  fabPosition: 'left' | 'right';
  fabY: number;
}
