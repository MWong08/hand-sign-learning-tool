"""Export raw landmark sequences + Python preprocessing outputs, for testing that the browser's
preprocess.js computes exactly the same features (app/src/lib/preprocess.test.js).

The sample deliberately covers the tricky paths:
  - videos whose signing hand is NOT the canonical slot (exercises mirroring)
  - videos with missing hand frames inside the sign (exercises interpolation)
  - videos with no hand at all (both sides must return "unusable")
  - ordinary videos

Run from model/:  python src/export_parity_fixture.py
Output: ../app/src/lib/__fixtures__/parity.json
"""
import json
from pathlib import Path

import numpy as np

import preprocess as P

MODEL_DIR = Path(__file__).resolve().parent.parent
OUT = MODEL_DIR.parent / "app" / "src" / "lib" / "__fixtures__" / "parity.json"
PER_CATEGORY = 6


def to_frames(hands, pose):
    """NaN arrays -> the browser's frame format (null where nothing was detected)."""
    frames = []
    for h, p in zip(hands.astype(np.float32), pose.astype(np.float32)):
        frames.append({
            "hands": [None if np.isnan(h[s, 0, 0]) else h[s].tolist() for s in range(2)],
            "pose": None if np.isnan(p[0, 0]) else p.tolist(),
        })
    return frames


def category(hands):
    present = ~np.isnan(hands[:, :, P.WRIST, 0].astype(np.float32))
    if not present.any():
        return "no_hand"
    seg = P.trim_to_active(present.any(axis=1))
    inside = present[seg[0]:seg[1]]
    slot = int(inside.sum(axis=0).argmax())
    if slot != P.CANONICAL_SLOT:
        return "mirrored"
    if not inside[:, slot].all():
        return "gaps"
    return "plain"


def main():
    picked = {"mirrored": [], "gaps": [], "no_hand": [], "plain": []}
    rng = np.random.default_rng(1)
    files = sorted((P.LANDMARK_DIR / "val").glob("*.npz"))
    rng.shuffle(files)
    for path in files:
        with np.load(path) as d:
            off, hands, pose, width, height = d["offsets"], d["hands"], d["pose"], d["width"], d["height"]
        for i in range(len(off) - 1):
            h, p = hands[off[i]:off[i + 1]], pose[off[i]:off[i + 1]]
            cat = category(h)
            if len(picked[cat]) >= PER_CATEGORY:
                continue
            expected = P.preprocess_video(h, p, int(width[i]), int(height[i]))
            picked[cat].append({
                "source": f"val/{path.stem}#{i}", "category": cat,
                "width": int(width[i]), "height": int(height[i]),
                "frames": to_frames(h, p),
                "expected": None if expected is None else np.round(expected, 6).tolist(),
            })
        if all(len(v) >= PER_CATEGORY for v in picked.values()):
            break

    cases = [c for v in picked.values() for c in v]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cases))
    print(f"{len(cases)} cases: " + ", ".join(f"{k}={len(v)}" for k, v in picked.items()) +
          f" -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
