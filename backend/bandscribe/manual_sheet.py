"""Build a playable/editable result for user-authored (no-audio) sheets."""
from __future__ import annotations

import re

STANDARD = [40, 45, 50, 55, 59, 64]
SECTION_RE = re.compile(
    r"^(verse|chorus|bridge|intro|outro|pre-?chorus|hook|tag|interlude|solo|refrain)"
    r"(\s*\d+)?\s*:?\s*$",
    re.I,
)
WORD_DUR = 0.45
WORD_GAP = 0.08
LINE_GAP = 0.35
BLANK_GAP = 0.85


def _is_section(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if SECTION_RE.match(s):
        return True
    # Short ALL-CAPS labels like "VERSE 1"
    if len(s) <= 24 and s.isupper() and any(c.isalpha() for c in s):
        return True
    return False


def _section_label(line: str) -> str:
    s = line.strip().rstrip(":")
    if s.isupper():
        return s.title()
    return s


def build_manual_result(lyrics_text: str) -> dict:
    """Parse pasted lyrics into timed lines + a blank chord bed (no audio/stems)."""
    text = (lyrics_text or "").replace("\r\n", "\n").replace("\r", "\n")
    raw_lines = text.split("\n")
    t = 0.5
    lines: list[dict] = []
    pending_section: str | None = None
    after_blank = False

    for raw in raw_lines:
        s = raw.strip()
        if not s:
            t += BLANK_GAP
            after_blank = True
            continue
        if _is_section(s):
            pending_section = _section_label(s)
            continue
        words = []
        for w in s.split():
            start = round(t, 3)
            end = round(t + WORD_DUR, 3)
            words.append({"text": w, "start": start, "end": end})
            t = end + WORD_GAP
        if not words:
            continue
        line: dict = {
            "start": words[0]["start"],
            "end": words[-1]["end"],
            "words": words,
        }
        if pending_section:
            line["section"] = pending_section
            pending_section = None
        if after_blank and lines:
            line["stanza"] = True
        after_blank = False
        lines.append(line)
        t += LINE_GAP

    if not lines:
        # One editable placeholder line so the paper sheet isn't empty.
        lines = [{
            "start": 0.5,
            "end": 1.4,
            "words": [{"text": "…", "start": 0.5, "end": 1.4}],
        }]
        t = 2.0

    duration = max(8.0, round(t + 1.0, 3))
    beat = 0.5  # 120 BPM
    n_beats = max(8, int(duration / beat) + 1)
    beats = [round(i * beat, 3) for i in range(n_beats)]
    measures = [{"beat": i * 4, "beats": 4} for i in range(max(1, n_beats // 4))]

    return {
        "version": 2,
        "manual": True,
        "no_audio": True,
        "duration": duration,
        "device": "manual",
        "key": {"tonic": "C", "mode": "major", "name": "C major"},
        "tempo": 120.0,
        "beats": beats,
        "measures": measures,
        "tuning": {"name": "Standard", "strings": list(STANDARD), "capo": 0},
        "chords": [{"start": 0.0, "end": duration, "chord": "N"}],
        "lyrics": {
            "language": "en",
            "text": text.strip(),
            "reference": True,
            "lines": lines,
        },
        "parts": {},
        "stems": [],
    }
