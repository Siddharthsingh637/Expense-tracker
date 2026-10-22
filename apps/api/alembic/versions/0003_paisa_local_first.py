"""Add mobile-aligned local-first resources and AI usage metadata."""

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

revision = "0003_paisa_local_first"
down_revision = "0002_stage2_auth_security"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    sync_cols = {c["name"] for c in insp.get_columns("user_sync_state")}
    if "retained_from_seq" not in sync_cols:
        op.add_column("user_sync_state", sa.Column("retained_from_seq", sa.BigInteger(), nullable=False, server_default="0"))
    category_cols = {c["name"] for c in insp.get_columns("categories")}
    for name, typ, default in (
        ("type", sa.String(10), "'variable'"),
        ("is_archived", sa.Boolean(), "false"),
        ("sort_order", sa.BigInteger(), "0"),
    ):
        if name not in category_cols:
            op.add_column("categories", sa.Column(name, typ, nullable=False, server_default=sa.text(default)))
    category_checks = {c["name"] for c in inspect(bind).get_check_constraints("categories")}
    if "ck_categories_type" not in category_checks:
        with op.batch_alter_table("categories") as batch:
            batch.create_check_constraint("ck_categories_type", "type IN ('fixed','variable','savings')")
    txn_cols = {c["name"] for c in insp.get_columns("transactions")}
    additions = (
        ("place", sa.String(120), "''"), ("payment_mode", sa.String(8), "'cash'"),
        ("local_time", sa.String(8), "'00:00:00'"), ("timezone", sa.String(64), "'UTC'"),
        ("provenance", sa.String(16), "'user'"), ("group_bill_id", sa.Uuid(), None),
        ("attachment_id", sa.Uuid(), None), ("local_date", sa.Date(), None),
    )
    for name, typ, default in additions:
        if name not in txn_cols:
            op.add_column("transactions", sa.Column(name, typ, nullable=default is None, server_default=sa.text(default) if default else None))
    if "transactions" in insp.get_table_names():
        checks = {c["name"] for c in insp.get_check_constraints("transactions")}
        with op.batch_alter_table("transactions") as batch:
            if "ck_transactions_kind" in checks:
                batch.drop_constraint("ck_transactions_kind", type_="check")
            batch.create_check_constraint("ck_transactions_kind", "kind IN ('expense','income','refund')")

    # Create new ORM-defined tables; existing revisions remain immutable.
    from expense_tracker_api import models  # noqa: F401
    from expense_tracker_api.db.session import Base
    Base.metadata.create_all(bind=bind, checkfirst=True)
    transaction_fks = {fk.get("name") for fk in inspect(bind).get_foreign_keys("transactions")}
    if "fk_transactions_user_group_bill" not in transaction_fks:
        with op.batch_alter_table("transactions") as batch:
            batch.create_foreign_key(
                "fk_transactions_user_group_bill", "group_bills",
                ["user_id", "group_bill_id"], ["user_id", "id"],
            )


def downgrade() -> None:
    # Data-bearing new tables are preserved; destructive downgrade is intentionally unsupported.
    raise RuntimeError("0003 is irreversible because it introduces synced user data")
