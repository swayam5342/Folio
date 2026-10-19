"""Latest evaluation results, for the read-only Evaluation page.

The file is written by `python -m eval.run_eval` (backend/eval/results/latest.json)
and describes the sample corpus only, so it is public like /api/features.
"""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import settings

router = APIRouter()

DEFAULT_RESULTS = Path(__file__).resolve().parents[2] / "eval" / "results" / "latest.json"


def results_path() -> Path:
    return Path(settings.EVAL_RESULTS_PATH) if settings.EVAL_RESULTS_PATH else DEFAULT_RESULTS


@router.get("/eval/results")
async def eval_results() -> dict:
    """Summary of the latest run: per-configuration metrics, without per-question rows."""
    path = results_path()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="No evaluation results yet. Run `python -m eval.run_eval`.")
    try:
        results = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="The evaluation results file is unreadable.") from exc
    results["configs"] = [
        {k: v for k, v in config.items() if k not in ("items", "answer_items")} for config in results.get("configs", [])
    ]
    return results
