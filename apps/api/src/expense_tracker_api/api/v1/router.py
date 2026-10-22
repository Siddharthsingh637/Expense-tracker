from fastapi import APIRouter

from expense_tracker_api.api.v1 import (
    ai,
    attachments,
    auth,
    budgets,
    categories,
    sync,
    transactions,
)

router = APIRouter()
for module in (auth, categories, transactions, budgets, sync, attachments, ai):
    router.include_router(module.router)
