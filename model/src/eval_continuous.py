"""Feasibility experiment: recognising a phrase signed WITHOUT pauses (continuous signing).

The app's pause segmenter needs the learner to pause or lower the hand between signs; on the
"continuous" phrases (make_phrase_eval.py) it finds the right number of signs in <1% of them.
This tries the standard alternative, a sliding-window decoder, with the existing single-sign
model (no retraining):

  1. Every STRIDE frames, classify the windows that END at that frame, for several window
     lengths (a sign lasts ~10-24 frames at 15 fps). Each window goes through the normal
     preprocessing. Keep the most confident (sign, probability) over the lengths.
  2. Keep time steps with probability >= threshold.
  3. Consecutive time steps agreeing on the same sign form a run; a run of at least
     min_run steps is one recognised sign. Neighbouring runs of the same sign are merged.

Decoder settings are chosen on the VAL signers' phrases; the TEST phrases give the reported
numbers. The same decoder is also run on the paused and lowered phrases, to see whether it
could replace the pause segmenter.

Run from model/:  python src/eval_continuous.py [--model transformer_crop]
Output: artifacts/results/continuous_eval.json
"""
import argparse
import itertools
import json
import os
import time
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
import numpy as np
import tensorflow as tf

import preprocess as P

MODEL_DIR = Path(__file__).resolve().parent.parent
STRIDE = 2
ALL_LENGTHS = (10, 14, 18, 24)
STYLES = ("continuous", "paused", "lowered")


def to_arrays(frames):
    T = len(frames)
    hands = np.full((T, 2, 21, 3), np.nan, np.float32)
    pose = np.full((T, 25, 4), np.nan, np.float32)
    for t, f in enumerate(frames):
        for s in range(2):
            if f["hands"][s] is not None:
                hands[t, s] = f["hands"][s]
        if f["pose"] is not None:
            pose[t] = f["pose"]
    return hands, pose


def windows(hands, pose, width, height):
    """All candidate windows of one phrase: [(end_frame, length, features)]."""
    present = (~np.isnan(hands[:, :, P.WRIST, 0])).any(axis=1)
    out = []
    for end in range(min(ALL_LENGTHS), len(hands) + 1, STRIDE):
        for L in ALL_LENGTHS:
            if end - L < 0 or present[end - L:end].mean() < 0.6:
                continue
            x = P.preprocess_video(hands[end - L:end], pose[end - L:end], width, height)
            if x is not None:
                out.append((end, L, x))
    return out


def edit_distance(a, b):
    d = np.arange(len(b) + 1)
    for i in range(1, len(a) + 1):
        prev, d[0] = d.copy(), i
        for j in range(1, len(b) + 1):
            d[j] = min(prev[j] + 1, d[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
    return int(d[-1])


def decode(steps, labels, lengths, threshold, min_run, max_gap=1):
    """steps: {end: {L: probs}} -> list of recognised signs."""
    best = []
    for end in sorted(steps):
        cand = [steps[end][L] for L in lengths if L in steps[end]]
        if not cand:
            continue
        p = np.max(cand, axis=0)  # most confident length for each sign
        k = int(p.argmax())
        if p[k] >= threshold:
            best.append((end, k))
    runs = []  # [label, count, last_end]
    for end, k in best:
        if runs and runs[-1][0] == k and end - runs[-1][2] <= STRIDE * (max_gap + 1):
            runs[-1][1] += 1
            runs[-1][2] = end
        else:
            runs.append([k, 1, end])
    out = [labels[k] for k, n, _ in runs if n >= min_run]
    return [s for i, s in enumerate(out) if i == 0 or s != out[i - 1]]


def score(cases, steps_per_case, labels, lengths, threshold, min_run):
    edits = words = exact = right_n = 0
    for c, steps in zip(cases, steps_per_case):
        pred = decode(steps, labels, lengths, threshold, min_run)
        e = edit_distance(c["signs"], pred)
        edits += e
        words += len(c["signs"])
        exact += e == 0
        right_n += len(pred) == len(c["signs"])
    n = len(cases)
    return {"wer": round(edits / words, 3), "exact": round(exact / n, 3), "segmentation": round(right_n / n, 3)}


def window_probs(model, cases, style):
    """Classify every window of every phrase in one batch: [{end: {L: probs}}] per phrase."""
    per_case, batch, index = [], [], []
    for ci, c in enumerate(cases):
        hands, pose = to_arrays(c[style])
        for end, L, x in windows(hands, pose, c["width"], c["height"]):
            batch.append(x)
            index.append((ci, end, L))
        per_case.append({})
    t0 = time.time()
    probs = model.predict(np.stack(batch), batch_size=512, verbose=0)
    ms = (time.time() - t0) / len(batch) * 1000
    for (ci, end, L), p in zip(index, probs):
        per_case[ci].setdefault(end, {})[L] = p
    return per_case, len(batch), ms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="transformer_crop")
    args = ap.parse_args()
    model = tf.keras.models.load_model(MODEL_DIR / "artifacts" / "models" / f"{args.model}.keras")
    labels = json.loads((MODEL_DIR.parent / "app" / "public" / "models" / "labels.json").read_text())

    val = json.loads((P.OUT_DIR / "phrase_eval_val.json").read_text())
    test = json.loads((P.OUT_DIR / "phrase_eval.json").read_text())

    # 1. choose the decoder settings on val continuous phrases
    val_steps, n_windows, ms = window_probs(model, val, "continuous")
    print(f"val: {n_windows} windows, {ms:.2f} ms per window (batched, Python)")
    grid = []
    length_sets = [s for r in range(1, len(ALL_LENGTHS) + 1) for s in itertools.combinations(ALL_LENGTHS, r)]
    for lengths in length_sets:
        for threshold in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
            for min_run in (1, 2, 3, 4, 5):
                r = score(val, val_steps, labels, lengths, threshold, min_run)
                grid.append({"lengths": list(lengths), "threshold": threshold, "min_run": min_run, **r})
    grid.sort(key=lambda g: (g["wer"], -g["exact"]))
    chosen = grid[0]
    print("best on val:", chosen)
    print("runners-up:", grid[1:4])

    # 2. report on test, for every phrase style
    settings = (chosen["lengths"], chosen["threshold"], chosen["min_run"])
    results = {"model": args.model, "chosen_on_val": chosen, "test": {}}
    for style in STYLES:
        steps, _, _ = window_probs(model, test, style)
        results["test"][style] = score(test, steps, labels, *settings)
        print(f"test {style:10s} sliding window: {results['test'][style]}")

    out = MODEL_DIR / "artifacts" / "results" / "continuous_eval.json"
    out.write_text(json.dumps(results, indent=1))
    print("->", out)


if __name__ == "__main__":
    main()
