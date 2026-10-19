"""Security controls for untrusted source text and uploaded PDFs.

Documents are data, never instructions.  The scanner is deliberately deterministic:
it catches common prompt-injection and exfiltration patterns without another model call,
records explainable reasons, and quarantines only high-confidence combinations.
"""
import re
import unicodedata
from dataclasses import dataclass, field

import pymupdf

ZERO_WIDTH = re.compile("[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]")
INJECTION_RULES: tuple[tuple[str, re.Pattern[str], int], ...] = (
    ("instruction_override", re.compile(r"\b(ignore|disregard|forget)\b.{0,80}\b(previous|prior|system|developer)\b.{0,30}\b(instruction|prompt|message)s?\b", re.I | re.S), 5),
    ("role_impersonation", re.compile(r"(?:^|\n)\s*(system|developer|assistant)\s*:\s*", re.I), 4),
    ("prompt_exfiltration", re.compile(r"\b(reveal|print|repeat|show|extract)\b.{0,80}\b(system prompt|hidden instruction|developer message|api key|secret|token)\b", re.I | re.S), 5),
    ("tool_or_code_execution", re.compile(r"\b(call|invoke|use|run|execute)\b.{0,50}\b(tool|function|shell|command|powershell|terminal)\b", re.I | re.S), 3),
    ("data_exfiltration", re.compile(r"\b(send|upload|post|exfiltrate)\b.{0,80}\b(data|document|content|secret|credential)s?\b.{0,80}\b(http|url|server|webhook|email)\b", re.I | re.S), 5),
)

PII_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    # A leading '+' excludes the 12 digits made by an Indian +91 phone number.
    ("aadhaar", re.compile(r"(?<![+\d])(?:\d[ -]?){11}\d(?!\d)")),
    ("pan", re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b", re.I)),
    ("email", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)),
    ("phone", re.compile(r"(?<!\d)(?:\+?91[ -]?)?[6-9]\d{9}(?!\d)")),
)


class UnsafeSourceError(ValueError):
    """A safe, user-displayable upload rejection."""


class UnsafePDFError(UnsafeSourceError):
    """A PDF-specific upload rejection."""


@dataclass
class ScanResult:
    text: str
    risk_score: int = 0
    reasons: list[str] = field(default_factory=list)
    pii_counts: dict[str, int] = field(default_factory=dict)

    @property
    def quarantined(self) -> bool:
        return self.risk_score >= 5


def normalize_untrusted_text(text: str) -> tuple[str, bool]:
    """Normalize compatibility characters and remove invisible direction/control marks."""
    normalized = unicodedata.normalize("NFKC", text)
    cleaned, removed = ZERO_WIDTH.subn("", normalized)
    return cleaned, bool(removed)


def _mask_pii(text: str, redact: bool) -> tuple[str, dict[str, int]]:
    """Count (and with redact, mask) the PII in text."""
    counts: dict[str, int] = {}
    for name, pattern in PII_RULES:
        found = len(pattern.findall(text))
        if found:
            counts[name] = found
            if redact:
                text = pattern.sub(f"[REDACTED {name.upper()}]", text)
    return text, counts


def scan_text(text: str, *, redact_pii: bool = False) -> ScanResult:
    """Return normalized text, explainable injection risk, and optional PII masking."""
    cleaned, had_invisible = normalize_untrusted_text(text)
    reasons: list[str] = []
    score = 0
    if had_invisible:
        reasons.append("invisible_unicode")
        score += 2
    for name, pattern, weight in INJECTION_RULES:
        if pattern.search(cleaned):
            reasons.append(name)
            score += weight
    cleaned, counts = _mask_pii(cleaned, redact_pii)
    return ScanResult(cleaned, min(score, 10), reasons, counts)


def sanitize_pages(pages: list[dict], *, redact_pii: bool) -> tuple[list[dict], dict[str, int], bool]:
    """Normalize (and optionally PII-mask) every block before chunking.

    Doing this per block, before page text is assembled, keeps chunk offsets, stored
    viewer text and highlights in agreement. Returns (pages, pii_counts, had_invisible);
    blocks left empty are dropped, and pages left without blocks too."""
    counts: dict[str, int] = {}
    had_invisible = False
    cleaned_pages = []
    for page in pages:
        blocks = []
        for block in page["blocks"]:
            text, invisible = normalize_untrusted_text(block["text"])
            had_invisible |= invisible
            text, found = _mask_pii(text, redact_pii)
            for name, n in found.items():
                counts[name] = counts.get(name, 0) + n
            if text.strip():
                blocks.append({**block, "text": text.strip()})
        if blocks:
            cleaned_pages.append({**page, "blocks": blocks})
    return cleaned_pages, counts, had_invisible


def validate_pdf(data: bytes, *, max_pages: int) -> int:
    """Fully parse a PDF and reject encrypted, oversized, or active-content files."""
    try:
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            if doc.needs_pass:
                raise UnsafePDFError("Password-protected PDFs aren't supported. Remove the password and upload again.")
            if doc.page_count <= 0:
                raise UnsafePDFError("This PDF has no pages.")
            if doc.page_count > max_pages:
                raise UnsafePDFError(f"PDFs may contain at most {max_pages} pages.")
            if doc.embfile_names():
                raise UnsafePDFError("PDFs containing embedded files aren't accepted for safety.")
            for page in doc:
                for link in page.get_links():
                    if link.get("kind") in {pymupdf.LINK_LAUNCH, pymupdf.LINK_NAMED}:
                        raise UnsafePDFError("PDFs containing launch actions aren't accepted for safety.")
            # JavaScript actions are represented in the PDF object graph and may not
            # appear in page links. Inspect object source without executing anything.
            for xref in range(1, doc.xref_length()):
                obj = doc.xref_object(xref, compressed=True)
                if "/JavaScript" in obj or "/JS" in obj or "/Launch" in obj:
                    raise UnsafePDFError("PDFs containing scripts or launch actions aren't accepted for safety.")
            return doc.page_count
    except UnsafePDFError:
        raise
    except Exception as exc:
        raise UnsafePDFError("That file couldn't be safely parsed as a PDF.") from exc
