"""Build synthetic PHRASES from real test-set clips, to evaluate phrase recognition end to end
(app/scripts/eval_phrases.mjs runs the app's own segmenter + preprocessing + model on them).

PopSign contains single signs only, so phrases are assembled from one signer's clips of
different signs (same video size, so the frames share one coordinate frame). Two styles:

  lowered  the clips joined as recorded, with the hand out of view between signs
           (+ END_GAP + 2 empty frames to guarantee the gap)
  paused   only each clip's active segment, joined by a still hold: the last hand frame
           repeated, i.e. the learner keeps the hand up and pauses between signs
  held     as paused, but the hold carries REAL landmark jitter: the movement of a held hand
           recorded through the app's browser pipeline (app/scripts/measure_held_jitter.mjs ->
           data/processed/held_hands_browser.json), scaled to the clip's hand size. A frozen
           frame never jitters, so "paused" overstated how well pauses work live (2026-11-11).
  continuous  only each clip's active segment, joined by a short movement (TRANSITION frames
           interpolated from the end of one sign to the start of the next): no pause and no
           lowering, as in fluent signing. An approximation: real signers also blend the end
           and start of neighbouring signs (co-articulation), which joined clips lack.

Phrases use the curriculum's phrase list where the signer has all the signs, plus random
2-4 sign sequences, from one split's signers (val for tuning, test for the final numbers).

Run from model/:  python src/make_phrase_eval.py              -> data/processed/phrase_eval.json (test signers)
                  python src/make_phrase_eval.py --split val  -> data/processed/phrase_eval_val.json
                  python src/make_phrase_eval.py --long       -> data/processed/phrase_eval_long.json
  --long: LONGER phrases (2026-11-12), test signers: the curriculum's level-2 phrases (4-5 signs)
  plus random 4-5 sign sequences. Only for reporting how the (unchanged) settings cope with longer
  phrases; the standard sets keep using only the level-1 phrases, so earlier results are unchanged.
                  (segmenter thresholds are tuned on the val phrases; test phrases are for final reporting)
"""
import argparse
import json
from collections import defaultdict

import numpy as np

import preprocess as P

N_RANDOM = 120
HOLD = 12         # pause length in frames (~0.8 s: the app asks for a ~0.73 s hold, segmenter.js PAUSE_FRAMES)
TRANSITION = 4    # frames to move from one sign to the next in the "continuous" style (~0.27 s)
GAP = 10          # hand-less frames between signs in the "lowered" style
SEED = 3
HELD_FILE = P.OUT_DIR / "held_hands_browser.json"


def to_frames(hands, pose):
    out = []
    for h, p in zip(hands, pose):
        out.append({
            "hands": [None if np.isnan(h[s, 0, 0]) else np.round(h[s], 4).tolist() for s in range(2)],
            "pose": None if np.isnan(p[0, 0]) else np.round(p, 4).tolist(),
        })
    return out


def transition(h0, p0, h1, p1, n=TRANSITION):
    """n frames moving linearly from frame (h0, p0) to frame (h1, p1); a hand slot missing at
    either end stays missing."""
    w = np.linspace(0, 1, n + 2)[1:-1][:, None, None, None]
    hands = (1 - w) * h0[None] + w * h1[None]  # NaN propagates where a slot is missing
    w = w[:, 0]
    pose = (1 - w) * p0[None] + w * p1[None]
    return hands.astype(np.float32), pose.astype(np.float32)


def load_held_jitter(split):
    """Each recorded held hand as its frame-by-frame offset from its own average, in hand sizes:
    (T, 21, 2) arrays, pixels / hand size. Val phrases use the recordings the pause rule was
    calibrated on, test phrases only the others (calibrate_pause.held_part)."""
    from calibrate_pause import held_part
    held = json.loads(HELD_FILE.read_text())
    out = []
    for recs in held.values():
        for r in recs:
            if (held_part(r["sign"]) == "calibration") != (split == "val"):
                continue
            slot = next((s for s in range(2) if all(f["hands"][s] for f in r["frames"])), None)
            if slot is None:
                continue
            pts = np.array([f["hands"][slot] for f in r["frames"]])[:, :, :2] * [r["width"], r["height"]]
            size = np.median(np.linalg.norm(pts[:, 9] - pts[:, 0], axis=-1))
            out.append((pts - pts.mean(0)) / size)
    return out


def jittered_hold(h, p, n, jitter, rng, width, height):
    """n frames holding hand frame h (2, 21, 3) still, with a real recorded jitter added."""
    j = jitter[int(rng.integers(len(jitter)))]
    start = int(rng.integers(len(j) - n + 1))
    hands = np.repeat(h[None], n, axis=0).copy()
    for s in range(2):
        if np.isnan(h[s, 0, 0]):
            continue
        size = np.linalg.norm((h[s, 9, :2] - h[s, 0, :2]) * [width, height])
        hands[:, s, :, :2] += j[start:start + n] * size / np.array([width, height])
    return hands.astype(np.float32), np.repeat(p[None], n, axis=0)


def empty_frames(n, pose_like):
    return [{"hands": [None, None], "pose": pose_like} for _ in range(n)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test", choices=["val", "test"])
    ap.add_argument("--long", action="store_true", help="4-5 sign phrases (test signers)")
    args = ap.parse_args()
    split, long = args.split, args.long
    if long and split != "test":
        ap.error("--long phrases are built from test signers only")
    rng = np.random.default_rng(SEED)
    jitter_rng = np.random.default_rng(SEED + 1)  # separate, so the phrases stay the same as before
    jitter = load_held_jitter(split)
    vocab = json.loads(P.VOCAB_FILE.read_text(encoding="utf-8"))
    signs = [s["id"] for u in vocab["units"] for s in u["signs"]]

    # clips[(signer, size)][sign] = list of (hands, pose) for that signer
    clips = defaultdict(lambda: defaultdict(list))
    for sign in signs:
        with np.load(P.LANDMARK_DIR / split / f"{sign}.npz") as d:
            off, H, Po, W, Hh, who = d["offsets"], d["hands"].astype(np.float32), d["pose"].astype(np.float32), \
                d["width"], d["height"], d["signers"]
        for i in range(len(off) - 1):
            h, p = H[off[i]:off[i + 1]], Po[off[i]:off[i + 1]]
            if P.trim_to_active((~np.isnan(h[:, :, P.WRIST, 0])).any(axis=1)) is None:
                continue
            clips[(str(who[i]), int(W[i]), int(Hh[i]))][sign].append((h, p))

    groups = [g for g in clips if len(clips[g]) >= 10]
    level = 2 if long else 1
    sequences = [p["signs"] for p in vocab["phrases"] if p.get("level", 1) == level]
    low, high = (4, 6) if long else (2, 5)  # random lengths: 2-4 signs, or 4-5 for --long
    sequences += [list(rng.choice(signs, int(rng.integers(low, high)), replace=False)) for _ in range(N_RANDOM)]

    cases = []
    for seq in sequences:
        options = [g for g in groups if all(s in clips[g] for s in seq)]
        if not options:
            continue
        g = options[int(rng.integers(len(options)))]
        chosen = [clips[g][s][int(rng.integers(len(clips[g][s])))] for s in seq]
        pose_ref = next(np.round(p[0], 4).tolist() for _, p in chosen if not np.isnan(p[0, 0, 0]))

        lowered = empty_frames(3, pose_ref)
        paused = empty_frames(3, pose_ref)
        held = empty_frames(3, pose_ref)
        cont_h, cont_p = [], []
        for h, p in chosen:
            lowered += to_frames(h, p) + empty_frames(GAP, pose_ref)
            a, b = P.trim_to_active((~np.isnan(h[:, :, P.WRIST, 0])).any(axis=1))
            hh, pp = h[a:b], p[a:b]
            last = max(i for i in range(len(hh)) if not np.isnan(hh[i, :, P.WRIST, 0]).all())
            hold_h, hold_p = np.repeat(hh[last:last + 1], HOLD, axis=0), np.repeat(pp[last:last + 1], HOLD, axis=0)
            paused += to_frames(np.concatenate([hh[:last + 1], hold_h]), np.concatenate([pp[:last + 1], hold_p]))
            jh, jp = jittered_hold(hh[last], pp[last], HOLD, jitter, jitter_rng, g[1], g[2])
            held += to_frames(np.concatenate([hh[:last + 1], jh]), np.concatenate([pp[:last + 1], jp]))
            seg_h, seg_p = hh[:last + 1], pp[:last + 1]
            if cont_h:
                th, tp = transition(cont_h[-1][-1], cont_p[-1][-1], seg_h[0], seg_p[0])
                cont_h.append(th)
                cont_p.append(tp)
            cont_h.append(seg_h)
            cont_p.append(seg_p)
        paused += empty_frames(GAP, pose_ref)
        held += empty_frames(GAP, pose_ref)
        continuous = empty_frames(3, pose_ref) + to_frames(np.concatenate(cont_h), np.concatenate(cont_p))             + empty_frames(GAP, pose_ref)

        cases.append({"signs": list(seq), "signer": g[0], "width": g[1], "height": g[2],
                      "lowered": lowered, "paused": paused, "held": held, "continuous": continuous})

    out = P.OUT_DIR / ("phrase_eval_long.json" if long else "phrase_eval.json" if split == "test" else f"phrase_eval_{split}.json")
    out.write_text(json.dumps(cases))
    lengths = [len(c["signs"]) for c in cases]
    print(f"{len(cases)} phrases (lengths {dict(zip(*(a.tolist() for a in np.unique(lengths, return_counts=True))))}), "
          f"{len({c['signer'] for c in cases})} signers -> {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
