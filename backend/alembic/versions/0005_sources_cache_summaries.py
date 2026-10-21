"""Source kinds, per-source summaries, index timestamps and the answer cache

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("kind", sa.String(8), nullable=False, server_default="pdf"))
    op.add_column("documents", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("documents", sa.Column("summary_status", sa.String(16), nullable=True))
    op.add_column("documents", sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True))
    # Existing ready documents count as indexed when they were uploaded.
    op.execute("UPDATE documents SET indexed_at = created_at WHERE status = 'ready'")

    op.create_table(
        "answer_cache",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "notebook_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notebooks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("sources", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("confidence", sa.String(8), nullable=True),
        sa.Column("trace", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ux_answer_cache_notebook_key", "answer_cache", ["notebook_id", "key"], unique=True)


def downgrade() -> None:
    op.drop_index("ux_answer_cache_notebook_key", table_name="answer_cache")
    op.drop_table("answer_cache")
    op.drop_column("documents", "indexed_at")
    op.drop_column("documents", "summary_status")
    op.drop_column("documents", "summary")
    op.drop_column("documents", "kind")
