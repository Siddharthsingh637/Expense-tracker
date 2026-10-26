import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppState,
  Transaction,
  Category,
  MonthBudget,
  BudgetAllocation,
  GroupBill,
  BillSettlement,
  Person,
  PaymentMode,
  AIFeatureToggles,
} from '@/engine/types';
import { DEFAULT_CATEGORIES, ME_PERSON } from '@/lib/constants';
import { toYYYYMM } from '@/lib/format';

// Resilient storage that uses AsyncStorage when available and safely falls back
// to in-memory storage if native storage module is null or uninitialized.
const memoryFallback = new Map<string, string>();
const STORE_NAME = 'paisa-store';
const STORE_OWNER_KEY = 'paisa-store-owner';
let activeStoreOwner: string | undefined;

function storageKey(name: string): string {
  return name === STORE_NAME && activeStoreOwner
    ? activeStoreOwner === 'guest' ? `${STORE_NAME}:guest` : `${STORE_NAME}:user:${activeStoreOwner}`
    : name;
}

const safeStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const key = storageKey(name);
    try {
      if (AsyncStorage && typeof AsyncStorage.getItem === 'function') {
        const value = await AsyncStorage.getItem(key);
        if (value !== null && value !== undefined) return value;
      }
    } catch {
      // Fallback
    }
    return memoryFallback.get(key) ?? null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const key = storageKey(name);
    memoryFallback.set(key, value);
    try {
      if (AsyncStorage && typeof AsyncStorage.setItem === 'function') {
        await AsyncStorage.setItem(key, value);
      }
    } catch {
      // Fallback
    }
  },
  removeItem: async (name: string): Promise<void> => {
    const key = storageKey(name);
    memoryFallback.delete(key);
    try {
      if (AsyncStorage && typeof AsyncStorage.removeItem === 'function') {
        await AsyncStorage.removeItem(key);
      }
    } catch {
      // Fallback
    }
  },
};

function genId(_prefix: string): string {
  // Sync resources use UUID primary keys on the API. Keep IDs API-compatible
  // even while the app is offline so a later push does not need an ID rewrite.
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${((8 + Math.floor(Math.random() * 4)).toString(16))}${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

export interface PaisaStore extends AppState {
  // Onboarding
  completeOnboarding(): void;
  setCurrentMonth(month: string): void;
  setBudgetStartDay(day: number): void;

  // Categories
  addCategory(cat: Omit<Category, 'id'>): void;
  updateCategory(id: string, updates: Partial<Category>): void;
  removeCategory(id: string): void;

  // Transactions
  addTransaction(txn: Omit<Transaction, 'id' | 'createdAt'>): Transaction;
  restoreTransaction(txn: Transaction): void;
  updateTransaction(id: string, updates: Partial<Transaction>): void;
  deleteTransaction(id: string): void;

  // Budgets
  setMonthBudget(budget: Omit<MonthBudget, 'id'>): void;
  setBudgetAllocation(alloc: Omit<BudgetAllocation, 'id'>): void;
  removeBudgetAllocation(id: string): void;

  // Splits
  addGroupBill(bill: Omit<GroupBill, 'id' | 'createdAt'>): GroupBill;
  updateGroupBill(id: string, updates: Partial<GroupBill>): void;
  addSettlement(s: Omit<BillSettlement, 'id'>): void;
  updateSettlement(id: string, updates: Partial<BillSettlement>): void;
  addPerson(p: Omit<Person, 'id'>): void;
  updatePerson(id: string, updates: Partial<Person>): void;

  // UI
  setLastUsedPaymentMode(mode: PaymentMode): void;
  setFabPosition(position: 'left' | 'right'): void;
  setFabY(y: number): void;
  setAIEnabled(enabled: boolean): void;
  setAIFeatureToggle(key: string, value: boolean): void;

  // Demo
  loadDemoData(): void;
  resetAll(): void;
}

const initialCategories: Category[] = DEFAULT_CATEGORIES.map((c, i) => ({
  ...c,
  id: `cat-${i}`,
}));

const initialState: AppState = {
  isOnboarded: false,
  currentMonth: toYYYYMM(new Date()),
  budgetStartDay: 1,
  categories: initialCategories,
  transactions: [],
  monthBudgets: [],
  budgetAllocations: [],
  groupBills: [],
  billSettlements: [],
  people: [ME_PERSON],
  aiEnabled: true,
  aiFeatureToggles: {
    entryParsing: true,
    categorization: true,
    splitDrafting: true,
    budgetSuggestions: true,
    summaries: true,
  },
  lastUsedPaymentMode: 'upi',
  fabPosition: 'right',
  fabY: 0,
};

function generateDemoState(): Partial<AppState> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth(); // 0-indexed

  // Format YYYY-MM
  const currentMonthStr = toYYYYMM(now);
  const prevDate = new Date(currentYear, currentMonthNum - 1, 1);
  const prevMonthStr = toYYYYMM(prevDate);

  const demoPeople: Person[] = [
    ME_PERSON,
    { id: 'person-1', name: 'Rohan Sharma', isMe: false, isArchived: false, upiId: 'rohan@oksbi' },
    { id: 'person-2', name: 'Priya Patel', isMe: false, isArchived: false, upiId: 'priya@okhdfc' },
    { id: 'person-3', name: 'Amit Verma', isMe: false, isArchived: false, upiId: 'amit@icici' },
    { id: 'person-4', name: 'Sneha Reddy', isMe: false, isArchived: false, upiId: 'sneha@paytm' },
  ];

  const demoMonthBudgets: MonthBudget[] = [
    {
      id: 'mb-demo-1',
      month: currentMonthStr,
      totalPaise: 2500000, // ₹25,000
      startDay: 1,
    },
  ];

  const demoAllocations: BudgetAllocation[] = [
    { id: 'alloc-demo-0', month: currentMonthStr, categoryId: 'cat-0', allocatedPaise: 600000 },  // Food ₹6,000
    { id: 'alloc-demo-1', month: currentMonthStr, categoryId: 'cat-1', allocatedPaise: 250000 },  // Transport ₹2,500
    { id: 'alloc-demo-2', month: currentMonthStr, categoryId: 'cat-2', allocatedPaise: 300000 },  // Bills ₹3,000
    { id: 'alloc-demo-3', month: currentMonthStr, categoryId: 'cat-3', allocatedPaise: 250000 },  // Shopping ₹2,500
    { id: 'alloc-demo-4', month: currentMonthStr, categoryId: 'cat-4', allocatedPaise: 150000 },  // Health ₹1,500
    { id: 'alloc-demo-5', month: currentMonthStr, categoryId: 'cat-5', allocatedPaise: 200000 },  // Entertainment ₹2,000
    { id: 'alloc-demo-6', month: currentMonthStr, categoryId: 'cat-6', allocatedPaise: 500000 },  // Rent ₹5,000
    { id: 'alloc-demo-7', month: currentMonthStr, categoryId: 'cat-7', allocatedPaise: 200000 },  // Savings ₹2,000
    { id: 'alloc-demo-8', month: currentMonthStr, categoryId: 'cat-8', allocatedPaise: 50000 },   // Other ₹500
  ];

  const demoGroupBills: GroupBill[] = [
    {
      id: 'bill-demo-1',
      title: 'Dinner at Toit Brewpub',
      date: `${currentMonthStr}-10`,
      personIds: ['me', 'person-1', 'person-2', 'person-3', 'person-4'],
      payments: { me: 250000 }, // ₹2,500 paid by Me
      method: 'equal',
      categoryId: 'cat-0',
      isSettled: false,
      createdAt: new Date(currentYear, currentMonthNum, 10, 21, 30).toISOString(),
    },
  ];

  const demoSettlements: BillSettlement[] = [
    {
      id: 'settle-demo-1',
      groupBillId: 'bill-demo-1',
      fromPersonId: 'person-1',
      toPersonId: 'me',
      amountPaise: 50000,
      paidAmountPaise: 50000,
      isPaid: true,
      paidAt: new Date(currentYear, currentMonthNum, 11, 14, 20).toISOString(),
    },
    {
      id: 'settle-demo-2',
      groupBillId: 'bill-demo-1',
      fromPersonId: 'person-2',
      toPersonId: 'me',
      amountPaise: 50000,
      paidAmountPaise: 50000,
      isPaid: true,
      paidAt: new Date(currentYear, currentMonthNum, 11, 18, 5).toISOString(),
    },
    {
      id: 'settle-demo-3',
      groupBillId: 'bill-demo-1',
      fromPersonId: 'person-3',
      toPersonId: 'me',
      amountPaise: 50000,
      paidAmountPaise: 0,
      isPaid: false,
    },
    {
      id: 'settle-demo-4',
      groupBillId: 'bill-demo-1',
      fromPersonId: 'person-4',
      toPersonId: 'me',
      amountPaise: 50000,
      paidAmountPaise: 0,
      isPaid: false,
    },
  ];

  // 60 realistic transactions across the last 2 months
  interface TxnTemplate {
    place: string;
    note: string;
    categoryId: string;
    amount: number;
    paymentMode: PaymentMode;
    dayOffset: number; // 0 to 27
    isPrevMonth: boolean;
    hour: number;
    minute: number;
    provenance?: 'user' | 'ai_confirmed' | 'ai_edited';
  }

  const rawTxnTemplates: TxnTemplate[] = [
    // Current month transactions (35 txns)
    { place: 'Chai stall', note: 'Morning cutting chai and bun maska', categoryId: 'cat-0', amount: 4000, paymentMode: 'upi', dayOffset: 1, isPrevMonth: false, hour: 8, minute: 30 },
    { place: 'Uber ride', note: 'Cab to office', categoryId: 'cat-1', amount: 24000, paymentMode: 'upi', dayOffset: 1, isPrevMonth: false, hour: 9, minute: 15 },
    { place: 'Monthly rent', note: 'House rent transfer', categoryId: 'cat-6', amount: 1200000, paymentMode: 'upi', dayOffset: 1, isPrevMonth: false, hour: 11, minute: 0 },
    { place: 'Zomato lunch', note: 'North Indian thali delivery', categoryId: 'cat-0', amount: 28000, paymentMode: 'upi', dayOffset: 2, isPrevMonth: false, hour: 13, minute: 20 },
    { place: 'Metro recharge', note: 'Smart card recharge', categoryId: 'cat-1', amount: 50000, paymentMode: 'card', dayOffset: 2, isPrevMonth: false, hour: 18, minute: 45 },
    { place: 'Apollo Pharmacy', note: 'Vitamins & cold medicine', categoryId: 'cat-4', amount: 42000, paymentMode: 'upi', dayOffset: 3, isPrevMonth: false, hour: 20, minute: 10 },
    { place: 'Swiggy order', note: 'Evening snacks', categoryId: 'cat-0', amount: 18500, paymentMode: 'upi', dayOffset: 4, isPrevMonth: false, hour: 17, minute: 30 },
    { place: 'Amazon order', note: 'Laptop stand and USB hub', categoryId: 'cat-3', amount: 149900, paymentMode: 'card', dayOffset: 5, isPrevMonth: false, hour: 14, minute: 15 },
    { place: 'Electricity bill', note: 'Bescom power bill', categoryId: 'cat-2', amount: 134000, paymentMode: 'upi', dayOffset: 5, isPrevMonth: false, hour: 19, minute: 0 },
    { place: 'Blue Tokai coffee', note: 'Cold brew and croissant', categoryId: 'cat-0', amount: 36000, paymentMode: 'card', dayOffset: 6, isPrevMonth: false, hour: 10, minute: 40 },
    { place: 'Auto rickshaw', note: 'Auto back home', categoryId: 'cat-1', amount: 8000, paymentMode: 'cash', dayOffset: 6, isPrevMonth: false, hour: 21, minute: 10 },
    { place: 'Netflix subscription', note: 'Standard plan monthly', categoryId: 'cat-5', amount: 49900, paymentMode: 'card', dayOffset: 7, isPrevMonth: false, hour: 9, minute: 0 },
    { place: 'Mutual Fund SIP', note: 'Nifty 50 Index Fund', categoryId: 'cat-7', amount: 200000, paymentMode: 'upi', dayOffset: 8, isPrevMonth: false, hour: 10, minute: 0 },
    { place: 'Local mess', note: 'Dinner thali', categoryId: 'cat-0', amount: 12000, paymentMode: 'cash', dayOffset: 8, isPrevMonth: false, hour: 20, minute: 30 },
    { place: 'Shell petrol bunk', note: 'Fuel refill for bike', categoryId: 'cat-1', amount: 65000, paymentMode: 'upi', dayOffset: 9, isPrevMonth: false, hour: 8, minute: 50 },
    { place: 'Dominos Pizza', note: 'Farmhouse pizza with friends', categoryId: 'cat-0', amount: 56000, paymentMode: 'card', dayOffset: 10, isPrevMonth: false, hour: 21, minute: 0 },
    { place: 'Airtel broadband', note: 'Home fiber internet bill', categoryId: 'cat-2', amount: 99900, paymentMode: 'upi', dayOffset: 11, isPrevMonth: false, hour: 12, minute: 30 },
    { place: 'Rapido bike ride', note: 'Quick ride to metro', categoryId: 'cat-1', amount: 4500, paymentMode: 'upi', dayOffset: 12, isPrevMonth: false, hour: 9, minute: 10 },
    { place: 'BigBasket grocery', note: 'Weekly vegetables & staples', categoryId: 'cat-0', amount: 115000, paymentMode: 'upi', dayOffset: 13, isPrevMonth: false, hour: 16, minute: 20 },
    { place: 'BookMyShow', note: 'Movie tickets for weekend', categoryId: 'cat-5', amount: 72000, paymentMode: 'upi', dayOffset: 14, isPrevMonth: false, hour: 18, minute: 15 },
    { place: 'Chai stall', note: 'Chai and samosa', categoryId: 'cat-0', amount: 3500, paymentMode: 'cash', dayOffset: 15, isPrevMonth: false, hour: 17, minute: 0 },
    { place: 'Myntra clothes', note: 'Cotton shirts sale', categoryId: 'cat-3', amount: 129900, paymentMode: 'card', dayOffset: 16, isPrevMonth: false, hour: 22, minute: 10 },
    { place: 'Jio recharge', note: 'Mobile prepaid 3-month recharge', categoryId: 'cat-2', amount: 74900, paymentMode: 'upi', dayOffset: 17, isPrevMonth: false, hour: 11, minute: 45 },
    { place: 'Uber ride', note: 'Cab to airport', categoryId: 'cat-1', amount: 68000, paymentMode: 'upi', dayOffset: 18, isPrevMonth: false, hour: 6, minute: 30 },
    { place: 'Haldiram snacks', note: 'Kaju katli and namkeen', categoryId: 'cat-0', amount: 45000, paymentMode: 'card', dayOffset: 19, isPrevMonth: false, hour: 15, minute: 0 },
    { place: 'Doctor consultation', note: 'General physician visit', categoryId: 'cat-4', amount: 60000, paymentMode: 'upi', dayOffset: 20, isPrevMonth: false, hour: 19, minute: 30 },
    { place: '1mg medicines', note: 'Prescription refill', categoryId: 'cat-4', amount: 38000, paymentMode: 'card', dayOffset: 21, isPrevMonth: false, hour: 14, minute: 0 },
    { place: 'Spotify premium', note: 'Family plan', categoryId: 'cat-5', amount: 17900, paymentMode: 'card', dayOffset: 21, isPrevMonth: false, hour: 10, minute: 0 },
    { place: 'Subway sandwich', note: 'Paneer tikka sub', categoryId: 'cat-0', amount: 26000, paymentMode: 'upi', dayOffset: 22, isPrevMonth: false, hour: 13, minute: 40 },
    { place: 'Stationery shop', note: 'Notebooks and gel pens', categoryId: 'cat-8', amount: 18000, paymentMode: 'cash', dayOffset: 23, isPrevMonth: false, hour: 18, minute: 0 },
    { place: 'Ola auto', note: 'Ride to mall', categoryId: 'cat-1', amount: 9500, paymentMode: 'upi', dayOffset: 24, isPrevMonth: false, hour: 12, minute: 15 },
    { place: 'Biryani Blues', note: 'Chicken dum biryani', categoryId: 'cat-0', amount: 38000, paymentMode: 'upi', dayOffset: 25, isPrevMonth: false, hour: 20, minute: 45 },
    { place: 'Decathlon gear', note: 'Running socks & water bottle', categoryId: 'cat-3', amount: 59900, paymentMode: 'card', dayOffset: 26, isPrevMonth: false, hour: 16, minute: 30 },
    { place: 'Chai stall', note: 'Evening ginger tea', categoryId: 'cat-0', amount: 2000, paymentMode: 'cash', dayOffset: 27, isPrevMonth: false, hour: 17, minute: 15 },
    { place: 'Swiggy Instamart', note: 'Milk, bread & bananas', categoryId: 'cat-0', amount: 21500, paymentMode: 'upi', dayOffset: 27, isPrevMonth: false, hour: 21, minute: 50 },

    // Previous month transactions (25 txns)
    { place: 'Monthly rent', note: 'House rent', categoryId: 'cat-6', amount: 1200000, paymentMode: 'upi', dayOffset: 1, isPrevMonth: true, hour: 10, minute: 0 },
    { place: 'Mutual Fund SIP', note: 'Nifty 50 Index Fund', categoryId: 'cat-7', amount: 200000, paymentMode: 'upi', dayOffset: 2, isPrevMonth: true, hour: 9, minute: 30 },
    { place: 'Electricity bill', note: 'Power bill previous month', categoryId: 'cat-2', amount: 128000, paymentMode: 'upi', dayOffset: 3, isPrevMonth: true, hour: 14, minute: 10 },
    { place: 'Uber ride', note: 'Ride to railway station', categoryId: 'cat-1', amount: 32000, paymentMode: 'upi', dayOffset: 4, isPrevMonth: true, hour: 7, minute: 45 },
    { place: 'Zomato dinner', note: 'Dosa & filter coffee', categoryId: 'cat-0', amount: 22000, paymentMode: 'upi', dayOffset: 5, isPrevMonth: true, hour: 20, minute: 15 },
    { place: 'Amazon shopping', note: 'Wireless mouse & mousepad', categoryId: 'cat-3', amount: 89900, paymentMode: 'card', dayOffset: 6, isPrevMonth: true, hour: 11, minute: 20 },
    { place: 'Chai stall', note: 'Masala chai', categoryId: 'cat-0', amount: 3000, paymentMode: 'cash', dayOffset: 7, isPrevMonth: true, hour: 8, minute: 40 },
    { place: 'Shell petrol bunk', note: 'Full tank fuel', categoryId: 'cat-1', amount: 70000, paymentMode: 'card', dayOffset: 8, isPrevMonth: true, hour: 18, minute: 30 },
    { place: 'Airtel broadband', note: 'Fiber wifi monthly bill', categoryId: 'cat-2', amount: 99900, paymentMode: 'upi', dayOffset: 9, isPrevMonth: true, hour: 12, minute: 0 },
    { place: 'Apollo Pharmacy', note: 'Bandages & pain relief spray', categoryId: 'cat-4', amount: 29000, paymentMode: 'upi', dayOffset: 10, isPrevMonth: true, hour: 19, minute: 10 },
    { place: 'Starbucks coffee', note: 'Caramel macchiato', categoryId: 'cat-0', amount: 41000, paymentMode: 'card', dayOffset: 12, isPrevMonth: true, hour: 16, minute: 30 },
    { place: 'Metro recharge', note: 'Smart card recharge', categoryId: 'cat-1', amount: 50000, paymentMode: 'card', dayOffset: 13, isPrevMonth: true, hour: 9, minute: 5 },
    { place: 'Netflix subscription', note: 'Monthly plan', categoryId: 'cat-5', amount: 49900, paymentMode: 'card', dayOffset: 14, isPrevMonth: true, hour: 9, minute: 0 },
    { place: 'Local dhaba', note: 'Dal makhani & rotis', categoryId: 'cat-0', amount: 28000, paymentMode: 'cash', dayOffset: 15, isPrevMonth: true, hour: 21, minute: 20 },
    { place: 'BookMyShow', note: 'Weekend cinema ticket', categoryId: 'cat-5', amount: 38000, paymentMode: 'upi', dayOffset: 16, isPrevMonth: true, hour: 17, minute: 45 },
    { place: 'Auto rickshaw', note: 'Auto fare', categoryId: 'cat-1', amount: 7000, paymentMode: 'cash', dayOffset: 17, isPrevMonth: true, hour: 22, minute: 10 },
    { place: 'Swiggy order', note: 'Biryani bowl lunch', categoryId: 'cat-0', amount: 32000, paymentMode: 'upi', dayOffset: 18, isPrevMonth: true, hour: 13, minute: 30 },
    { place: 'Decathlon gear', note: 'Gym gloves and shaker', categoryId: 'cat-3', amount: 64900, paymentMode: 'card', dayOffset: 19, isPrevMonth: true, hour: 15, minute: 40 },
    { place: 'Courier charges', note: 'Speed post parcel to parents', categoryId: 'cat-8', amount: 15000, paymentMode: 'cash', dayOffset: 20, isPrevMonth: true, hour: 11, minute: 15 },
    { place: 'Dental checkup', note: 'Teeth cleaning session', categoryId: 'cat-4', amount: 95000, paymentMode: 'card', dayOffset: 21, isPrevMonth: true, hour: 18, minute: 0 },
    { place: 'Spotify premium', note: 'Monthly streaming', categoryId: 'cat-5', amount: 17900, paymentMode: 'card', dayOffset: 22, isPrevMonth: true, hour: 10, minute: 0 },
    { place: 'Ola cab', note: 'Airport pickup', categoryId: 'cat-1', amount: 62000, paymentMode: 'upi', dayOffset: 23, isPrevMonth: true, hour: 23, minute: 15 },
    { place: 'Chai stall', note: 'Tea with biscuits', categoryId: 'cat-0', amount: 2500, paymentMode: 'cash', dayOffset: 24, isPrevMonth: true, hour: 16, minute: 50 },
    { place: 'BigBasket grocery', note: 'Monthly pantry refill', categoryId: 'cat-0', amount: 145000, paymentMode: 'upi', dayOffset: 25, isPrevMonth: true, hour: 14, minute: 30 },
    { place: 'Swiggy Instamart', note: 'Ice cream tub & snacks', categoryId: 'cat-0', amount: 34000, paymentMode: 'upi', dayOffset: 26, isPrevMonth: true, hour: 22, minute: 40 },
  ];

  const demoTransactions: Transaction[] = rawTxnTemplates.map((t, idx) => {
    const monthStr = t.isPrevMonth ? prevMonthStr : currentMonthStr;
    const dayStr = String(Math.min(28, Math.max(1, t.dayOffset))).padStart(2, '0');
    const dateStr = `${monthStr}-${dayStr}`;
    const timeStr = `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
    const [y, m] = monthStr.split('-').map(Number);
    const createdAt = new Date(y, m - 1, Number(dayStr), t.hour, t.minute).toISOString();

    return {
      id: `demo-txn-${idx + 1}`,
      amount: t.amount,
      categoryId: t.categoryId,
      place: t.place,
      note: t.note,
      paymentMode: t.paymentMode,
      date: dateStr,
      time: timeStr,
      createdAt,
      provenance: t.provenance ?? (idx % 4 === 0 ? 'ai_confirmed' : 'user'),
    };
  });

  return {
    isOnboarded: true,
    currentMonth: currentMonthStr,
    budgetStartDay: 1,
    categories: initialCategories,
    transactions: demoTransactions,
    monthBudgets: demoMonthBudgets,
    budgetAllocations: demoAllocations,
    groupBills: demoGroupBills,
    billSettlements: demoSettlements,
    people: demoPeople,
    aiEnabled: true,
    lastUsedPaymentMode: 'upi',
    fabPosition: 'right',
    fabY: 0,
  };
}

export const usePaisaStore = create<PaisaStore>()(
  persist(
    (set) => ({
      ...initialState,

      // Onboarding
      completeOnboarding: () => set({ isOnboarded: true }),
      setCurrentMonth: (month: string) => set({ currentMonth: month }),
      setBudgetStartDay: (day: number) => set({ budgetStartDay: day }),

      // Categories
      addCategory: (cat: Omit<Category, 'id'>) => {
        const newCat: Category = {
          ...cat,
          id: genId('cat'),
        };
        set((state) => ({
          categories: [...state.categories, newCat],
        }));
      },
      updateCategory: (id: string, updates: Partial<Category>) => {
        set((state) => ({
          categories: state.categories.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        }));
      },
      removeCategory: (id: string) => {
        set((state) => ({
          categories: state.categories.filter((c) => c.id !== id),
          budgetAllocations: state.budgetAllocations.filter((a) => a.categoryId !== id),
        }));
      },

      // Transactions
      addTransaction: (txn: Omit<Transaction, 'id' | 'createdAt'>): Transaction => {
        const newTxn: Transaction = {
          ...txn,
          id: (txn as { id?: string }).id ?? genId('txn'),
          createdAt:
            (txn as { createdAt?: string }).createdAt ?? new Date().toISOString(),
        };
        set((state) => ({
          transactions: [newTxn, ...state.transactions],
          lastUsedPaymentMode: txn.paymentMode,
        }));
        return newTxn;
      },
      restoreTransaction: (txn: Transaction) => {
        set((state) => ({
          transactions: [txn, ...state.transactions],
        }));
      },
      updateTransaction: (id: string, updates: Partial<Transaction>) => {
        set((state) => ({
          transactions: state.transactions.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }));
      },
      deleteTransaction: (id: string) => {
        set((state) => ({
          transactions: state.transactions.filter((t) => t.id !== id),
        }));
      },

      // Budgets
      setMonthBudget: (budget: Omit<MonthBudget, 'id'>) => {
        const normMonth = budget.month.slice(0, 7);
        const normBudget = { ...budget, month: normMonth };
        set((state) => {
          const existingIndex = state.monthBudgets.findIndex(
            (b) => b.month.slice(0, 7) === normMonth
          );
          if (existingIndex >= 0) {
            const updated = [...state.monthBudgets];
            updated[existingIndex] = {
              ...updated[existingIndex],
              ...normBudget,
            };
            return { monthBudgets: updated };
          }
          const newBudget: MonthBudget = {
            ...normBudget,
            id: genId('mb'),
          };
          return { monthBudgets: [...state.monthBudgets, newBudget] };
        });
      },
      setBudgetAllocation: (alloc: Omit<BudgetAllocation, 'id'>) => {
        const normMonth = alloc.month.slice(0, 7);
        const normAlloc = { ...alloc, month: normMonth };
        set((state) => {
          const existingIndex = state.budgetAllocations.findIndex(
            (a) => a.month.slice(0, 7) === normMonth && a.categoryId === alloc.categoryId
          );
          if (existingIndex >= 0) {
            const updated = [...state.budgetAllocations];
            updated[existingIndex] = {
              ...updated[existingIndex],
              ...normAlloc,
            };
            return { budgetAllocations: updated };
          }
          const newAlloc: BudgetAllocation = {
            ...normAlloc,
            id: genId('alloc'),
          };
          return { budgetAllocations: [...state.budgetAllocations, newAlloc] };
        });
      },
      removeBudgetAllocation: (id: string) => {
        set((state) => ({
          budgetAllocations: state.budgetAllocations.filter((a) => a.id !== id),
        }));
      },

      // Splits
      addGroupBill: (bill: Omit<GroupBill, 'id' | 'createdAt'>): GroupBill => {
        const newBill: GroupBill = {
          ...bill,
          id: (bill as { id?: string }).id ?? genId('bill'),
          createdAt:
            (bill as { createdAt?: string }).createdAt ?? new Date().toISOString(),
        };
        set((state) => ({
          groupBills: [newBill, ...state.groupBills],
        }));
        return newBill;
      },
      updateGroupBill: (id: string, updates: Partial<GroupBill>) => {
        set((state) => ({
          groupBills: state.groupBills.map((b) =>
            b.id === id ? { ...b, ...updates } : b
          ),
        }));
      },
      addSettlement: (s: Omit<BillSettlement, 'id'>) => {
        const newSettlement: BillSettlement = {
          ...s,
          id: genId('settle'),
        };
        set((state) => ({
          billSettlements: [...state.billSettlements, newSettlement],
        }));
      },
      updateSettlement: (id: string, updates: Partial<BillSettlement>) => {
        set((state) => ({
          billSettlements: state.billSettlements.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        }));
      },
      addPerson: (p: Omit<Person, 'id'>) => {
        const newPerson: Person = {
          ...p,
          id: genId('person'),
        };
        set((state) => ({
          people: [...state.people, newPerson],
        }));
      },
      updatePerson: (id: string, updates: Partial<Person>) => {
        set((state) => ({
          people: state.people.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }));
      },

      // UI
      setLastUsedPaymentMode: (mode: PaymentMode) => {
        set({ lastUsedPaymentMode: mode });
      },
      setFabPosition: (position: 'left' | 'right') => {
        set({ fabPosition: position });
      },
      setFabY: (y: number) => {
        set({ fabY: y });
      },
      setAIEnabled: (enabled: boolean) => {
        set({ aiEnabled: enabled });
      },
      setAIFeatureToggle: (key: string, value: boolean) => {
        set((state) => ({
          aiFeatureToggles: {
            ...state.aiFeatureToggles,
            [key]: value,
          } as AIFeatureToggles,
        }));
      },

      // Demo & Reset
      loadDemoData: () => {
        const demoState = generateDemoState();
        set((state) => ({
          ...state,
          ...demoState,
        }));
      },
      resetAll: () => {
        set({
          ...initialState,
          currentMonth: toYYYYMM(new Date()),
        });
      },
    }),
    {
      name: 'paisa-store',
      storage: createJSONStorage(() => safeStorage),
    }
  )
);

const namespaceKey = (owner: string) => owner === 'guest' ? `${STORE_NAME}:guest` : `${STORE_NAME}:user:${owner}`;
const freshState = () => ({ ...initialState, currentMonth: toYYYYMM(new Date()) });
const persistState = (state: PaisaStore | AppState) => JSON.stringify({ state, version: 0 });

/** Switch the active dataset without merging ownership. Data from legacy
 * installs with no owner marker is quarantined in Guest Mode. */
async function activateStore(owner: string): Promise<void> {
  const previousOwner = await AsyncStorage.getItem(STORE_OWNER_KEY);
  const currentState = usePaisaStore.getState();

  if (previousOwner && previousOwner !== owner) {
    await AsyncStorage.setItem(namespaceKey(previousOwner), persistState(currentState));
  } else if (!previousOwner) {
    // Legacy unowned records stay available locally but are never attributed to
    // whichever account happens to sign in first.
    await AsyncStorage.setItem(namespaceKey('guest'), persistState(currentState));
  } else {
    await AsyncStorage.setItem(namespaceKey(owner), persistState(currentState));
  }

  activeStoreOwner = owner;
  await AsyncStorage.setItem(STORE_OWNER_KEY, owner);

  const saved = await AsyncStorage.getItem(namespaceKey(owner));
  const parsed = saved ? JSON.parse(saved) as { state?: Partial<PaisaStore> } : null;
  const nextState = parsed?.state ? { ...freshState(), ...parsed.state } : freshState();
  if (nextState.monthBudgets && nextState.monthBudgets.length > 0) {
    nextState.isOnboarded = true;
  }
  usePaisaStore.setState(nextState);
}

export async function activateStoreForUser(userId: string): Promise<void> {
  await activateStore(userId);
}

export async function activateGuestStore(): Promise<void> {
  await activateStore('guest');
}

export function activeStoreUser(): string | undefined {
  return activeStoreOwner === 'guest' ? undefined : activeStoreOwner;
}
