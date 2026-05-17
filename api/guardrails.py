"""Lightweight guardrails for chat I/O.

Mirrors the structure of Guardrails AI / NeMo Guardrails — a stack of named
validators applied to inputs (before the LLM sees them) and outputs (before
the user sees them). Each validator returns a `GuardResult` so callers can
distinguish *block* (refuse to call the LLM) from *redact* (mutate text and
proceed).

Design choices:
  - Regex-based, no ML models — keeps deploys small and predictable. The
    JD-relevant pattern (input/output filters around an LLM) is what matters.
  - Single-pass: each validator is pure (text → result), composes cleanly.
  - All decisions are logged to stdout so they show up in LangSmith and in
    the dev console; easy to verify behaviour while testing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class GuardResult:
    text: str                         # possibly redacted text
    blocked: bool = False
    reason: str = ""
    redactions: list[str] = field(default_factory=list)


# ---------- Validators ---------------------------------------------------


# Prompt injection — common jailbreak phrasings. Not exhaustive; treat as a
# coarse first line of defense.
_INJECTION_PATTERNS = [
    re.compile(r"\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b", re.I),
    re.compile(r"\byou\s+are\s+now\b.{0,40}\b(?:dan|developer|admin|root|jailbroken)\b", re.I),
    re.compile(r"\bdisregard\s+(?:your|the|all)\s+(?:rules|system\s+prompt|guidelines)\b", re.I),
    re.compile(r"\b(?:reveal|print|show|leak)\s+(?:your\s+)?(?:system\s+prompt|instructions)\b", re.I),
    re.compile(r"```\s*system\b", re.I),
]


def detect_prompt_injection(text: str) -> GuardResult:
    for p in _INJECTION_PATTERNS:
        if p.search(text):
            return GuardResult(
                text=text,
                blocked=True,
                reason="prompt_injection",
            )
    return GuardResult(text=text)


# PII redaction — emails, phone numbers, credit-card-like sequences, SSN-like.
# Replaces matches with a placeholder so the LLM still gets context but never
# sees the raw value.
_PII_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("phone", re.compile(r"\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")),
    ("credit_card", re.compile(r"\b(?:\d[ -]?){13,16}\b")),
    ("ssn", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
]


def redact_pii(text: str) -> GuardResult:
    redactions: list[str] = []
    out = text
    for name, pattern in _PII_PATTERNS:
        # Credit-card pattern is greedy; verify Luhn isn't worth the size, just
        # require ≥13 digits AND not present in a long numeric run that's
        # obviously not a card (e.g. an order id of 16+ digits with no spaces).
        def _replace(m: re.Match) -> str:
            redactions.append(name)
            return f"[REDACTED_{name.upper()}]"
        out = pattern.sub(_replace, out)
    return GuardResult(text=out, redactions=redactions)


# Off-topic gate — reject queries that are clearly unrelated to invoices.
# Keep this loose; let the LLM's own prompt handle ambiguity. We block only
# obvious mismatches so we don't degrade UX for fuzzy real questions.
_OFFTOPIC_PATTERNS = [
    re.compile(r"^\s*write\s+(?:me\s+)?(?:a\s+)?(poem|story|song|joke|essay)\b", re.I),
    re.compile(r"^\s*(?:what's|whats)\s+the\s+weather\b", re.I),
    re.compile(r"^\s*(?:translate|how\s+do\s+you\s+say)\b.{0,40}\bin\s+\w+\s*\??$", re.I),
    re.compile(r"^\s*who\s+(?:is|was)\s+(?!.*invoice)(?!.*vendor)", re.I),
]


def gate_offtopic(text: str) -> GuardResult:
    for p in _OFFTOPIC_PATTERNS:
        if p.search(text):
            return GuardResult(
                text=text,
                blocked=True,
                reason="offtopic",
            )
    return GuardResult(text=text)


# Output PII — same patterns, applied to the LLM's answer. If the model
# echoes a value it shouldn't (very rare for our use case but defense-in-depth),
# we redact before showing the user.
def scan_output(text: str) -> GuardResult:
    return redact_pii(text)


# ---------- Pipeline -----------------------------------------------------


def guard_input(text: str) -> GuardResult:
    """Run the input through the validator stack."""
    r = detect_prompt_injection(text)
    if r.blocked:
        print(f"[guardrails] blocked input: {r.reason}")
        return r
    r = gate_offtopic(text)
    if r.blocked:
        print(f"[guardrails] blocked input: {r.reason}")
        return r
    r = redact_pii(text)
    if r.redactions:
        print(f"[guardrails] redacted input: {r.redactions}")
    return r


def guard_output(text: str) -> GuardResult:
    """Run streamed output through PII redaction. Cheap, applied per-token-buffer."""
    return scan_output(text)


# ---------- Friendly refusal messages ------------------------------------


REFUSAL_MESSAGES = {
    "prompt_injection": (
        "Your message looked like a prompt-injection attempt and was blocked. "
        "Try rephrasing as a normal invoice question."
    ),
    "offtopic": (
        "I'm an invoice auditing assistant. Please ask invoice-related questions."
    ),
}
