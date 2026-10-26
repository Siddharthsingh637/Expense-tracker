from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.features.expenses.schemas import (
    CategoryIn,
    CategoryPatch,
    DeleteIn,
    TransactionIn,
    TransactionPatch,
)
from expense_tracker_api.features.expenses.service import (
    create_category_service,
    create_transaction_service,
    delete_category_service,
    delete_transaction_service,
    get_category_service,
    get_transaction_service,
    list_categories_service,
    list_transactions_service,
    patch_category_service,
    patch_transaction_service,
)
from expense_tracker_api.models import User

categories_router = APIRouter(tags=["categories"])
transactions_router = APIRouter(tags=["transactions"])


# --- Category Endpoints ---

@categories_router.get("/categories")
def list_categories(
    include_deleted: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_categories_service(db, user, include_deleted)


@categories_router.post("/categories", status_code=201)
def create_category(
    payload: CategoryIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return create_category_service(db, user, payload)


@categories_router.get("/categories/{record_id}")
def get_category(
    record_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_category_service(db, user, record_id)


@categories_router.patch("/categories/{record_id}")
def patch_category(
    record_id: uuid.UUID,
    payload: CategoryPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return patch_category_service(db, user, record_id, payload)


@categories_router.delete("/categories/{record_id}")
def delete_category(
    record_id: uuid.UUID,
    payload: DeleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return delete_category_service(db, user, record_id, payload)


# --- Transaction Endpoints ---

@transactions_router.get("/transactions")
def list_transactions(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    category_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=100),
    kind: str | None = Query(default=None, pattern="^(expense|income)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    sort: str = Query(default="date_desc", pattern="^(date_desc|date_asc)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_transactions_service(
        db, user, from_date, to_date, category_id, q, kind, page, page_size, sort
    )


@transactions_router.post("/transactions", status_code=201)
def create_transaction(
    payload: TransactionIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return create_transaction_service(db, user, payload)


@transactions_router.get("/transactions/{record_id}")
def get_transaction(
    record_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_transaction_service(db, user, record_id)


@transactions_router.patch("/transactions/{record_id}")
def patch_transaction(
    record_id: uuid.UUID,
    payload: TransactionPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return patch_transaction_service(db, user, record_id, payload)


@transactions_router.delete("/transactions/{record_id}")
def delete_transaction(
    record_id: uuid.UUID,
    payload: DeleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return delete_transaction_service(db, user, record_id, payload)


router = APIRouter()
router.include_router(categories_router)
router.include_router(transactions_router)
