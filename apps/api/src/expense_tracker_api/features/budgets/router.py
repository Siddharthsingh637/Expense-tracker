from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.features.budgets.schemas import BudgetIn, BudgetPatch, DeleteIn
from expense_tracker_api.features.budgets.service import (
    create_budget_service,
    delete_budget_service,
    get_budget_service,
    list_budgets_service,
    patch_budget_service,
)
from expense_tracker_api.models import User

router = APIRouter(tags=["budgets"])


@router.get("/budgets")
def list_budgets(
    month: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_budgets_service(db, user, month)


@router.post("/budgets", status_code=201)
def create_budget(
    payload: BudgetIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return create_budget_service(db, user, payload)


@router.get("/budgets/{record_id}")
def get_budget(
    record_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_budget_service(db, user, record_id)


@router.patch("/budgets/{record_id}")
def patch_budget(
    record_id: uuid.UUID,
    payload: BudgetPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return patch_budget_service(db, user, record_id, payload)


@router.delete("/budgets/{record_id}")
def delete_budget(
    record_id: uuid.UUID,
    payload: DeleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return delete_budget_service(db, user, record_id, payload)
