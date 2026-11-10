"""Data-quality report for the extracted landmarks (CRISP-DM: Data Understanding).

For every sign and split it reports:
  videos      number of sequences
  signers     number of distinct signers
  frames_med  median frames per video (at the extracted fps, ~15)
  hand_cov    mean share of frames in which at least one hand was detected
  no_hand     videos where no hand was ever detected (unusable for training)
  left_share  share of hand detections MediaPipe labelled "Left" (how often each hand signs)
  pose_cov    mean share of frames with a detected pose

Writes data/processed/quality_report.csv and prints per-split totals.
Run from model/:  python src/check_landmarks.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

MODEL_DIR = Path(__file__).resolve().parent.parent
LANDMARK_DIR = MODEL_DIR / "data" / "processed" / "landmarks"
REPORT = MODEL_DIR / "data" / "processed" / "quality_report.csv"


def summarise(path):
    d = np.load(path)
    off, hands, pose = d["offsets"], d["hands"], d["pose"]
    # per frame: is each hand slot present? (a slot is NaN when that hand wasn't detected)
    slot_present = ~np.isnan(hands[:, :, 0, 0])            # (frames, 2)
    any_hand = slot_present.any(axis=1)                      # (frames,)
    pose_present = ~np.isnan(pose[:, 0, 0])                  # (frames,)

    lengths, hand_cov, pose_cov, no_hand = [], [], [], 0
    for i in range(len(off) - 1):
        a, b = off[i], off[i + 1]
        lengths.append(b - a)
        hand_cov.append(any_hand[a:b].mean())
        pose_cov.append(pose_present[a:b].mean())
        no_hand += not any_hand[a:b].any()

    detections = slot_present.sum(axis=0)                    # [left count, right count]
    return {
        "videos": len(lengths),
        "signers": len(set(d["signers"])),
        "frames_med": int(np.median(lengths)),
        "hand_cov": round(float(np.mean(hand_cov)), 3),
        "no_hand": no_hand,
        "left_share": round(float(detections[0] / max(detections.sum(), 1)), 3),
        "pose_cov": round(float(np.mean(pose_cov)), 3),
    }


def main():
    rows = []
    for path in sorted(LANDMARK_DIR.glob("*/*.npz")):
        rows.append({"split": path.parent.name, "sign": path.stem, **summarise(path)})
    df = pd.DataFrame(rows).sort_values(["split", "sign"])
    df.to_csv(REPORT, index=False)

    pd.set_option("display.width", 120)
    print(df.groupby("split").agg(signs=("sign", "count"), videos=("videos", "sum"),
                                  frames_med=("frames_med", "median"), hand_cov=("hand_cov", "mean"),
                                  no_hand=("no_hand", "sum"), left_share=("left_share", "mean"),
                                  pose_cov=("pose_cov", "mean")).round(3))
    print("\nLowest hand coverage (train):")
    print(df[df.split == "train"].nsmallest(5, "hand_cov")[["sign", "videos", "hand_cov", "no_hand", "frames_med"]])
    print(f"\nfull report: {REPORT}")


if __name__ == "__main__":
    main()
