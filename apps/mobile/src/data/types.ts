import {
  Transaction,
  Category,
  MonthBudget,
  BudgetAllocation,
  GroupBill,
  BillSettlement,
  Person,
} from '@/engine/types';

export interface TxnFilter {
  categoryId?: string;
  paymentMode?: string;
  dateFrom?: string;
  dateTo?: string;
  hasBillPhoto?: boolean;
  search?: string;
  splitId?: string;
}

export interface TransactionRepository {
  getAll(filter?: TxnFilter): Promise<Transaction[]>;
  getById(id: string): Promise<Transaction | null>;
  save(txn: Transaction): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CategoryRepository {
  getAll(): Promise<Category[]>;
  getById(id: string): Promise<Category | null>;
  save(cat: Category): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface BudgetRepository {
  getMonth(month: string): Promise<MonthBudget | null>;
  getAllMonths(): Promise<MonthBudget[]>;
  getAllocations(month: string): Promise<BudgetAllocation[]>;
  saveMonth(budget: MonthBudget): Promise<void>;
  saveAllocation(alloc: BudgetAllocation): Promise<void>;
  deleteAllocation(id: string): Promise<void>;
}

export interface SplitsRepository {
  getAllBills(): Promise<GroupBill[]>;
  getBill(id: string): Promise<GroupBill | null>;
  saveBill(bill: GroupBill): Promise<void>;
  getPeople(): Promise<Person[]>;
  savePerson(p: Person): Promise<void>;
  getSettlements(billId: string): Promise<BillSettlement[]>;
  saveSettlement(s: BillSettlement): Promise<void>;
}
