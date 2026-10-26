"""Honest per-part / per-section confidence from signals already in the result.

Scores are deliberately not calibrated probabilities — they flag what to trust
vs what to review. Never invents 100% certainty.
"""
from __future__ import annotations

from statistics import mean


def _clamp(x: float, lo: float = 0.05, hi: float = 0.95) -> float:
    return max(lo, min(hi, x))


def _round(x: float) -> float:
    return round(_clamp(x), 3)


def _sections_from_lyrics(result: dict) -> list[dict]:
    """Prefer lyric section/stanza spans; else pack measures into ~8-bar regions."""
    lines = (result.get("lyrics") or {}).get("lines") or []
    sections: list[dict] = []
    current = None
    for i, ln in enumerate(lines):
        label = ln.get("section")
        new_sec = bool(label) or (ln.get("stanza") and current is not None)
        if current is None:
            current = {
                "id": f"sec-{len(sections)}",
                "label": label or "Intro/verse",
                "start": ln["start"],
                "end": ln["end"],
                "line_idxs": [i],
            }
        elif new_sec:
            sections.append(current)
            current = {
                "id": f"sec-{len(sections)}",
                "label": label or f"Section {len(sections) + 1}",
                "start": ln["start"],
                "end": ln["end"],
                "line_idxs": [i],
            }
        else:
            current["end"] = ln["end"]
            current["line_idxs"].append(i)
            if label:
                current["label"] = label
    if current:
        sections.append(current)

    if sections:
        return sections

    measures = result.get("measures") or []
    beats = result.get("beats") or []
    duration = float(result.get("duration") or 0)
    if not measures or not beats:
        return [{"id": "sec-0", "label": "Full song", "start": 0.0, "end": duration, "line_idxs": []}]

    pack = 8
    for i in range(0, len(measures), pack):
        group = measures[i : i + pack]
        b0 = group[0]["beat"]
        b1 = group[-1]["beat"] + group[-1]["beats"]
        start = float(beats[min(b0, len(beats) - 1)])
        end = float(beats[min(b1, len(beats) - 1)]) if b1 < len(beats) else duration
        sections.append({
            "id": f"bars-{i}",
            "label": f"Bars {i + 1}–{i + len(group)}",
            "start": start,
            "end": end,
            "line_idxs": [],
        })
    return sections


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def _chord_score(result: dict, start: float, end: float) -> tuple[float, list[str]]:
    reasons = []
    segs = [s for s in result.get("chords") or [] if _overlap(s["start"], s["end"], start, end) > 0]
    if not segs:
        return 0.2, ["no chords in region"]
    scores = []
    for s in segs:
        if "confidence" in s:
            scores.append(float(s["confidence"]))
        elif s.get("chord") == "N":
            scores.append(0.35)
        else:
            scores.append(0.55)  # legacy results without per-segment scores
    avg = mean(scores)
    n_ratio = sum(_overlap(s["start"], s["end"], start, end) for s in segs if s.get("chord") == "N")
    span = max(end - start, 1e-3)
    if n_ratio / span > 0.35:
        reasons.append("large no-chord stretches")
        avg *= 0.85
    if avg < 0.55:
        reasons.append("low HMM posterior / template match")
    elif avg >= 0.75:
        reasons.append("strong chord posteriors")
    return _round(avg), reasons


def _lyric_score(result: dict, start: float, end: float, line_idxs: list[int]) -> tuple[float, list[str]]:
    lyrics = result.get("lyrics") or {}
    lines = lyrics.get("lines") or []
    reasons = []
    if not lines:
        return 0.15, ["no lyrics transcribed"]
    region = [lines[i] for i in line_idxs] if line_idxs else [
        ln for ln in lines if _overlap(ln["start"], ln["end"], start, end) > 0
    ]
    if not region:
        return 0.25, ["no lyric lines in region"]
    words = [w for ln in region for w in ln.get("words") or []]
    if not words:
        return 0.2, ["empty lyric lines"]
    # Timing sanity: positive durations, monotonic within line
    bad = 0
    for ln in region:
        prev = None
        for w in ln.get("words") or []:
            if w["end"] <= w["start"]:
                bad += 1
            if prev and w["start"] + 1e-3 < prev:
                bad += 1
            prev = w["end"]
    order = 1.0 - min(1.0, bad / max(len(words), 1))
    # Pasted+aligned lyrics are more trustworthy when reference exists
    if lyrics.get("text") and lyrics.get("reference"):
        ref_n = len(lyrics["reference"])
        coverage = min(1.0, len(words) / max(ref_n, 1))
        score = 0.45 + 0.35 * order + 0.15 * coverage
        reasons.append("user lyrics aligned to reference")
    else:
        # Automatic Whisper — cap honesty: never look "done"
        dens = len(words) / max(end - start, 0.5)
        dens_score = _clamp(dens / 3.0, 0.2, 0.7)
        score = 0.25 + 0.35 * order + 0.25 * dens_score
        reasons.append("automatic transcription — verify by ear")
    if bad:
        reasons.append(f"{bad} timing order issues")
    return _round(score), reasons


def _note_part_score(part: dict | None, notes: list[dict] | None = None) -> tuple[float, list[str]]:
    reasons = []
    if not part:
        return 0.1, ["part missing"]
    count = int(part.get("note_count") or 0)
    ghosts = int(part.get("ghost_filtered") or 0)
    total = count + ghosts
    if total == 0 and not notes:
        return 0.15, ["no notes detected"]
    kept_ratio = count / total if total else (1.0 if notes else 0.0)
    amps = [float(n.get("amp", 0.5)) for n in (notes or [])] or [0.5]
    amp_mean = mean(amps)
    score = 0.25 + 0.35 * kept_ratio + 0.25 * _clamp(amp_mean)
    if part.get("source_fallback"):
        score *= 0.75
        reasons.append(part.get("source_reason") or "stem fallback")
    if ghosts and total:
        reasons.append(f"{ghosts}/{total} notes filtered as ghosts")
    if count < 4:
        reasons.append("very sparse tab")
        score *= 0.85
    if kept_ratio >= 0.7 and not part.get("source_fallback"):
        reasons.append("most detections above ghost thresholds")
    return _round(score), reasons


def _drum_score(part: dict | None) -> tuple[float, list[str]]:
    reasons = []
    if not part:
        return 0.1, ["drums missing"]
    hits = part.get("hits") or []
    if not hits:
        return 0.2, ["no drum hits"]
    kinds = {k for _, k in hits}
    # Sparse kinds or crash-heavy grids are less trustworthy after false-positive work
    crash_n = sum(1 for _, k in hits if k == "crash")
    score = 0.4 + 0.1 * min(len(kinds), 4) / 4
    if crash_n > len(hits) * 0.25:
        score *= 0.7
        reasons.append("unusually many crashes — review")
    if len(hits) < 8:
        score *= 0.85
        reasons.append("sparse hit grid")
    else:
        reasons.append(f"{len(hits)} hits across {len(kinds)} voices")
    # Cap: onset heuristics are not a full drum transcription model
    score = min(score, 0.82)
    return _round(score), reasons


def compute(result: dict, notes_by_part: dict[str, list] | None = None) -> dict:
    """Attach-ready confidence object for result.json."""
    notes_by_part = notes_by_part or {}
    parts = result.get("parts") or {}
    sections = _sections_from_lyrics(result)

    by_part = {}
    part_reasons: dict[str, list[str]] = {}

    c_score, c_reasons = _chord_score(result, 0.0, float(result.get("duration") or 0))
    by_part["chords"] = c_score
    part_reasons["chords"] = c_reasons

    l_score, l_reasons = _lyric_score(result, 0.0, float(result.get("duration") or 0), [])
    by_part["lyrics"] = l_score
    part_reasons["lyrics"] = l_reasons

    for name in ("guitar", "bass"):
        if name in parts:
            s, rsn = _note_part_score(parts[name], notes_by_part.get(name))
            by_part[name] = s
            part_reasons[name] = rsn
    if "drums" in parts:
        s, rsn = _drum_score(parts["drums"])
        by_part["drums"] = s
        part_reasons["drums"] = rsn
    if "melody" in parts:
        mel_notes = [
            {"amp": n[3]} if isinstance(n, (list, tuple)) else n
            for n in (parts["melody"].get("notes") or [])
        ]
        s, rsn = _note_part_score(
            {"note_count": len(mel_notes), "ghost_filtered": 0}, mel_notes
        )
        by_part["melody"] = s
        part_reasons["melody"] = rsn or ["melody AMT — verify"]

    by_section = []
    for sec in sections:
        scores = []
        reasons: list[str] = []
        cs, cr = _chord_score(result, sec["start"], sec["end"])
        scores.append(cs)
        reasons.extend(f"chords: {x}" for x in cr[:1])
        ls, lr = _lyric_score(result, sec["start"], sec["end"], sec.get("line_idxs") or [])
        scores.append(ls)
        reasons.extend(f"lyrics: {x}" for x in lr[:1])
        # Weight section by available parts present song-wide
        for name in ("guitar", "bass", "drums"):
            if name in by_part:
                scores.append(by_part[name])
        sec_score = _round(mean(scores))
        by_section.append({
            "id": sec["id"],
            "label": sec["label"],
            "start": round(sec["start"], 3),
            "end": round(sec["end"], 3),
            "score": sec_score,
            "reasons": reasons[:6],
        })

    overall = _round(mean(by_part.values())) if by_part else 0.2
    return {
        "overall": overall,
        "by_part": by_part,
        "by_section": by_section,
        "part_reasons": part_reasons,
        "disclaimer": "Scores flag uncertainty from available signals; they are not accuracy guarantees.",
    }
