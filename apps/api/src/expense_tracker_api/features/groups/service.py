from __future__ import annotations

import uuid
from typing import Any


def calculate_equal_split(total_paise: int, participant_ids: list[str]) -> dict[str, int]:
    """Evenly divide total_paise among participants, distributing remainder cents/paise."""
    n = len(participant_ids)
    if n == 0:
        return {}
    base = total_paise // n
    remainder = total_paise % n
    result: dict[str, int] = {}
    for i, pid in enumerate(participant_ids):
        result[pid] = base + (1 if i < remainder else 0)
    return result


def compute_net_balances(
    bills: list[dict[str, Any]], settlements: list[dict[str, Any]]
) -> dict[str, int]:
    """Compute net balance per person: positive means person is owed money, negative means they owe."""
    balances: dict[str, int] = {}
    for bill in bills:
        payer = str(bill.get("payer_person_id"))
        shares = bill.get("shares", {})
        total = bill.get("total_paise", 0)
        balances[payer] = balances.get(payer, 0) + total
        for pid, share in shares.items():
            balances[pid] = balances.get(pid, 0) - share

    for s in settlements:
        if s.get("is_paid"):
            f = str(s.get("from_person_id"))
            t = str(s.get("to_person_id"))
            amt = s.get("amount_paise", 0)
            balances[f] = balances.get(f, 0) + amt
            balances[t] = balances.get(t, 0) - amt

    return balances
