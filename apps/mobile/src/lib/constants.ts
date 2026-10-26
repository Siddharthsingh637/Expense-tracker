import { Category, Person } from '@/engine/types';

// ---------------------------------------------------------------------------
// Default categories seeded on first run
// ---------------------------------------------------------------------------

export const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Food', type: 'variable', icon: 'utensils', color: '#E67E22', isArchived: false, sortOrder: 0 },
  { name: 'Transport', type: 'variable', icon: 'car', color: '#3498DB', isArchived: false, sortOrder: 1 },
  { name: 'Bills', type: 'fixed', icon: 'zap', color: '#9B59B6', isArchived: false, sortOrder: 2 },
  { name: 'Shopping', type: 'variable', icon: 'shopping-bag', color: '#E91E63', isArchived: false, sortOrder: 3 },
  { name: 'Health', type: 'variable', icon: 'heart', color: '#2ECC71', isArchived: false, sortOrder: 4 },
  { name: 'Entertainment', type: 'variable', icon: 'tv', color: '#1ABC9C', isArchived: false, sortOrder: 5 },
  { name: 'Rent', type: 'fixed', icon: 'home', color: '#795548', isArchived: false, sortOrder: 6 },
  { name: 'Savings', type: 'savings', icon: 'piggy-bank', color: '#4A7C59', isArchived: false, sortOrder: 7 },
  { name: 'Other', type: 'variable', icon: 'more-horizontal', color: '#6F675A', isArchived: false, sortOrder: 8 },
];

// ---------------------------------------------------------------------------
// The "Me" person — always present, never archived
// ---------------------------------------------------------------------------

export const ME_PERSON_ID = 'me';

export const ME_PERSON: Person = {
  id: ME_PERSON_ID,
  name: 'Me',
  isMe: true,
  isArchived: false,
};

// ---------------------------------------------------------------------------
// Budget template presets
// ---------------------------------------------------------------------------

export interface BudgetTemplate {
  label: string;
  description: string;
  /** Map of categoryName → fraction (0–1), must sum to ≤ 1 */
  fractions: Record<string, number>;
}

export const BUDGET_TEMPLATES: BudgetTemplate[] = [
  {
    label: '50/30/20',
    description: 'Needs 50%, Wants 30%, Savings 20%',
    fractions: {
      Food: 0.18,
      Transport: 0.08,
      Bills: 0.14,
      Rent: 0.10,
      Shopping: 0.10,
      Health: 0.05,
      Entertainment: 0.10,
      Savings: 0.20,
      Other: 0.05,
    },
  },
];

// ---------------------------------------------------------------------------
// Payment mode labels
// ---------------------------------------------------------------------------

export const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
};

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const MAX_BUDGET_CATEGORIES = 10;
export const MAX_NOTE_LENGTH = 200;
export const MAX_PLACE_LENGTH = 60;
