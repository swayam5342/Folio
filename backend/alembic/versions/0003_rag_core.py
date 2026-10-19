"""Chunk metadata (sections, offsets), chunking strategy, answer confidence and retrieval trace

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chunks", sa.Column("section_title", sa.Text(), nullable=True))
    op.add_column("chunks", sa.Column("char_start", sa.Integer(), nullable=True))
    op.add_column("chunks", sa.Column("char_end", sa.Integer(), nullable=True))

    # Existing documents were chunked with the fixed window; null marks "indexed before v2".
    op.add_column("documents", sa.Column("chunk_strategy", sa.String(16), nullable=True))

    op.add_column("messages", sa.Column("confidence", sa.String(8), nullable=True))
    op.add_column("messages", sa.Column("abstained", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("messages", sa.Column("trace", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "trace")
    op.drop_column("messages", "abstained")
    op.drop_column("messages", "confidence")
    op.drop_column("documents", "chunk_strategy")
    op.drop_column("chunks", "char_end")
    op.drop_column("chunks", "char_start")
    op.drop_column("chunks", "section_title")
