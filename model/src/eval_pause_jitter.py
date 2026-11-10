"""Why do pauses between phrase signs not register on a live webcam? Measures, on REAL clips
(validation signers, MediaPipe VIDEO mode, so they carry real tracking jitter and real hand
tremor), how still the stillest moment of each clip is, using the app's own motion measure
(segmenter.js frameMotion), and compares it with the pause thresholds STILL_WRIST / STILL_SHAPE.

If even the stillest half second of most clips is above the thresholds, a learner holding
their hand up "still" will not trigger a pause either, which matches the user's report that
the hand had to leave the camera before the next sign started.

Run from model/:  python src/eval_pause_jitter.py  -> artifacts/results/pause_jitter.json
"""
import json

import numpy as np

import preprocess as P

STILL_WRIST, STILL_SHAPE, PAUSE_FRAMES = 0.01, 0.02, 7  # segmenter.js (before this change)
SHAPE_WEIGHT = 0.25


def frame_motion(h, p, width, height):
    """Per-frame wrist speed (shoulder widths) and hand-shape change (hand sizes), as in
    segmenter.js frameMotion: the hand that moved more. NaN where no hand in both frames."""
    T = len(h)
    px = h[..., :2] * np.array([width, height])
    sh = p[:, 11, :2] * np.array([width, height]) - p[:, 12, :2] * np.array([width, height])
    sw = np.linalg.norm(sh, axis=-1)
    sw = np.where(np.isnan(sw) | (sw < 1), height / 3, sw)
    wrist = np.full(T, np.nan)
    shape = np.full(T, np.nan)
    for t in range(1, T):
        best = None
        for s in range(2):
            a, b = px[t - 1, s], px[t, s]
            if np.isnan(a[0, 0]) or np.isnan(b[0, 0]):
                continue
            size = max(np.linalg.norm(b[9] - b[0]), 1e-6)
            w = np.linalg.norm(b[0] - a[0]) / sw[t]
            sc = np.mean(np.linalg.norm((b[1:] - b[0]) - (a[1:] - a[0]), axis=-1)) / size
            if best is None or w + SHAPE_WEIGHT * sc > best[0] + SHAPE_WEIGHT * best[1]:
                best = (w, sc)
        if best:
            wrist[t], shape[t] = best
    return wrist, shape


def window_max(x, n):
    """Max over every n-frame window (NaN windows skipped)."""
    out = [np.max(x[i:i + n]) for i in range(len(x) - n + 1) if not np.isnan(x[i:i + n]).any()]
    return np.array(out)


def main():
    vocab = json.loads(P.VOCAB_FILE.read_text(encoding="utf-8"))
    signs = [s["id"] for u in vocab["units"] for s in u["signs"]]
    all_w, all_s, still_w, still_s, still_w_avg, still_s_avg = [], [], [], [], [], []
    for sign in signs:
        with np.load(P.LANDMARK_DIR / "val" / f"{sign}.npz") as d:
            off, H, Po, W, Hh = d["offsets"], d["hands"].astype(np.float64), d["pose"].astype(np.float64), d["width"], d["height"]
        for i in range(len(off) - 1):
            w, s = frame_motion(H[off[i]:off[i + 1]], Po[off[i]:off[i + 1]], W[i], Hh[i])
            ok = ~np.isnan(w)
            all_w += w[ok].tolist()
            all_s += s[ok].tolist()
            mw, ms = window_max(w, PAUSE_FRAMES), window_max(s, PAUSE_FRAMES)
            if len(mw) == 0:
                continue
            # stillest window = the one whose worst frame is lowest (both criteria at once)
            k = int(np.argmin(np.maximum(mw / STILL_WRIST, ms / STILL_SHAPE)))
            still_w.append(mw[k])
            still_s.append(ms[k])
            # the same with a 3-frame moving average first (smoothing jitter)
            sm = lambda x: np.convolve(x, np.ones(3) / 3, mode="valid")
            aw, as_ = window_max(sm(w), PAUSE_FRAMES), window_max(sm(s), PAUSE_FRAMES)
            if len(aw):
                k = int(np.argmin(np.maximum(aw / STILL_WRIST, as_ / STILL_SHAPE)))
                still_w_avg.append(aw[k])
                still_s_avg.append(as_[k])

    still_w, still_s = np.array(still_w), np.array(still_s)
    pct = lambda x: {q: round(float(np.percentile(x, q)), 4) for q in (10, 25, 50, 75, 90)}
    res = {
        "clips": len(still_w),
        "all_frames": {"wrist": pct(all_w), "shape": pct(all_s)},
        "stillest_window": {"wrist": pct(still_w), "shape": pct(still_s)},
        "clips_with_a_pause_under_current_thresholds":
            round(float(np.mean((still_w < STILL_WRIST) & (still_s < STILL_SHAPE))), 3),
        "share_failing_on_wrist": round(float(np.mean(still_w >= STILL_WRIST)), 3),
        "share_failing_on_shape": round(float(np.mean(still_s >= STILL_SHAPE)), 3),
    }
    out = P.MODEL_DIR / "artifacts" / "results" / "pause_jitter.json"
    out.write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
