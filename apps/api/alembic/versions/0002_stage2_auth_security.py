"""Add Stage 2 auth action tokens, rate limits, and session versioning."""

import uuid

import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.types import Uuid

from alembic import op

revision = "0002_stage2_auth_security"
down_revision = "0001_stage1_core"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "token_version" not in user_columns:
        op.add_column(
            "users",
            sa.Column("token_version", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        )

    refresh_columns = {column["name"] for column in inspector.get_columns("refresh_sessions")}
    if "family_id" not in refresh_columns:
        op.add_column("refresh_sessions", sa.Column("family_id", Uuid(), nullable=True))
        rows = bind.execute(sa.text("SELECT id FROM refresh_sessions")).all()
        for (session_id,) in rows:
            bind.execute(
                sa.text("UPDATE refresh_sessions SET family_id=:family WHERE id=:id"),
                {"family": str(uuid.uuid4()), "id": session_id},
            )
        with op.batch_alter_table("refresh_sessions") as batch:
            batch.alter_column("family_id", existing_type=Uuid(), nullable=False)
    refresh_indexes = {index["name"] for index in inspect(bind).get_indexes("refresh_sessions")}
    if "ix_refresh_sessions_family_id" not in refresh_indexes:
        op.create_index("ix_refresh_sessions_family_id", "refresh_sessions", ["family_id"])

    tables = set(inspect(bind).get_table_names())
    metadata = sa.MetaData()
    if "auth_action_tokens" not in tables:
        sa.Table("users", metadata, sa.Column("id", Uuid(), primary_key=True))
        sa.Table(
            "auth_action_tokens",
            metadata,
            sa.Column("id", Uuid(), primary_key=True),
            sa.Column("user_id", Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("purpose", sa.String(32), nullable=False),
            sa.Column("token_hash", sa.LargeBinary(), nullable=False, unique=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True)),
            sa.CheckConstraint(
                "purpose IN ('verify_email','password_reset')", name="ck_auth_token_purpose"
            ),
            sa.Index("ix_auth_action_tokens_user_purpose", "user_id", "purpose"),
            sa.Index("ix_auth_action_tokens_expires_at", "expires_at"),
        )
        metadata.create_all(bind, tables=[metadata.tables["auth_action_tokens"]])
    if "rate_limit_buckets" not in tables:
        sa.Table(
            "rate_limit_buckets",
            metadata,
            sa.Column("bucket_key", sa.String(64), primary_key=True),
            sa.Column("window_start", sa.BigInteger(), nullable=False),
            sa.Column("request_count", sa.BigInteger(), nullable=False),
            sa.Index("ix_rate_limit_buckets_window_start", "window_start"),
        )
        metadata.create_all(bind, tables=[metadata.tables["rate_limit_buckets"]])


def downgrade() -> None:
    op.drop_table("rate_limit_buckets")
    op.drop_table("auth_action_tokens")
    op.drop_index("ix_refresh_sessions_family_id", table_name="refresh_sessions")
    with op.batch_alter_table("refresh_sessions") as batch:
        batch.drop_column("family_id")
    op.drop_column("users", "token_version")
