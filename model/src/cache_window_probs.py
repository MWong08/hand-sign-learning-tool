"""Speed-up for app/scripts/eval_phrase_tracker.mjs: the model's probabilities for EVERY
sliding window of every evaluation phrase, computed once here with native TensorFlow.
(The JS evaluation re-runs the tracker for ~30 settings; pure-JS TensorFlow takes ~42 ms per
window and the phrases have ~120,000 windows, so classifying them in JS took hours.)

Same preprocessing (preprocess.py, parity-tested against the app's preprocess.js) and the same
deployed model (transformer_crop; its TF.js export gave the same top-1 on 32/32 checks).

Frames are numbered exactly as the JS script numbers them: cases in order, then styles
(lowered, paused, held, continuous), then frames. Window (first frame id, length L) is stored at
probs[id, LENGTHS.index(L)]; NaN where the window crosses a phrase boundary or can't be
preprocessed.

Run from model/:  python src/cache_window_probs.py val|test  -> data/processed/window_probs_{split}.npy
"""
import json
import sys

import numpy as np
import tensorflow as tf

import preprocess as P

LENGTHS = [10, 14, 18, 24]  # app/src/lib/fluent.js FLUENT.lengths
STYLES = ["lowered", "paused", "held", "continuous"]
MODEL = "transformer_crop"


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


def main():
    split = sys.argv[1] if len(sys.argv) > 1 else "val"
    name = "phrase_eval.json" if split == "test" else f"phrase_eval_{split}.json"
    cases = json.loads((P.OUT_DIR / name).read_text())
    styles = [s for s in STYLES if s in cases[0]]
    model = tf.keras.models.load_model(P.MODEL_DIR / "artifacts" / "models" / f"{MODEL}.keras")

    total = sum(len(c[s]) for c in cases for s in styles)
    probs = np.full((total, len(LENGTHS), 50), np.nan, np.float32)
    batch_x, batch_at = [], []

    def flush():
        if batch_x:
            out = model.predict(np.stack(batch_x), batch_size=512, verbose=0)
            for (i, k), p in zip(batch_at, out):
                probs[i, k] = p
            batch_x.clear()
            batch_at.clear()

    first = 0
    for c in cases:
        for s in styles:
            hands, pose = to_arrays(c[s])
            T = len(hands)
            for start in range(T):
                for k, L in enumerate(LENGTHS):
                    if start + L > T:
                        continue
                    x = P.preprocess_video(hands[start:start + L], pose[start:start + L], c["width"], c["height"])
                    if x is not None:
                        batch_x.append(x)
                        batch_at.append((first + start, k))
            first += T
            if len(batch_x) > 20000:
                flush()
    flush()
    out = P.OUT_DIR / f"window_probs_{split}.npy"
    np.save(out, probs)
    print(f"{split}: {total} frames, {int((~np.isnan(probs[:, :, 0])).sum())} windows -> {out}")


if __name__ == "__main__":
    main()
