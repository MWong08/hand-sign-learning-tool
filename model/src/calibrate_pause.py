"""Calibrate the window-based pause rule of segmenter.js (2026-11-11).

The old rule ("every one of 7 frames moves less than STILL_WRIST / STILL_SHAPE") sat at the
tracking jitter floor, so a learner holding still almost never triggered it on a live webcam
(eval_pause_jitter.py). The new rule looks at the whole window at once: the hand is still if,
over the last N frames, it stays close to where it was on average (SPREAD), so random jitter,
which does not add up, no longer breaks the pause, while real movement does.

  wrist spread  max distance of the wrist from its window mean, in shoulder widths
  shape spread  max (over frames) mean joint distance from the window's mean hand shape,
                in hand sizes (joints taken relative to the wrist)

Two kinds of data:
  held  REAL held hands through the app's own browser pipeline (camera noise, and noise plus a
        ~1 px sway), recorded by app/scripts/measure_held_jitter.mjs
        -> data/processed/held_hands_browser.json. Want: pause detected quickly, with margin
        (also checked with the jitter doubled). Only the CALIBRATION half of the recordings is
        used here (held_part() == "calibration"); the other half is kept for the test phrases.
  signs REAL val-signer clips (PopSign, MediaPipe VIDEO mode). Want: no harmful split, i.e. a
        still window with real movement both before AND after it inside one sign (a hold at
        the end of a sign is a correct place to split).

Run from model/:  python src/calibrate_pause.py  -> artifacts/results/pause_calibration.json
"""
import json

import numpy as np

import preprocess as P

N_GRID = [7, 9, 11]  # PAUSE_FRAMES: window length (7 = ~0.47 s, 11 = ~0.73 s at 15 fps)
DETECT_BY = 15       # a held hand must be detected as paused within this many frames (1 s)
MIN_MOTION = 0.15  # segmenter.js: movement needed for a segment to count as a sign
SHAPE_WEIGHT = 0.25
WRIST_GRID = [0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05]
SHAPE_GRID = [0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1]
FALSE_SPLIT_BUDGET = 0.04  # the old rule's calibration allowed ~3.6% of real signs to split


def held_part(sign):
    """Recorded held hands are split by sign: alternate signs in alphabetical order are used for
    calibrating the pause rule (and val phrases), the rest only for the TEST phrases."""
    return "calibration" if sorted(ALL_SIGNS).index(sign) % 2 == 0 else "test"


ALL_SIGNS = [s["id"] for u in json.loads(P.VOCAB_FILE.read_text(encoding="utf-8"))["units"] for s in u["signs"]]


def pixels(h, p, width, height):
    scale = np.array([width, height])
    px = h[..., :2] * scale
    sw = np.linalg.norm(p[:, 11, :2] * scale - p[:, 12, :2] * scale, axis=-1)
    sw = np.where(np.isnan(sw) | (sw < 1), height / 3, sw)
    # pose is only every 3rd frame in the app and barely moves: use the clip median
    return px, float(np.nanmedian(sw)) if not np.isnan(sw).all() else height / 3


def spreads(px, sw, N):
    """Per window of N frames ending at t: (wrist spread, shape spread) of the hand that
    spread more, or NaN if no hand slot is present in all N frames."""
    T = len(px)
    out = np.full((T, 2), np.nan)
    for t in range(N - 1, T):
        best = None
        for s in range(2):
            w = px[t - N + 1:t + 1, s]
            if np.isnan(w[:, 0, 0]).any():
                continue
            wrist = w[:, 0]
            ws = np.max(np.linalg.norm(wrist - wrist.mean(0), axis=-1)) / sw
            size = np.median(np.linalg.norm(w[:, 9] - w[:, 0], axis=-1))
            rel = (w[:, 1:] - w[:, :1]) / max(size, 1e-6)
            ss = np.max(np.mean(np.linalg.norm(rel - rel.mean(0), axis=-1), axis=-1))
            if best is None or ws + SHAPE_WEIGHT * ss > best[0] + SHAPE_WEIGHT * best[1]:
                best = (ws, ss)
        if best:
            out[t] = best
    return out


def motion(px, sw):
    """Per-frame movement (wrist + SHAPE_WEIGHT * shape), as segmenter.js frameMotion."""
    T = len(px)
    m = np.zeros(T)
    for t in range(1, T):
        best = 0.0
        for s in range(2):
            a, b = px[t - 1, s], px[t, s]
            if np.isnan(a[0, 0]) or np.isnan(b[0, 0]):
                continue
            size = max(np.linalg.norm(b[9] - b[0]), 1e-6)
            w = np.linalg.norm(b[0] - a[0]) / sw
            sc = np.mean(np.linalg.norm((b[1:] - b[0]) - (a[1:] - a[0]), axis=-1)) / size
            best = max(best, w + SHAPE_WEIGHT * sc)
        m[t] = best
    return m


def main():
    vocab = json.loads(P.VOCAB_FILE.read_text(encoding="utf-8"))
    signs = [s["id"] for u in vocab["units"] for s in u["signs"]]

    clips = []  # (spreads, cumulative motion) per real sign, inside its active segment
    for sign in signs:
        with np.load(P.LANDMARK_DIR / "val" / f"{sign}.npz") as d:
            off, H, Po, W, Hh = d["offsets"], d["hands"].astype(np.float64), d["pose"].astype(np.float64), d["width"], d["height"]
        for i in range(len(off) - 1):
            h, p = H[off[i]:off[i + 1]], Po[off[i]:off[i + 1]]
            act = P.trim_to_active((~np.isnan(h[:, :, P.WRIST, 0])).any(axis=1))
            if act is None:
                continue
            h, p = h[act[0]:act[1]], p[act[0]:act[1]]
            px, sw = pixels(h, p, W[i], Hh[i])
            clips.append(({n: spreads(px, sw, n) for n in N_GRID}, np.cumsum(motion(px, sw))))

    held = json.loads((P.OUT_DIR / "held_hands_browser.json").read_text())
    holds = []  # (variant, spreads)
    for variant, recs in held.items():
        for r in recs:
            if held_part(r["sign"]) != "calibration":
                continue
            fr = r["frames"]
            h = np.array([[np.full((21, 3), np.nan) if x is None else np.array(x) for x in f["hands"]] for f in fr])
            p = np.array([np.full((25, 4), np.nan) if f["pose"] is None else np.array(f["pose"]) for f in fr])
            px, sw = pixels(h, p, r["width"], r["height"])
            holds.append((variant, r["sign"], {n: spreads(px, sw, n) for n in N_GRID}))

    grid = []
    for N in N_GRID:
      for tw in WRIST_GRID:
        for ts in SHAPE_GRID:
            still = lambda sp: (sp[:, 0] < tw) & (sp[:, 1] < ts)  # NaN compares False
            harmful = 0
            for spn, cm in clips:
                sp = spn[N]
                for t in np.flatnonzero(still(sp)):
                    before = cm[t - N + 1] if t - N + 1 >= 0 else 0
                    after = cm[-1] - cm[t]
                    if before >= MIN_MOTION and after >= MIN_MOTION:
                        harmful += 1
                        break
            # held: share of windows still, and frames until the first still window
            share = {v: float(np.mean([still(sp[N])[N - 1:].mean() for vv, _, sp in holds if vv == v])) for v in held}
            first = [int(np.argmax(still(sp[N]))) + 1 if still(sp[N]).any() else None for _, _, sp in holds]
            detected = float(np.mean([f is not None and f <= DETECT_BY for f in first]))
            # doubled jitter: spreads double, i.e. the same as halving the limits
            first2 = [((sp[N][:, 0] < tw / 2) & (sp[N][:, 1] < ts / 2)) for _, _, sp in holds]
            detected2 = float(np.mean([s.any() and int(np.argmax(s)) + 1 <= DETECT_BY for s in first2]))
            grid.append({"frames": N, "wrist": tw, "shape": ts, "false_split": round(harmful / len(clips), 4),
                         "held_detected_within_1s": round(detected, 3),
                         "held_detected_2x_jitter": round(detected2, 3),
                         "held_still_share": {k: round(v, 3) for k, v in share.items()}})

    ok = [g for g in grid if g["false_split"] <= FALSE_SPLIT_BUDGET]
    best = max(ok, key=lambda g: (g["held_detected_within_1s"], g["held_detected_2x_jitter"], -g["false_split"]))
    per_hold = []
    for v, sign, sp in holds:
        n = best["frames"]
        s = (sp[n][:, 0] < best["wrist"]) & (sp[n][:, 1] < best["shape"])
        per_hold.append({"variant": v, "sign": sign, "still_share": round(float(s[n - 1:].mean()), 2)})
    res = {"clips": len(clips), "holds": len(holds), "budget": FALSE_SPLIT_BUDGET, "chosen": best,
           "per_hold": per_hold, "grid": grid}
    out = P.MODEL_DIR / "artifacts" / "results" / "pause_calibration.json"
    out.write_text(json.dumps(res, indent=1))
    print(f"{len(clips)} real signs, {len(holds)} held recordings")
    for g in grid:
        print(f"N={g['frames']:<3} wrist<{g['wrist']:<6} shape<{g['shape']:<5} false split {g['false_split'] * 100:5.1f}%  "
              f"held detected {g['held_detected_within_1s'] * 100:5.1f}% (2x jitter {g['held_detected_2x_jitter'] * 100:5.1f}%)  still share {g['held_still_share']}")
    print("chosen:", best)


if __name__ == "__main__":
    main()
