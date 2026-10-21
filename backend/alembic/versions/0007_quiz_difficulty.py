"""Quiz difficulty

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("study_sets", sa.Column("difficulty", sa.String(8), nullable=True))


def downgrade() -> None:
    op.drop_column("study_sets", "difficulty")
