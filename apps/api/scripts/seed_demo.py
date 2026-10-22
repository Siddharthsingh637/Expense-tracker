from __future__ import annotations

import os
import uuid
from calendar import monthrange
from datetime import date

from sqlalchemy import func, select

from expense_tracker_api.api.v1.common import DEFAULT_CATEGORIES
from expense_tracker_api.api.v1.sync import _mobile_data
from expense_tracker_api.core.security import hash_password
from expense_tracker_api.db.session import SessionLocal
from expense_tracker_api.models import (
    BudgetAllocation,
    BudgetPeriod,
    Category,
    GroupBill,
    Person,
    Settlement,
    SyncChange,
    Transaction,
    User,
    UserSettings,
    UserSyncState,
    utcnow,
)


def main() -> None:
    email = os.environ.get("DEMO_EMAIL", "demo@paisa.local").strip().lower()
    password = os.environ.get("DEMO_PASSWORD", "paisa-demo-pass-123")
    if len(password) < 12:
        raise SystemExit("DEMO_PASSWORD must be at least 12 characters")
    with SessionLocal() as db:
        existing = db.scalar(select(User).where(func.lower(User.email) == email))
        if existing:
            print(f"Demo account {email} already exists; no rows changed.")
            return
        now = utcnow()
        user = User(email=email, password_hash=hash_password(password))
        db.add(user)
        db.flush()
        state = UserSyncState(user_id=user.id, last_sync_seq=0, retained_from_seq=0)
        db.add(state)
        settings = UserSettings(user_id=user.id, budget_start_day=1)
        db.add(settings)

        def record(resource: str, row) -> None:
            state.last_sync_seq += 1
            row.sync_seq = state.last_sync_seq
            db.flush()
            data = _mobile_data(db, resource, row)
            data["_created_at"] = row.created_at.isoformat().replace("+00:00", "Z") if hasattr(row, "created_at") else now.isoformat().replace("+00:00", "Z")
            data["_updated_at"] = row.updated_at.isoformat().replace("+00:00", "Z") if hasattr(row, "updated_at") else now.isoformat().replace("+00:00", "Z")
            data["_deleted_at"] = None
            db.add(SyncChange(user_id=user.id, sync_seq=state.last_sync_seq, resource=resource,
                              record_id=str(row.id), operation="upsert", snapshot=data, created_at=now))

        categories = {}
        for order, (name, color, icon) in enumerate(DEFAULT_CATEGORIES):
            category = Category(id=uuid.uuid4(), user_id=user.id, name=name, color=color, icon=icon,
                                type="fixed" if name in {"Bills", "Rent"} else "savings" if name == "Savings" else "variable",
                                is_archived=False, sort_order=order, created_at=now, updated_at=now,
                                deleted_at=None, sync_seq=order + 1)
            db.add(category)
            categories[name] = category
        state.last_sync_seq = len(categories)
        db.flush()
        for category in categories.values():
            record("category", category)
        record("user_settings", settings)

        today = date.today()
        month = today.strftime("%Y-%m")
        start = today.replace(day=1)
        end = today.replace(day=monthrange(today.year, today.month)[1])
        period = BudgetPeriod(id=uuid.uuid4(), user_id=user.id, month=month, start_day=1,
                              start_date=start, end_date=end, total_paise=500000, status="open",
                              created_at=now, updated_at=now, deleted_at=None, sync_seq=0)
        db.add(period)
        db.flush()
        record("budget_period", period)
        for name, amount in (("Food",120000),("Transport",40000),("Bills",90000),("Rent",100000),
                             ("Shopping",50000),("Health",25000),("Entertainment",35000),("Savings",20000),("Other",20000)):
            allocation = BudgetAllocation(id=uuid.uuid4(), user_id=user.id, period_id=period.id,
                                          category_id=categories[name].id, amount_paise=amount,
                                          rollover=False, created_at=now, updated_at=now,
                                          deleted_at=None, sync_seq=0)
            db.add(allocation)
            db.flush()
            record("budget_allocation", allocation)

        for place, amount, category, day in (("Demo Cafe",4500,"Food",5),("Metro",3200,"Transport",8),("Groceries",8200,"Food",12)):
            txn_date = today.replace(day=min(day, today.day))
            txn = Transaction(id=uuid.uuid4(), user_id=user.id, category_id=categories[category].id,
                              kind="expense", amount_paise=amount, transaction_date=txn_date, local_date=txn_date,
                              merchant=place, place=place, note="Sample transaction", payment_mode="upi",
                              local_time="12:00:00", timezone="Asia/Kolkata", provenance="user",
                              created_at=now, updated_at=now, deleted_at=None, sync_seq=0)
            db.add(txn)
            db.flush()
            record("transaction", txn)

        person_ids = list("ABCDE")
        for person_id in person_ids:
            person = Person(id=person_id, user_id=user.id, name=f"Person {person_id}", upi_id=None,
                            is_archived=False, created_at=now, updated_at=now, deleted_at=None, sync_seq=0)
            db.add(person)
            db.flush()
            record("person", person)
        payments = {"A":500000,"B":70000,"C":20000,"D":10000,"E":250000}
        bill = GroupBill(id=uuid.uuid4(), user_id=user.id, title="Party example", bill_date=today,
                         person_ids=person_ids, payments=payments, method="equal", custom_shares=None,
                         percent_shares=None, share_weights=None, items=None, tax_paise=0, tip_paise=0,
                         category_id=categories["Entertainment"].id, is_settled=False,
                         created_at=now, updated_at=now, deleted_at=None, sync_seq=0)
        db.add(bill)
        db.flush()
        record("group_bill", bill)
        for from_id, to_id, amount in (("D","A",160000),("C","A",150000),("B","A",20000),("B","E",80000)):
            settlement = Settlement(id=uuid.uuid4(), user_id=user.id, group_bill_id=bill.id,
                                    from_person_id=from_id, to_person_id=to_id, amount_paise=amount,
                                    paid_amount_paise=0, is_paid=False, paid_at=None, voided_at=None,
                                    created_at=now, updated_at=now, deleted_at=None, sync_seq=0)
            db.add(settlement)
            db.flush()
            record("settlement", settlement)
        db.commit()
        print(f"Seeded {email} / {password} with categories, budget, transactions, party bill and settlements.")


if __name__ == "__main__":
    main()
