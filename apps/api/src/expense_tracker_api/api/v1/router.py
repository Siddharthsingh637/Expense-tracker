from fastapi import APIRouter

from expense_tracker_api.features.ai.router import router as ai_router
from expense_tracker_api.features.attachments.router import router as attachments_router
from expense_tracker_api.features.auth.router import router as auth_router
from expense_tracker_api.features.budgets.router import router as budgets_router
from expense_tracker_api.features.expenses.router import (
    categories_router,
    transactions_router,
)
from expense_tracker_api.features.sync.router import router as sync_router

router = APIRouter()
for feature_router in (
    auth_router,
    categories_router,
    transactions_router,
    budgets_router,
    sync_router,
    attachments_router,
    ai_router,
):
    router.include_router(feature_router)
