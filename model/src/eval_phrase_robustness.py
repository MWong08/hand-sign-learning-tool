"""Experiment: does the classifier still work on signs cut out of a PHRASE?

Every PopSign clip shows one sign: the hand rises into view, signs, and drops out of view.
In a phrase (HELLO MY MOM) the hand usually stays up and pauses between signs, so each
segment the app cuts out:
  - is missing the raise at the start and the lowering at the end, and
  - ends with the hand held still for a moment (the pause that ended the segment).

This simulates that on the validation signers: inside each clip's active segment, drop the
first and last fraction of frames and append a short still hold (copies of the last frame),
then classify. Compares the current model with any other model given by --models.

Run from model/:  python src/eval_phrase_robustness.py [--models transformer transformer_crop]
Output: artifacts/results/phrase_robustness.json
"""
import argparse
import json
import os
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
import numpy as np
import tensorflow as tf

import preprocess as P

MODEL_DIR = Path(__file__).resolve().parent.parent
HOLD_FRAMES = 6  # ~0.4 s pause that ends a phrase segment

CONDITIONS = {
    # name: (fraction cut from the start, fraction cut from the end, add a still hold?)
    "full clip (as trained)": (0.0, 0.0, False),
    "cut 15% each end + hold": (0.15, 0.15, True),
    "cut 25% each end + hold": (0.25, 0.25, True),
    "cut 35% each end + hold": (0.35, 0.35, True),
}


def crop_sample(hands, pose, width, height, cut_start, cut_end, hold):
    """Like preprocess_video, but crops the active segment to simulate a phrase segment."""
    hands = hands.astype(np.float32)
    pose = pose.astype(np.float32)
    seg = P.trim_to_active((~np.isnan(hands[:, :, P.WRIST, 0])).any(axis=1))
    if seg is None:
        return None
    a, b = seg
    n = b - a
    a2, b2 = a + int(round(n * cut_start)), b - int(round(n * cut_end))
    if b2 - a2 < 4:
        return None
    hands, pose = hands[a2:b2], pose[a2:b2]
    if hold:
        # hold = the last frame where the hand was seen, repeated
        last = max(i for i in range(len(hands)) if not np.isnan(hands[i, :, P.WRIST, 0]).all()) \
            if (~np.isnan(hands[:, :, P.WRIST, 0])).any() else len(hands) - 1
        hands = np.concatenate([hands[:last + 1], np.repeat(hands[last:last + 1], HOLD_FRAMES, axis=0)])
        pose = np.concatenate([pose[:last + 1], np.repeat(pose[last:last + 1], HOLD_FRAMES, axis=0)])
    if np.isnan(pose[:, P.L_SHOULDER, 0]).all() or np.isnan(hands[:, :, P.WRIST, 0]).all():
        return None
    hand, pose = P.dominant_hand(hands, pose)
    out = P.resample(P.make_features(hand, pose, width, height))
    return out if np.isfinite(out).all() else None


def build(split, signs, cut_start, cut_end, hold):
    X, y = [], []
    for label, sign in enumerate(signs):
        with np.load(P.LANDMARK_DIR / split / f"{sign}.npz") as d:
            off, hands, pose, w, h = d["offsets"], d["hands"], d["pose"], d["width"], d["height"]
        for i in range(len(off) - 1):
            s = crop_sample(hands[off[i]:off[i + 1]], pose[off[i]:off[i + 1]], int(w[i]), int(h[i]),
                            cut_start, cut_end, hold)
            if s is not None:
                X.append(s)
                y.append(label)
    return np.stack(X), np.array(y)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=["transformer"])
    ap.add_argument("--split", default="val")
    args = ap.parse_args()

    signs = [str(s) for s in np.load(P.OUT_DIR / "dataset_val.npz")["signs"]]
    models = {m: tf.keras.models.load_model(MODEL_DIR / "artifacts" / "models" / f"{m}.keras") for m in args.models}
    results = {}
    for cond, (cs, ce, hold) in CONDITIONS.items():
        X, y = build(args.split, signs, cs, ce, hold)
        row = {}
        for name, model in models.items():
            probs = model.predict(X, verbose=0)
            top3 = np.argsort(-probs, axis=1)[:, :3]
            row[name] = {"top1": round(float((probs.argmax(1) == y).mean()), 4),
                         "top3": round(float(np.mean([t in p for t, p in zip(y, top3)])), 4)}
        results[cond] = row
        print(f"{cond:28s} " + "  ".join(f"{n}: top1 {r['top1']:.3f} top3 {r['top3']:.3f}" for n, r in row.items()))
    out = MODEL_DIR / "artifacts" / "results" / "phrase_robustness.json"
    out.write_text(json.dumps({"split": args.split, "hold_frames": HOLD_FRAMES, "results": results}, indent=1))


if __name__ == "__main__":
    main()
