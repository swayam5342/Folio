"""Source security metadata and per-notebook PII masking

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notebooks", sa.Column("pii_redaction_enabled", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column("documents", sa.Column("risk_score", sa.Integer(), nullable=False, server_default="0"))
    op.add_column(
        "documents", sa.Column("risk_reasons", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb"))
    )
    op.add_column(
        "documents", sa.Column("pii_summary", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb"))
    )
    op.add_column("chunks", sa.Column("risk_score", sa.Integer(), nullable=False, server_default="0"))
    op.add_column(
        "chunks", sa.Column("risk_reasons", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb"))
    )
    op.add_column("chunks", sa.Column("quarantined", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_chunks_safe_document", "chunks", ["document_id"], postgresql_where=sa.text("NOT quarantined"))


def downgrade() -> None:
    op.drop_index("ix_chunks_safe_document", table_name="chunks")
    op.drop_column("chunks", "quarantined")
    op.drop_column("chunks", "risk_reasons")
    op.drop_column("chunks", "risk_score")
    op.drop_column("documents", "pii_summary")
    op.drop_column("documents", "risk_reasons")
    op.drop_column("documents", "risk_score")
    op.drop_column("notebooks", "pii_redaction_enabled")
