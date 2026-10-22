from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from expense_tracker_api.db.session import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    auth_provider: Mapped[str | None] = mapped_column(String(40))
    provider_user_id: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(10), nullable=False, default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    token_version: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (
        CheckConstraint("role IN ('user','admin')", name="ck_users_role"),
        UniqueConstraint("id", "email", name="uq_users_id_email"),
        Index("uq_users_email_lower", text("lower(email)"), unique=True),
        Index(
            "uq_users_provider_identity",
            "auth_provider",
            "provider_user_id",
            unique=True,
            postgresql_where=text("auth_provider IS NOT NULL AND provider_user_id IS NOT NULL"),
            sqlite_where=text("auth_provider IS NOT NULL AND provider_user_id IS NOT NULL"),
        ),
    )

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None


class UserSyncState(Base):
    __tablename__ = "user_sync_state"
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    last_sync_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    retained_from_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class SyncedRecord:
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_seq: Mapped[int] = mapped_column(BigInteger, nullable=False)


class Category(SyncedRecord, Base):
    __tablename__ = "categories"
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str | None] = mapped_column(String(7))
    icon: Mapped[str | None] = mapped_column(String(40))
    type: Mapped[str] = mapped_column(String(10), nullable=False, default="variable")
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    __table_args__ = (
        CheckConstraint("type IN ('fixed','variable','savings')", name="ck_categories_type"),
        UniqueConstraint("user_id", "id", name="uq_categories_user_id"),
        UniqueConstraint("user_id", "sync_seq", name="uq_categories_user_sync_seq"),
        Index("ix_categories_user_sync_seq", "user_id", "sync_seq"),
        Index(
            "uq_categories_active_name",
            "user_id",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )


class Transaction(SyncedRecord, Base):
    __tablename__ = "transactions"
    category_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    local_date: Mapped[date | None] = mapped_column(Date)
    merchant: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(String(500))
    place: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    payment_mode: Mapped[str] = mapped_column(String(8), nullable=False, default="cash")
    local_time: Mapped[str] = mapped_column(String(8), nullable=False, default="00:00:00")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    provenance: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    group_bill_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    attachment_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    __table_args__ = (
        CheckConstraint("kind IN ('expense','income','refund')", name="ck_transactions_kind"),
        CheckConstraint("amount_paise > 0", name="ck_transactions_amount_positive"),
        ForeignKeyConstraint(
            ["user_id", "category_id"], ["categories.user_id", "categories.id"], ondelete="RESTRICT"
        ),
        ForeignKeyConstraint(["user_id", "group_bill_id"], ["group_bills.user_id", "group_bills.id"], name="fk_transactions_user_group_bill"),
        UniqueConstraint("user_id", "id", name="uq_transactions_user_id"),
        UniqueConstraint("user_id", "sync_seq", name="uq_transactions_user_sync_seq"),
        Index("ix_transactions_user_sync_seq", "user_id", "sync_seq"),
        Index("ix_transactions_user_date", "user_id", "transaction_date", "id"),
        Index("ix_transactions_user_category_date", "user_id", "category_id", "transaction_date"),
    )


class Budget(SyncedRecord, Base):
    __tablename__ = "budgets"
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    month: Mapped[date] = mapped_column(Date, nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    __table_args__ = (
        CheckConstraint("amount_paise > 0", name="ck_budgets_amount_positive"),
        CheckConstraint(
            "substr(CAST(month AS VARCHAR), 9, 2) = '01'", name="ck_budgets_month_first_day"
        ),
        ForeignKeyConstraint(
            ["user_id", "category_id"], ["categories.user_id", "categories.id"], ondelete="RESTRICT"
        ),
        UniqueConstraint("user_id", "id", name="uq_budgets_user_id"),
        UniqueConstraint("user_id", "sync_seq", name="uq_budgets_user_sync_seq"),
        Index("ix_budgets_user_sync_seq", "user_id", "sync_seq"),
        Index(
            "uq_budgets_overall_month",
            "user_id",
            "month",
            unique=True,
            postgresql_where=text("category_id IS NULL AND deleted_at IS NULL"),
            sqlite_where=text("category_id IS NULL AND deleted_at IS NULL"),
        ),
        Index(
            "uq_budgets_category_month",
            "user_id",
            "category_id",
            "month",
            unique=True,
            postgresql_where=text("category_id IS NOT NULL AND deleted_at IS NULL"),
            sqlite_where=text("category_id IS NOT NULL AND deleted_at IS NULL"),
        ),
    )


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    family_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, default=uuid.uuid4)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        Index("ix_refresh_sessions_user_expires", "user_id", "expires_at"),
        Index("ix_refresh_sessions_family_id", "family_id"),
    )


# Local-first mobile resources. JSON columns preserve the mobile whole-document
# split contract; all IDs and ownership remain relational and tenant scoped.
class BudgetPeriod(SyncedRecord, Base):
    __tablename__ = "budget_periods"
    month: Mapped[str] = mapped_column(String(7), nullable=False)
    start_day: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="open")
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("user_id", "start_date", name="uq_budget_period_user_start"),
        CheckConstraint("start_day BETWEEN 1 AND 28", name="ck_budget_period_start_day"),
        CheckConstraint("total_paise >= 0", name="ck_budget_period_total"),
        CheckConstraint("status IN ('open','closed')", name="ck_budget_period_status"),
        UniqueConstraint("user_id", "id", name="uq_budget_period_user_id"),
        UniqueConstraint("user_id", "sync_seq", name="uq_budget_period_user_seq"),
        Index("ix_budget_period_user_seq", "user_id", "sync_seq"),
    )


class BudgetAllocation(SyncedRecord, Base):
    __tablename__ = "budget_allocations"
    period_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    rollover: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    __table_args__ = (
        CheckConstraint("amount_paise >= 0", name="ck_budget_allocation_amount"),
        ForeignKeyConstraint(["user_id", "period_id"], ["budget_periods.user_id", "budget_periods.id"]),
        ForeignKeyConstraint(["user_id", "category_id"], ["categories.user_id", "categories.id"]),
        UniqueConstraint("user_id", "id", name="uq_budget_allocation_user_id"),
        UniqueConstraint("user_id", "sync_seq", name="uq_budget_allocation_user_seq"),
        UniqueConstraint("user_id", "period_id", "category_id", name="uq_budget_allocation_user_period_category"),
        Index("ix_budget_allocation_user_seq", "user_id", "sync_seq"),
    )


class BudgetTransfer(SyncedRecord, Base):
    __tablename__ = "budget_transfers"
    period_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    from_category_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    to_category_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    note: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("amount_paise > 0", name="ck_budget_transfer_amount"),
        CheckConstraint("from_category_id <> to_category_id", name="ck_budget_transfer_distinct"),
        ForeignKeyConstraint(["user_id", "period_id"], ["budget_periods.user_id", "budget_periods.id"]),
        ForeignKeyConstraint(["user_id", "from_category_id"], ["categories.user_id", "categories.id"]),
        ForeignKeyConstraint(["user_id", "to_category_id"], ["categories.user_id", "categories.id"]),
        UniqueConstraint("user_id", "id", name="uq_budget_transfer_user_id"),
        UniqueConstraint("user_id", "sync_seq", name="uq_budget_transfer_user_seq"),
        Index("ix_budget_transfer_user_seq", "user_id", "sync_seq"),
    )


class Person(SyncedRecord, Base):
    __tablename__ = "people"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    upi_id: Mapped[str | None] = mapped_column(String(255))
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    __table_args__ = (
        UniqueConstraint("user_id", "id", name="uq_people_user_key"),
        UniqueConstraint("user_id", "sync_seq", name="uq_people_user_seq"),
        Index("ix_people_user_seq", "user_id", "sync_seq"),
    )


class GroupBill(SyncedRecord, Base):
    __tablename__ = "group_bills"
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    bill_date: Mapped[date] = mapped_column(Date, nullable=False)
    person_ids: Mapped[list] = mapped_column(JSON, nullable=False)
    payments: Mapped[dict] = mapped_column(JSON, nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    custom_shares: Mapped[dict | None] = mapped_column(JSON)
    percent_shares: Mapped[dict | None] = mapped_column(JSON)
    share_weights: Mapped[dict | None] = mapped_column(JSON)
    items: Mapped[list | None] = mapped_column(JSON)
    tax_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    tip_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    is_settled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    __table_args__ = (
        CheckConstraint("method IN ('equal','custom','percent','shares','itemized')", name="ck_group_bill_method"),
        CheckConstraint("tax_paise >= 0 AND tip_paise >= 0", name="ck_group_bill_extras"),
        ForeignKeyConstraint(["user_id", "category_id"], ["categories.user_id", "categories.id"]),
        UniqueConstraint("user_id", "id", name="uq_group_bill_user_id"),
        UniqueConstraint("user_id", "sync_seq", name="uq_group_bill_user_seq"),
        Index("ix_group_bill_user_seq", "user_id", "sync_seq"),
        Index("ix_group_bill_user_date", "user_id", "bill_date"),
    )


class Settlement(SyncedRecord, Base):
    __tablename__ = "settlements"
    group_bill_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    from_person_id: Mapped[str] = mapped_column(String(80), nullable=False)
    to_person_id: Mapped[str] = mapped_column(String(80), nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    paid_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    is_paid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("amount_paise > 0 AND paid_amount_paise >= 0 AND paid_amount_paise <= amount_paise", name="ck_settlement_amounts"),
        CheckConstraint("from_person_id <> to_person_id", name="ck_settlement_people_distinct"),
        ForeignKeyConstraint(["user_id", "group_bill_id"], ["group_bills.user_id", "group_bills.id"]),
        UniqueConstraint("user_id", "id", name="uq_settlement_user_id"),
        UniqueConstraint("user_id", "sync_seq", name="uq_settlement_user_seq"),
        Index("ix_settlement_user_seq", "user_id", "sync_seq"),
    )


class Attachment(SyncedRecord, Base):
    __tablename__ = "attachments"
    transaction_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    upload_status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")
    storage_key: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        CheckConstraint("size_bytes BETWEEN 0 AND 5242880", name="ck_attachment_size"),
        ForeignKeyConstraint(["user_id", "transaction_id"], ["transactions.user_id", "transactions.id"]),
        UniqueConstraint("user_id", "id", name="uq_attachment_user_id"),
        UniqueConstraint("user_id", "sync_seq", name="uq_attachment_user_seq"),
        Index("ix_attachment_user_seq", "user_id", "sync_seq"),
    )


class UserSettings(Base):
    __tablename__ = "user_settings"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    budget_start_day: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    ai_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    entry_parsing_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    categorization_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    split_drafting_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    budget_suggestions_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    summaries_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    __table_args__ = (CheckConstraint("budget_start_day BETWEEN 1 AND 28", name="ck_settings_budget_day"),)


class PlaceRule(SyncedRecord, Base):
    __tablename__ = "place_rules"
    place_pattern: Mapped[str] = mapped_column(String(200), nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    __table_args__ = (
        ForeignKeyConstraint(["user_id", "category_id"], ["categories.user_id", "categories.id"]),
        UniqueConstraint("user_id", "id", name="uq_place_rule_user_id"),
        UniqueConstraint("user_id", "sync_seq", name="uq_place_rule_user_seq"),
        Index("ix_place_rule_user_seq", "user_id", "sync_seq"),
    )


class SyncChange(Base):
    __tablename__ = "sync_changes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sync_seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    resource: Mapped[str] = mapped_column(String(32), nullable=False)
    record_id: Mapped[str] = mapped_column(String(80), nullable=False)
    operation: Mapped[str] = mapped_column(String(8), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (UniqueConstraint("user_id", "sync_seq", name="uq_sync_change_user_seq"), Index("ix_sync_change_user_seq", "user_id", "sync_seq"))


class AIUsage(Base):
    __tablename__ = "ai_usage"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(40), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    tokens_in: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    tokens_out: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    latency_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (Index("ix_ai_usage_user_created", "user_id", "created_at"), Index("ix_ai_usage_user_endpoint_created", "user_id", "endpoint", "created_at"))


class AuthActionToken(Base):
    __tablename__ = "auth_action_tokens"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("purpose IN ('verify_email','password_reset')", name="ck_auth_token_purpose"),
        Index("ix_auth_action_tokens_user_purpose", "user_id", "purpose"),
        Index("ix_auth_action_tokens_expires_at", "expires_at"),
    )


class RateLimitBucket(Base):
    __tablename__ = "rate_limit_buckets"
    bucket_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_start: Mapped[int] = mapped_column(BigInteger, nullable=False)
    request_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    __table_args__ = (Index("ix_rate_limit_buckets_window_start", "window_start"),)
