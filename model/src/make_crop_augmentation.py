"""Phrase-style augmentation for training: one randomly cropped copy of every TRAIN clip.

Signs cut out of a phrase lack the raise/lowering of the hand and end in a still hold
(see eval_phrase_robustness.py, where accuracy fell from 91% to 81% when 35% was cut from
each end). Training on cropped copies as well as full clips teaches the model to recognise
the sign itself rather than relying on the raise and lowering.

Each copy: cut a random 0-35% from each end of the active segment; with probability 0.5 also
append a still hold. Only the train split is augmented; val and test stay as they are.

Run from model/:  python src/make_crop_augmentation.py  -> data/processed/dataset_train_crop.npz
Then:             python src/train.py --models transformer --augment-crop
"""
import json

import numpy as np

import preprocess as P
from eval_phrase_robustness import crop_sample

MAX_CUT = 0.35
SEED = 7


def main():
    rng = np.random.default_rng(SEED)
    vocab = json.loads(P.VOCAB_FILE.read_text(encoding="utf-8"))
    signs = [s["id"] for unit in vocab["units"] for s in unit["signs"]]
    X, y, signers = [], [], []
    for label, sign in enumerate(signs):
        with np.load(P.LANDMARK_DIR / "train" / f"{sign}.npz") as d:
            off, hands, pose, w, h, who = d["offsets"], d["hands"], d["pose"], d["width"], d["height"], d["signers"]
        for i in range(len(off) - 1):
            s = crop_sample(hands[off[i]:off[i + 1]], pose[off[i]:off[i + 1]], int(w[i]), int(h[i]),
                            rng.uniform(0, MAX_CUT), rng.uniform(0, MAX_CUT), rng.random() < 0.5)
            if s is not None:
                X.append(s)
                y.append(label)
                signers.append(who[i])
    np.savez_compressed(P.OUT_DIR / "dataset_train_crop.npz", X=np.stack(X).astype(np.float32),
                        y=np.array(y, dtype=np.int64), signers=np.array(signers), signs=np.array(signs))
    print(f"train_crop: {len(X)} augmented samples")


if __name__ == "__main__":
    main()
