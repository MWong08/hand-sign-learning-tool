"""Prepare the app's content files from the model side.

1. Reference videos (IR FR3: "a correct-sign reference for each target sign").
   For each sign, choose the best of the kept PopSign val clips (data/reference_candidates/):
     - prefer clips with at least MIN_HAND_FRAMES frames with a detected hand (a complete,
       visible demonstration) AND that the deployed model recognises as that sign (p >= 0.5);
       failing that, a recognised clip; failing that, any clip;
     - within that group, the clip the model recognises most confidently,
     - ties broken towards a typical sign length (TYPICAL_FRAMES) rather than long, hesitant clips.
   (An earlier rule, "highest share of active frames with a hand", favoured very short clips:
   11 of 50 had <8 hand frames or a model probability <0.5. See DEVLOG 2026-10-25.)
   Then compress it for the browser: H.264 MP4, 480 px tall, no audio, ~50-150 KB.
   Output: ../app/public/reference/{sign}.mp4
   A different clip can be forced per sign with --pick sign=filename.

2. Vocabulary: copies config/vocabulary.json to ../app/public/vocabulary.json, so the app's
   units and labels come from the same file as the model's class list.

PopSign v1.0 is CC BY 4.0: the app must credit it wherever the clips are shown.

Run from model/:  python src/prepare_app_assets.py
"""
import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np

import preprocess as P

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
MIN_HAND_FRAMES = 8
TYPICAL_FRAMES = 18   # median trimmed sign length at 15 fps
DEPLOYED_MODEL = "transformer_crop"

MODEL_DIR = Path(__file__).resolve().parent.parent
CANDIDATES = MODEL_DIR / "data" / "reference_candidates"
APP_PUBLIC = MODEL_DIR.parent / "app" / "public"


def clip_quality(sign, label, candidates, model):
    """{video file name: (hand frames, model probability for the sign)} for the candidate clips"""
    with np.load(P.LANDMARK_DIR / "val" / f"{sign}.npz") as d:
        names = [str(n) for n in d["names"]]
        off, hands, pose, w, h = d["offsets"], d["hands"], d["pose"], d["width"], d["height"]
    out = {}
    for name in candidates:
        i = names.index(name)
        hh, pp = hands[off[i]:off[i + 1]], pose[off[i]:off[i + 1]]
        hand_frames = int((~np.isnan(hh[:, :, P.WRIST, 0].astype(np.float32))).any(axis=1).sum())
        x = P.preprocess_video(hh, pp, int(w[i]), int(h[i]))
        prob = float(model.predict(x[None], verbose=0)[0, label]) if x is not None else 0.0
        out[name] = (hand_frames, prob)
    return out


def best_clip(quality):
    """quality: {name: (hand_frames, prob)}. Recognisable first, then long enough, then most confident."""
    tiers = [
        {n: q for n, q in quality.items() if q[0] >= MIN_HAND_FRAMES and q[1] >= 0.5},
        {n: q for n, q in quality.items() if q[1] >= 0.5},
        quality,
    ]
    group = next(t for t in tiers if t)
    return max(group, key=lambda n: (round(group[n][1], 2), -abs(group[n][0] - TYPICAL_FRAMES)))


def compress(src, dst):
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([
        ffmpeg, "-y", "-loglevel", "error", "-i", str(src),
        "-vf", "scale=-2:480",          # 480 px tall, width keeps the aspect ratio
        "-c:v", "libx264", "-crf", "28", "-preset", "slow",
        "-pix_fmt", "yuv420p",          # plays in every browser
        "-movflags", "+faststart",      # starts playing before fully downloaded
        "-an", str(dst),                # no audio
    ], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pick", nargs="*", default=[], help="override: sign=video_file_name")
    args = ap.parse_args()
    overrides = dict(p.split("=", 1) for p in args.pick)

    vocab_file = MODEL_DIR / "config" / "vocabulary.json"
    shutil.copy(vocab_file, APP_PUBLIC / "vocabulary.json")
    signs = [s["id"] for u in json.loads(vocab_file.read_text(encoding="utf-8"))["units"] for s in u["signs"]]

    import tensorflow as tf
    model = tf.keras.models.load_model(MODEL_DIR / "artifacts" / "models" / f"{DEPLOYED_MODEL}.keras")

    out_dir = APP_PUBLIC / "reference"
    out_dir.mkdir(parents=True, exist_ok=True)
    chosen = {}
    for label, sign in enumerate(signs):
        available = {p.name for p in (CANDIDATES / sign).glob("*.mp4")}
        quality = clip_quality(sign, label, available, model)
        pick = overrides.get(sign) or best_clip(quality)
        compress(CANDIDATES / sign / pick, out_dir / f"{sign}.mp4")
        chosen[sign] = pick
        hf, prob = quality[pick]
        print(f"{sign}: {pick} ({hf} hand frames, model p={prob:.2f}, "
              f"{(out_dir / f'{sign}.mp4').stat().st_size / 1024:.0f} KB)")

    # record which original clip each reference video came from (for attribution / the report)
    (out_dir / "sources.json").write_text(json.dumps({
        "dataset": "PopSign ASL v1.0 (Georgia Tech / DPAN), CC BY 4.0, https://signdata.cc.gatech.edu",
        "clips": chosen}, indent=1))


if __name__ == "__main__":
    main()
