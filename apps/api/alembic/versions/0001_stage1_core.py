"""Create the frozen Stage 1 schema."""

import sqlalchemy as sa

from alembic import op

revision = "0001_stage1_core"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("auth_provider", sa.String(length=40), nullable=True),
        sa.Column("provider_user_id", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=10), server_default="user", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('user','admin')", name="ck_users_role"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "email", name="uq_users_id_email"),
    )
    op.create_index(
        "uq_users_email_lower", "users", [sa.text("lower(email)")], unique=True
    )
    op.create_index(
        "uq_users_provider_identity",
        "users",
        ["auth_provider", "provider_user_id"],
        unique=True,
        postgresql_where=sa.text("auth_provider IS NOT NULL AND provider_user_id IS NOT NULL"),
        sqlite_where=sa.text("auth_provider IS NOT NULL AND provider_user_id IS NOT NULL"),
    )

    op.create_table(
        "user_sync_state",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("last_sync_seq", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_seq", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=True),
        sa.Column("icon", sa.String(length=40), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "id", name="uq_categories_user_id"),
        sa.UniqueConstraint("user_id", "sync_seq", name="uq_categories_user_sync_seq"),
    )
    op.create_index("ix_categories_user_sync_seq", "categories", ["user_id", "sync_seq"])
    op.create_index(
        "uq_categories_active_name",
        "categories",
        ["user_id", sa.text("lower(name)")],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_seq", sa.BigInteger(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("merchant", sa.String(length=120), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.CheckConstraint("kind IN ('expense','income')", name="ck_transactions_kind"),
        sa.CheckConstraint("amount_paise > 0", name="ck_transactions_amount_positive"),
        sa.ForeignKeyConstraint(
            ["user_id", "category_id"],
            ["categories.user_id", "categories.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "id", name="uq_transactions_user_id"),
        sa.UniqueConstraint("user_id", "sync_seq", name="uq_transactions_user_sync_seq"),
    )
    op.create_index("ix_transactions_user_sync_seq", "transactions", ["user_id", "sync_seq"])
    op.create_index(
        "ix_transactions_user_date", "transactions", ["user_id", "transaction_date", "id"]
    )
    op.create_index(
        "ix_transactions_user_category_date",
        "transactions",
        ["user_id", "category_id", "transaction_date"],
    )

    op.create_table(
        "budgets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_seq", sa.BigInteger(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("amount_paise > 0", name="ck_budgets_amount_positive"),
        sa.CheckConstraint(
            "substr(CAST(month AS VARCHAR), 9, 2) = '01'", name="ck_budgets_month_first_day"
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "category_id"],
            ["categories.user_id", "categories.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "id", name="uq_budgets_user_id"),
        sa.UniqueConstraint("user_id", "sync_seq", name="uq_budgets_user_sync_seq"),
    )
    op.create_index("ix_budgets_user_sync_seq", "budgets", ["user_id", "sync_seq"])
    op.create_index(
        "uq_budgets_overall_month",
        "budgets",
        ["user_id", "month"],
        unique=True,
        postgresql_where=sa.text("category_id IS NULL AND deleted_at IS NULL"),
        sqlite_where=sa.text("category_id IS NULL AND deleted_at IS NULL"),
    )
    op.create_index(
        "uq_budgets_category_month",
        "budgets",
        ["user_id", "category_id", "month"],
        unique=True,
        postgresql_where=sa.text("category_id IS NOT NULL AND deleted_at IS NULL"),
        sqlite_where=sa.text("category_id IS NOT NULL AND deleted_at IS NULL"),
    )

    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_refresh_sessions_user_expires", "refresh_sessions", ["user_id", "expires_at"]
    )


def downgrade() -> None:
    op.drop_table("refresh_sessions")
    op.drop_table("budgets")
    op.drop_table("transactions")
    op.drop_table("categories")
    op.drop_table("user_sync_state")
    op.drop_index("uq_users_provider_identity", table_name="users")
    op.drop_index("uq_users_email_lower", table_name="users")
    op.drop_table("users")
