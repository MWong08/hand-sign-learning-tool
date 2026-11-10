"""Turn raw MediaPipe landmarks into fixed-size model input (CRISP-DM: Data Preparation).

Every step is plain array maths so the browser app can repeat it exactly on live webcam
landmarks. If training and live preprocessing differ, the model fails in the app even when
test accuracy is high.

Pipeline for one video (hands: (T, 2, 21, 3), pose: (T, 25, 4), coordinates normalised 0-1):
  1. trim_to_active   keep the main run of frames that contain a hand
  2. dominant_hand    pick the signing hand, mirror left-handed signers to one canonical side,
                      fill short detection gaps by interpolation
  3. make_features    convert to pixels, then describe each frame by
                        - hand shape: 20 joints relative to the wrist, scaled by hand size (60)
                        - hand location: wrist relative to the shoulders, scaled by shoulder width (2)
                        - hand-to-face: wrist relative to the nose, scaled by shoulder width (2)
  4. resample         stretch or squeeze the sequence to a fixed number of frames

Run from model/ to build the datasets:
  python src/preprocess.py     -> data/processed/dataset_{train,val,test}.npz
"""
import json
from pathlib import Path

import numpy as np

MODEL_DIR = Path(__file__).resolve().parent.parent
VOCAB_FILE = MODEL_DIR / "config" / "vocabulary.json"
LANDMARK_DIR = MODEL_DIR / "data" / "processed" / "landmarks"
OUT_DIR = MODEL_DIR / "data" / "processed"

SEQ_LEN = 24        # fixed frames per sample; the median trimmed sign is ~18 frames at 15 fps
MAX_GAP = 5         # missing-hand frames (~0.33 s) tolerated inside one sign
CANONICAL_SLOT = 1  # hand slot labelled "Right" by MediaPipe; most PopSign signers use it

# MediaPipe pose indices
NOSE, L_SHOULDER, R_SHOULDER = 0, 11, 12
# left/right pose points swap places when the image is mirrored
POSE_MIRROR = list(range(25))
for a, b in [(1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16),
             (17, 18), (19, 20), (21, 22), (23, 24)]:
    POSE_MIRROR[a], POSE_MIRROR[b] = b, a

WRIST, MIDDLE_MCP = 0, 9  # hand landmarks used for the hand's own origin and size
N_FEATURES = 20 * 3 + 2 + 2


# ---------------------------------------------------------------- step 1

def trim_to_active(hand_present):
    """Return (start, end) of the main run of frames with a hand, or None if there is none.

    Runs separated by gaps of up to MAX_GAP frames are merged (motion blur drops the hand
    for a few frames mid-sign). The run with the most hand frames wins, so a stray
    detection long before or after the sign doesn't stretch the clip."""
    idx = np.flatnonzero(hand_present)
    if len(idx) == 0:
        return None
    runs, start, prev = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - prev > MAX_GAP + 1:
            runs.append((start, prev + 1))
            start = i
        prev = i
    runs.append((start, prev + 1))
    return max(runs, key=lambda r: hand_present[r[0]:r[1]].sum())


# ---------------------------------------------------------------- step 2

def interpolate_missing(seq):
    """Fill NaN frames in seq (T, ...) by linear interpolation over time; edges copy the
    nearest detected frame."""
    t = np.arange(len(seq))
    flat = seq.reshape(len(seq), -1)
    valid = ~np.isnan(flat[:, 0])
    if valid.all():
        return seq
    out = np.empty_like(flat)
    for j in range(flat.shape[1]):
        out[:, j] = np.interp(t, t[valid], flat[valid, j])
    return out.reshape(seq.shape)


def dominant_hand(hands, pose):
    """Return (hand (T, 21, 3), pose (T, 25, 4)) for the signing hand, mirrored if needed.

    The signing hand is the slot detected in more frames (PopSign signs are one-handed).
    If it isn't the canonical slot, x is flipped (x -> 1 - x) for hand and pose, and the
    pose's left/right points are swapped, so every sample looks like the same hand signing."""
    present = ~np.isnan(hands[:, :, WRIST, 0])            # (T, 2)
    slot = int(present.sum(axis=0).argmax())
    hand = hands[:, slot].copy()
    pose = pose.copy()
    if slot != CANONICAL_SLOT:
        hand[..., 0] = 1.0 - hand[..., 0]
        pose[..., 0] = 1.0 - pose[..., 0]
        pose = pose[:, POSE_MIRROR]
    return interpolate_missing(hand), interpolate_missing(pose)


# ---------------------------------------------------------------- step 3

def make_features(hand, pose, width, height):
    """Per-frame feature vectors (T, N_FEATURES).

    Landmarks are first converted to pixels (x * width, y * height, z * width), so frames of
    different shapes (portrait phone video, landscape webcam) don't distort the geometry."""
    scale = np.array([width, height, width], dtype=np.float32)
    hand = hand * scale
    pose_xy = pose[..., :2] * scale[:2]

    # body reference: per-video median, so shoulder jitter doesn't shake every frame
    l_sh, r_sh = pose_xy[:, L_SHOULDER], pose_xy[:, R_SHOULDER]
    shoulder_mid = np.median((l_sh + r_sh) / 2, axis=0)
    shoulder_w = np.median(np.linalg.norm(l_sh - r_sh, axis=1))
    nose = np.median(pose_xy[:, NOSE], axis=0)

    # hand shape: joints relative to the wrist, scaled by the wrist -> middle-knuckle length.
    # The length is measured in 3D and taken as the per-video median: in 2D it shrinks towards
    # zero whenever the hand points at the camera, which blew the features up to +-180.
    wrist = hand[:, WRIST]
    hand_size = np.median(np.linalg.norm(hand[:, MIDDLE_MCP] - wrist, axis=1))
    shape = (hand[:, 1:] - wrist[:, None]) / max(hand_size, 1e-6)

    location = (wrist[:, :2] - shoulder_mid) / shoulder_w
    to_face = (wrist[:, :2] - nose) / shoulder_w
    return np.concatenate([shape.reshape(len(hand), -1), location, to_face], axis=1).astype(np.float32)


# ---------------------------------------------------------------- step 4

def resample(features, length=SEQ_LEN):
    """Linearly resample (T, F) to (length, F) along time."""
    src = np.linspace(0, 1, len(features))
    dst = np.linspace(0, 1, length)
    return np.stack([np.interp(dst, src, features[:, j]) for j in range(features.shape[1])], axis=1)


# ---------------------------------------------------------------- full pipeline

def preprocess_video(hands, pose, width, height):
    """Raw landmarks of one video -> (SEQ_LEN, N_FEATURES), or None if unusable."""
    hands = hands.astype(np.float32)
    pose = pose.astype(np.float32)
    seg = trim_to_active((~np.isnan(hands[:, :, WRIST, 0])).any(axis=1))
    if seg is None:
        return None
    hands, pose = hands[seg[0]:seg[1]], pose[seg[0]:seg[1]]
    if np.isnan(pose[:, L_SHOULDER, 0]).all():
        return None  # no body reference
    hand, pose = dominant_hand(hands, pose)
    return resample(make_features(hand, pose, width, height))


def build_split(split, signs):
    X, y, signers, dropped = [], [], [], 0
    for label, sign in enumerate(signs):
        # read each array once: every d["key"] access on an .npz decompresses the whole array again
        with np.load(LANDMARK_DIR / split / f"{sign}.npz") as d:
            off, hands_all, pose_all = d["offsets"], d["hands"], d["pose"]
            width, height, video_signers = d["width"], d["height"], d["signers"]
        for i in range(len(off) - 1):
            sample = preprocess_video(hands_all[off[i]:off[i + 1]], pose_all[off[i]:off[i + 1]],
                                      int(width[i]), int(height[i]))
            if sample is None or not np.isfinite(sample).all():
                dropped += 1
                continue
            X.append(sample)
            y.append(label)
            signers.append(video_signers[i])
    np.savez_compressed(OUT_DIR / f"dataset_{split}.npz", X=np.stack(X).astype(np.float32),
                        y=np.array(y, dtype=np.int64), signers=np.array(signers), signs=np.array(signs))
    print(f"{split}: {len(X)} samples, {dropped} dropped, X shape {np.stack(X).shape}")


def main():
    vocab = json.loads(VOCAB_FILE.read_text(encoding="utf-8"))
    signs = [s["id"] for unit in vocab["units"] for s in unit["signs"]]  # class index = vocabulary order
    for split in ["train", "val", "test"]:
        build_split(split, signs)


if __name__ == "__main__":
    main()
