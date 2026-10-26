"""Server-side PDF export of a job result: chord sheet + optional ASCII tabs."""
from __future__ import annotations

from io import BytesIO
from typing import Iterable

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

PART_LABELS = {
    "chords": "Chord sheet",
    "guitar": "Guitar tab",
    "bass": "Bass tab",
    "drums": "Drums",
}


def _safe(s: str) -> str:
    return "".join(c if ord(c) < 128 else "?" for c in str(s))


def _show_chord(name: str) -> str:
    return "N.C." if name == "N" else name


def _line_chunks(line: dict, chords: list[dict]) -> list[dict]:
    words = line.get("words") or []
    slots: list[list[dict]] = [[] for _ in words]
    for si, s in enumerate(chords):
        if s.get("chord") == "N" or not words:
            continue
        start, end = line["start"], line["end"]
        if s["start"] < start - 0.25 or s["start"] > end:
            continue
        if si > 0 and chords[si - 1].get("chord") == s.get("chord"):
            continue
        k = next((i for i, w in enumerate(words) if w["end"] > s["start"]), len(words) - 1)
        slots[k].append({"name": s["chord"]})
    if words and not slots[0]:
        carry = next((c for c in reversed(chords) if c["start"] <= line["start"] and c.get("chord") != "N"), None)
        if carry:
            slots[0].append({"name": carry["chord"], "carry": True})
    return [{"w": w, "chords": slots[i]} for i, w in enumerate(words)]


def _chord_sheet_lines(result: dict) -> list[str]:
    lines_out: list[str] = []
    lyrics = (result.get("lyrics") or {}).get("lines") or []
    chords = result.get("chords") or []
    cursor = 0.0
    for li, ln in enumerate(lyrics):
        gap = ln["start"] - cursor
        if li > 0 and (gap > 3 or ln.get("stanza")):
            lines_out.append("")
        if ln.get("section"):
            lines_out.append(f"[{ln['section']}]")
        chord_row, lyric_row = "", ""
        for c in _line_chunks(ln, chords):
            label = " ".join(_show_chord(x["name"]) for x in c["chords"])
            if label:
                if len(chord_row) > len(lyric_row):
                    lyric_row = lyric_row.ljust(len(chord_row))
                chord_row = chord_row.ljust(len(lyric_row)) + label + " "
            lyric_row += c["w"]["text"] + " "
        if chord_row.strip():
            lines_out.append(chord_row.rstrip())
        lines_out.append(lyric_row.rstrip())
        cursor = ln["end"]
    if not lyrics and chords:
        row = []
        for s in chords:
            if s.get("chord") == "N":
                continue
            row.append(_show_chord(s["chord"]))
            if len(row) >= 8:
                lines_out.append(" | ".join(row))
                row = []
        if row:
            lines_out.append(" | ".join(row))
    return lines_out


def _tab_lines(part: dict, label: str) -> list[str]:
    out = [label.upper()]
    tuning = part.get("tuning")
    if tuning:
        capo = f", capo {part['capo']}" if part.get("capo") else ""
        out[0] += f" ({tuning}{capo})"
    out.append("")
    names = part.get("string_names") or []
    measures = part.get("measures") or []
    if not names or not measures:
        out.append("(empty)")
        return out
    pad = " " * (len(names[0]) + 1)
    # Pack ~4 measures per printed row
    row: list[dict] = []
    width = 0
    rows: list[list[dict]] = []
    for m in measures:
        w = len(m["strings"][0]) if m.get("strings") else 0
        if row and width + w > 72:
            rows.append(row)
            row, width = [], 0
        row.append(m)
        width += w
    if row:
        rows.append(row)
    for pack in rows:
        out.append(pad + "".join(m.get("chords", "") for m in pack))
        for s, name in enumerate(names):
            out.append(name + "|" + "".join(m["strings"][s] for m in pack))
        out.append("")
    return out


def _confidence_legend(result: dict) -> list[str]:
    conf = result.get("confidence")
    if not conf:
        return []
    lines = ["Confidence (honest — lower means review/fix)"]
    overall = conf.get("overall")
    if overall is not None:
        lines.append(f"  Overall: {overall:.0%}")
    by_part = conf.get("by_part") or {}
    if by_part:
        parts = ", ".join(f"{k} {v:.0%}" for k, v in sorted(by_part.items()))
        lines.append(f"  Parts: {parts}")
    for sec in (conf.get("by_section") or [])[:12]:
        label = sec.get("label") or sec.get("id") or "?"
        score = sec.get("score")
        if score is None:
            continue
        mark = "needs review" if score < 0.55 else ("ok" if score >= 0.75 else "mixed")
        lines.append(f"  [{label}] {score:.0%} — {mark}")
    return lines


def build_pdf(title: str, result: dict, parts: Iterable[str] | None = None) -> bytes:
    """Return a PDF byte string for the requested parts (default chords+guitar)."""
    wanted = [p.strip().lower() for p in (parts or ["chords", "guitar"]) if p and p.strip()]
    if not wanted:
        wanted = ["chords", "guitar"]

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    width, height = letter
    left, right = 0.7 * inch, width - 0.7 * inch
    top, bottom = height - 0.6 * inch, 0.6 * inch
    y = top

    def new_page():
        nonlocal y
        c.showPage()
        y = top

    def ensure(need: float):
        nonlocal y
        if y - need < bottom:
            new_page()

    def draw_line(text: str, size: float = 9, bold: bool = False, gap: float = 11):
        nonlocal y
        ensure(gap)
        c.setFont("Courier-Bold" if bold else "Courier", size)
        c.drawString(left, y, _safe(text)[:110])
        y -= gap

    key = (result.get("key") or {}).get("name") or "?"
    tempo = result.get("tempo") or "?"
    tuning = result.get("tuning") or {}
    tune_s = tuning.get("name") or "Standard"
    if tuning.get("capo"):
        tune_s += f"  Capo {tuning['capo']}"

    c.setFont("Helvetica-Bold", 14)
    c.drawString(left, y, _safe(title)[:90])
    y -= 18
    c.setFont("Helvetica", 10)
    c.drawString(left, y, _safe(f"Key: {key}    Tempo: {tempo} BPM    Tuning: {tune_s}"))
    y -= 16
    conf_lines = _confidence_legend(result)
    if conf_lines:
        c.setFont("Helvetica-Oblique", 8)
        for line in conf_lines[:4]:
            ensure(10)
            c.drawString(left, y, _safe(line)[:110])
            y -= 10
        y -= 4

    part_map = result.get("parts") or {}
    for part in wanted:
        if part == "chords":
            ensure(24)
            draw_line("CHORD SHEET", size=11, bold=True, gap=14)
            for line in _chord_sheet_lines(result):
                draw_line(line or " ", size=9, gap=11)
            y -= 8
            continue
        tab = part_map.get(part)
        if not tab or not tab.get("note_count"):
            continue
        ensure(24)
        for line in _tab_lines(tab, PART_LABELS.get(part, part)):
            draw_line(line or " ", size=8, gap=10)
        y -= 6

    if conf_lines and len(conf_lines) > 4:
        ensure(40)
        draw_line("CONFIDENCE DETAIL", size=10, bold=True, gap=12)
        for line in conf_lines[4:]:
            draw_line(line, size=8, gap=10)

    c.save()
    return buf.getvalue()
