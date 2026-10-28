import { useFinancerStore } from './store';
import {
  TransactionRepository,
  CategoryRepository,
  BudgetRepository,
  SplitsRepository,
  TxnFilter,
} from '../types';
import {
  Transaction,
  Category,
  MonthBudget,
  BudgetAllocation,
  GroupBill,
  BillSettlement,
  Person,
} from '@/engine/types';

export class LocalTransactionRepository implements TransactionRepository {
  async getAll(filter?: TxnFilter): Promise<Transaction[]> {
    const txns = useFinancerStore.getState().transactions;
    if (!filter) return txns;

    return txns.filter((txn) => {
      if (filter.categoryId !== undefined && txn.categoryId !== filter.categoryId) {
        return false;
      }
      if (filter.paymentMode !== undefined && txn.paymentMode !== filter.paymentMode) {
        return false;
      }
      if (filter.dateFrom !== undefined && txn.date < filter.dateFrom) {
        return false;
      }
      if (filter.dateTo !== undefined && txn.date > filter.dateTo) {
        return false;
      }
      if (filter.hasBillPhoto !== undefined) {
        const hasPhoto = Boolean(txn.billPhotoUri && txn.billPhotoUri.length > 0);
        if (hasPhoto !== filter.hasBillPhoto) {
          return false;
        }
      }
      if (filter.splitId !== undefined && txn.splitId !== filter.splitId) {
        return false;
      }
      if (filter.search !== undefined && filter.search.trim().length > 0) {
        const q = filter.search.toLowerCase();
        const matchesPlace = txn.place.toLowerCase().includes(q);
        const matchesNote = (txn.note ?? '').toLowerCase().includes(q);
        if (!matchesPlace && !matchesNote) {
          return false;
        }
      }
      return true;
    });
  }

  async getById(id: string): Promise<Transaction | null> {
    const txns = useFinancerStore.getState().transactions;
    const found = txns.find((t) => t.id === id);
    return found ?? null;
  }

  async save(txn: Transaction): Promise<void> {
    const { transactions, updateTransaction } = useFinancerStore.getState();
    const exists = transactions.some((t) => t.id === txn.id);
    if (exists) {
      updateTransaction(txn.id, txn);
    } else {
      useFinancerStore.setState((state) => ({
        transactions: [txn, ...state.transactions],
        lastUsedPaymentMode: txn.paymentMode,
      }));
    }
  }

  async delete(id: string): Promise<void> {
    useFinancerStore.getState().deleteTransaction(id);
  }
}

export class LocalCategoryRepository implements CategoryRepository {
  async getAll(): Promise<Category[]> {
    return useFinancerStore.getState().categories;
  }

  async getById(id: string): Promise<Category | null> {
    const cat = useFinancerStore.getState().categories.find((c) => c.id === id);
    return cat ?? null;
  }

  async save(cat: Category): Promise<void> {
    const { categories, updateCategory } = useFinancerStore.getState();
    const exists = categories.some((c) => c.id === cat.id);
    if (exists) {
      updateCategory(cat.id, cat);
    } else {
      useFinancerStore.setState((state) => ({
        categories: [...state.categories, cat],
      }));
    }
  }

  async delete(id: string): Promise<void> {
    useFinancerStore.getState().removeCategory(id);
  }
}

export class LocalBudgetRepository implements BudgetRepository {
  async getMonth(month: string): Promise<MonthBudget | null> {
    const mb = useFinancerStore.getState().monthBudgets.find((b) => b.month === month);
    return mb ?? null;
  }

  async getAllMonths(): Promise<MonthBudget[]> {
    return useFinancerStore.getState().monthBudgets;
  }

  async getAllocations(month: string): Promise<BudgetAllocation[]> {
    return useFinancerStore
      .getState()
      .budgetAllocations.filter((a) => a.month === month);
  }

  async saveMonth(budget: MonthBudget): Promise<void> {
    useFinancerStore.getState().setMonthBudget(budget);
  }

  async saveAllocation(alloc: BudgetAllocation): Promise<void> {
    useFinancerStore.getState().setBudgetAllocation(alloc);
  }

  async deleteAllocation(id: string): Promise<void> {
    useFinancerStore.getState().removeBudgetAllocation(id);
  }
}

export class LocalSplitsRepository implements SplitsRepository {
  async getAllBills(): Promise<GroupBill[]> {
    return useFinancerStore.getState().groupBills;
  }

  async getBill(id: string): Promise<GroupBill | null> {
    const bill = useFinancerStore.getState().groupBills.find((b) => b.id === id);
    return bill ?? null;
  }

  async saveBill(bill: GroupBill): Promise<void> {
    const { groupBills, updateGroupBill } = useFinancerStore.getState();
    const exists = groupBills.some((b) => b.id === bill.id);
    if (exists) {
      updateGroupBill(bill.id, bill);
    } else {
      useFinancerStore.setState((state) => ({
        groupBills: [bill, ...state.groupBills],
      }));
    }
  }

  async getPeople(): Promise<Person[]> {
    return useFinancerStore.getState().people;
  }

  async savePerson(p: Person): Promise<void> {
    const { people, updatePerson } = useFinancerStore.getState();
    const exists = people.some((person) => person.id === p.id);
    if (exists) {
      updatePerson(p.id, p);
    } else {
      useFinancerStore.setState((state) => ({
        people: [...state.people, p],
      }));
    }
  }

  async getSettlements(billId: string): Promise<BillSettlement[]> {
    return useFinancerStore
      .getState()
      .billSettlements.filter((s) => s.groupBillId === billId);
  }

  async saveSettlement(s: BillSettlement): Promise<void> {
    const { billSettlements, updateSettlement } = useFinancerStore.getState();
    const exists = billSettlements.some((item) => item.id === s.id);
    if (exists) {
      updateSettlement(s.id, s);
    } else {
      useFinancerStore.setState((state) => ({
        billSettlements: [...state.billSettlements, s],
      }));
    }
  }
}

export const repositories = {
  transactions: new LocalTransactionRepository(),
  categories: new LocalCategoryRepository(),
  budget: new LocalBudgetRepository(),
  splits: new LocalSplitsRepository(),
};
