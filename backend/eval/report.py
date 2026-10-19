"""Turns evaluation results into a Markdown report and a chart (SVG + PNG).

The chart is small multiples: one panel per metric, one horizontal bar per
configuration, in a single hue with the value printed at the end of each bar.
It is written as SVG by hand and rasterised with PyMuPDF, so no plotting
library is needed.
"""
from html import escape
from pathlib import Path

import pymupdf

# Light-theme tokens from frontend/src/styles/tokens.css.
INK, MUTED, LINE, SURFACE, BAR = "#16131f", "#4f4b5c", "#ddd8cc", "#fffdf9", "#6d28d9"

PANELS = (("hit@1", "Hit@1"), ("hit@3", "Hit@3"), ("mrr", "MRR"))


def pct(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.0f}%"


def num(value: float | None, digits: int = 3) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def ms(value: float | None) -> str:
    return "—" if value is None else f"{value:,.0f}"


def render_svg(configs: list[dict]) -> str:
    """Small-multiple horizontal bar chart of the PANELS metrics per configuration."""
    label_w, panel_w, gap, bar_h, row_h, top, pad = 250, 190, 24, 14, 26, 84, 16
    width = pad + label_w + len(PANELS) * (panel_w + gap) - gap + pad
    height = top + len(configs) * row_h + 34
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        f'font-family="Helvetica">',  # MuPDF reads one family name, not a list
        f'<rect width="{width}" height="{height}" fill="{SURFACE}"/>',
        f'<text x="{pad}" y="24" font-size="15" font-weight="bold" fill="{INK}">Retrieval quality by configuration</text>',
        f'<text x="{pad}" y="42" font-size="11" fill="{MUTED}">Each step adds one stage to the one above it. '
        f"Answerable questions only; higher is better.</text>",
    ]
    for i, c in enumerate(configs):
        y = top + i * row_h
        out.append(f'<text x="{pad}" y="{y + bar_h - 2}" font-size="12" fill="{INK}">{escape(c["label"])}</text>')
    for p, (key, title) in enumerate(PANELS):
        x0 = pad + label_w + p * (panel_w + gap)
        out.append(f'<text x="{x0}" y="{top - 8}" font-size="12" font-weight="bold" fill="{INK}">{title}</text>')
        out.append(f'<line x1="{x0}" y1="{top - 2}" x2="{x0}" y2="{top + len(configs) * row_h - 8}" stroke="{LINE}"/>')
        scale = panel_w - 44  # room for the value label
        for i, c in enumerate(configs):
            value = c["retrieval"][key] or 0.0
            y = top + i * row_h
            w = max(value * scale, 1.0)
            r = min(4.0, w / 2)
            # Flat at the baseline, 4px rounded at the data end.
            out.append(
                f'<path d="M{x0},{y} h{w - r:.1f} a{r},{r} 0 0 1 {r},{r} v{bar_h - 2 * r} '
                f'a{r},{r} 0 0 1 -{r},{r} h-{w - r:.1f} z" fill="{BAR}"/>'
            )
            label = pct(value) if key.startswith("hit") else f"{value:.2f}"
            out.append(f'<text x="{x0 + w + 6:.1f}" y="{y + bar_h - 2}" font-size="11" fill="{INK}">{label}</text>')
    out.append(
        f'<text x="{pad}" y="{height - 12}" font-size="10" fill="{MUTED}">'
        f"Hit@k: a gold page is among the top k passages. MRR: mean of 1 / rank of the first gold passage.</text>"
    )
    out.append("</svg>")
    # MuPDF does not inherit font-family from <svg>, so every text element names it.
    return "\n".join(out).replace("<text ", '<text font-family="Helvetica" ')


def write_chart(configs: list[dict], out_dir: Path) -> None:
    svg = render_svg(configs)
    (out_dir / "chart.svg").write_text(svg, encoding="utf-8")
    with pymupdf.open(stream=svg.encode(), filetype="svg") as doc:
        doc[0].get_pixmap(dpi=144).save(out_dir / "chart.png")


def render_markdown(results: dict) -> str:
    configs = results["configs"]
    ds = results["dataset"]
    lines = [
        "# Folio retrieval evaluation",
        "",
        f"Generated {results['generated_at']} by `python -m eval.run_eval`"
        + (" in **smoke mode** (no LLM stages, subset of questions)." if results["mode"] == "smoke" else "."),
        "",
        f"Dataset: {ds['questions']} questions over {len(ds['documents'])} sample PDFs in `docs/samples/` "
        f"({ds['answerable']} answerable, {ds['unanswerable']} unanswerable). "
        f"Models: embeddings `{results['settings']['EMBEDDING_MODEL']}`, reranker `{results['settings']['RERANKER_MODEL']}`, "
        f"LLM `{results['settings']['GROQ_MODEL']}`. Top {results['settings']['TOP_K']} passages reach the model.",
        "",
        "![Retrieval quality by configuration](chart.png)",
        "",
        "## Retrieval",
        "",
        "| Configuration | Hit@1 | Hit@3 | Hit@6 | MRR | Refused unanswerable | Refused answerable | Retrieval ms (median) |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for c in configs:
        r = c["retrieval"]
        lines.append(
            f"| {c['label']} | {pct(r['hit@1'])} | {pct(r['hit@3'])} | {pct(r['hit@6'])} | {num(r['mrr'])} | "
            f"{pct(r['abstain_unanswerable'])} | {pct(r['false_abstain'])} | {ms(c['latency_ms'].get('retrieval_median'))} |"
        )
    if len(configs) > 1:
        first, last = configs[0]["retrieval"], configs[-1]["retrieval"]
        lines += [
            "",
            f"From **{configs[0]['label']}** to **{configs[-1]['label']}**: Hit@1 {pct(first['hit@1'])} → "
            f"{pct(last['hit@1'])}, Hit@3 {pct(first['hit@3'])} → {pct(last['hit@3'])}, "
            f"MRR {num(first['mrr'])} → {num(last['mrr'])}.",
        ]

    types = sorted({t for c in configs for t in c["retrieval"]["by_type"]})
    lines += ["", "### Hit@3 by question type", "", "| Configuration | " + " | ".join(
        f"{t} (n={configs[0]['retrieval']['by_type'].get(t, {}).get('n', 0)})" for t in types) + " |",
        "|---|" + "---:|" * len(types)]
    for c in configs:
        by = c["retrieval"]["by_type"]
        lines.append(f"| {c['label']} | " + " | ".join(pct(by.get(t, {}).get("hit@3")) for t in types) + " |")

    stages = [s for s in ("plan", "embed", "search", "rerank", "generate") if any(s in c["latency_ms"] for c in configs)]
    lines += ["", "### Mean latency per stage (ms)", "", "| Configuration | " + " | ".join(stages) + " |",
              "|---|" + "---:|" * len(stages)]
    for c in configs:
        lines.append(f"| {c['label']} | " + " | ".join(ms(c["latency_ms"].get(s)) for s in stages) + " |")
    lines += ["", "Plan is a Groq call; its time is measured on uncached calls. Embed, search and rerank run "
              "locally on CPU."]

    answered = [c for c in configs if c.get("answers")]
    if answered:
        lines += ["", "## Answers", "",
                  f"Judged by `{results['settings'].get('JUDGE_MODEL')}` against the excerpts each answer was given.", "",
                  "| Configuration | Citation precision | Answers with citations | Faithfulness | Key-fact recall | "
                  "Unanswerable handled |", "|---|---:|---:|---:|---:|---:|"]
        for c in answered:
            a = c["answers"]
            lines.append(
                f"| {c['label']} | {pct(a['citation_precision'])} | {pct(a['cited_answers'])} | {pct(a['faithfulness'])} | "
                f"{pct(a['key_fact_recall'])} | {pct(a['unanswerable_handled'])} |"
            )
        lines += ["", "Citation precision: cited pages that are gold pages. Faithfulness: claims supported by the "
                  "cited excerpts. Unanswerable handled: refused by the confidence gate or declined by the model."]
        for c in answered:
            if c["answers"].get("failed"):
                lines.append(f"{c['answers']['failed']} answer(s) for {c['label']} could not be generated or judged "
                             "(LLM calls failed after retries) and are excluded.")

    lines += [
        "",
        "## Notes",
        "",
        "- Small, purpose-written corpus: differences of one or two questions move a percentage by 2–3 points, "
        "so read the trends rather than the decimals.",
        "- Gold labels are pages, so a passage counts as a hit if it comes from a gold page.",
        "- The answer judge is a smaller LLM and errs strict (it sometimes marks a fully supported claim as "
        "unsupported); every graded answer is in `backend/eval/results/latest.json` for spot checks.",
        "- Latency depends heavily on the machine: embedding, search and reranking run on the local CPU, and "
        "reranking 30 passages is the most expensive local step. Lower `RETRIEVE_K` to trade recall for speed.",
        "- The query planner's output is cached within a run, so configurations after the first one that "
        "uses it reuse its rewrites and paraphrases.",
        f"- Planner errors (after retries): {', '.join(f'{c['name']}: {c['planner_errors']}' for c in configs)}.",
        "",
    ]
    return "\n".join(lines)
