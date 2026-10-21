"""Chat threads, saved notes and suggested questions per source

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("suggested_questions", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )

    op.create_table(
        "threads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_threads_notebook_id", "threads", ["notebook_id"])

    # Every notebook that already has messages gets one thread holding them.
    op.add_column("messages", sa.Column("thread_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute("""
        INSERT INTO threads (id, notebook_id, title, created_at, updated_at)
        SELECT gen_random_uuid(), notebook_id, 'Chat', min(created_at), max(created_at)
        FROM messages GROUP BY notebook_id
    """)
    op.execute("UPDATE messages m SET thread_id = t.id FROM threads t WHERE t.notebook_id = m.notebook_id")
    op.alter_column("messages", "thread_id", nullable=False)
    op.create_foreign_key("fk_messages_thread_id", "messages", "threads", ["thread_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_messages_thread_id", "messages", ["thread_id"])

    op.create_table(
        "notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sources", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_notes_notebook_id", "notes", ["notebook_id"])


def downgrade() -> None:
    op.drop_index("ix_notes_notebook_id", table_name="notes")
    op.drop_table("notes")
    op.drop_index("ix_messages_thread_id", table_name="messages")
    op.drop_constraint("fk_messages_thread_id", "messages", type_="foreignkey")
    op.drop_column("messages", "thread_id")
    op.drop_index("ix_threads_notebook_id", table_name="threads")
    op.drop_table("threads")
    op.drop_column("documents", "suggested_questions")
