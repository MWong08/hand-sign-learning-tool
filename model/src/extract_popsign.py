"""Stream PopSign v1.0 videos, extract MediaPipe landmarks, and discard the videos.

For each (sign, split) in the curriculum vocabulary:
  1. Stream https://signdata.cc.gatech.edu/data/popsign_v1_0/game/{split}/{sign}.tar
     (never stored whole; one sign's train tar alone is ~2.6 GB).
  2. For each .mp4 inside: write it to a temp file, run MediaPipe Hand Landmarker and
     Pose Landmarker on every frame, then delete the video.
  3. Save all landmark sequences for that (sign, split) into one compressed .npz:
       data/processed/landmarks/{split}/{sign}.npz
  4. Optionally keep a few raw videos per sign as candidates for the app's reference media:
       data/reference_candidates/{sign}/

The same MediaPipe Tasks models are used later in the browser (MediaPipe Tasks for Web),
so the training landmarks and the live landmarks come from the same detector.

Output .npz layout (ragged sequences stored back-to-back; video i is frames offsets[i]:offsets[i+1]):
  hands    float16 (total_frames, 2, 21, 3)  slot 0 = hand MediaPipe labels "Left", slot 1 = "Right";
                                             x, y normalised to the frame; NaN where no hand detected
  pose     float16 (total_frames, 25, 4)     upper-body pose points 0-24: x, y, z, visibility; NaN if none
  offsets  int64   (n_videos + 1,)
  names    str     (n_videos,)               original video file name
  signers  str     (n_videos,)               signer id parsed from the file name
  fps, width, height  per video

Run from model/:
  python src/extract_popsign.py --signs hello --splits val --limit 5     (quick test)
  python src/extract_popsign.py                                           (full curriculum)
"""
import argparse
import csv
import json
import os
import shutil
import ssl
import tarfile
import tempfile
import time
import urllib.request
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

MODEL_DIR = Path(__file__).resolve().parent.parent
VOCAB_FILE = MODEL_DIR / "config" / "vocabulary.json"
OUT_DIR = MODEL_DIR / "data" / "processed" / "landmarks"
REF_DIR = MODEL_DIR / "data" / "reference_candidates"
# Verify the server with certifi's CA bundle: the Windows store stopped accepting
# signdata.cc.gatech.edu's certificate chain (Nov 2026)
SSL_CONTEXT = ssl.create_default_context(cafile=__import__("certifi").where())
LOG_FILE = MODEL_DIR / "data" / "processed" / "extraction_log.csv"
MP_DIR = MODEL_DIR / "artifacts" / "mediapipe"

TAR_URL = "https://signdata.cc.gatech.edu/data/popsign_v1_0/game/{split}/{sign}.tar"
MP_MODELS = {
    "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
                            "hand_landmarker/float16/latest/hand_landmarker.task",
    "pose_landmarker_lite.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
                                 "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
}
N_POSE = 25  # pose points 0-24 = face reference points, shoulders, arms, hips (legs dropped)


# ---------------------------------------------------------------- setup

def load_vocabulary():
    vocab = json.loads(VOCAB_FILE.read_text(encoding="utf-8"))
    return [s["id"] for unit in vocab["units"] for s in unit["signs"]]


def ensure_mediapipe_models():
    MP_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in MP_MODELS.items():
        if not (MP_DIR / name).exists():
            print(f"downloading {name} ...")
            urllib.request.urlretrieve(url, MP_DIR / name)


_landmarkers = None  # one (mp, hands, pose) set per worker process, reused for every video
_timestamp_ms = 0     # VIDEO mode needs timestamps that keep increasing across all videos


def get_landmarkers():
    """Create the landmarkers once per process (creation takes seconds, longer than
    processing a whole video).

    Thresholds are lower than MediaPipe's 0.5 defaults because fast signing causes motion
    blur. On sample videos, 0.3/0.3/0.1 raised the share of frames with a detected hand
    from ~54% to ~67%. The PopSign authors also used a low tracking confidence (0.1)."""
    global _landmarkers
    if _landmarkers is None:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MP_DIR / "hand_landmarker.task")),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.3,
            min_hand_presence_confidence=0.3,
            min_tracking_confidence=0.1,
        ))
        pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MP_DIR / "pose_landmarker_lite.task")),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
        ))
        _landmarkers = (mp, hands, pose)
    return _landmarkers


def reset_tracking(mp, hand_lm, pose_lm, shape):
    """VIDEO mode tracks hands from frame to frame. Feeding one black frame (no hands, no
    person) between videos clears that state, so tracking never carries over from the
    previous video."""
    global _timestamp_ms
    _timestamp_ms += 1000
    black = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.zeros(shape, dtype=np.uint8))
    hand_lm.detect_for_video(black, _timestamp_ms)
    pose_lm.detect_for_video(black, _timestamp_ms)
    _timestamp_ms += 1000


# ---------------------------------------------------------------- one video

def extract_video(path, max_side, frame_step=1):
    """Return (hands, pose, fps, width, height) for one video file.

    frame_step=2 processes every 2nd frame (30 fps -> 15 fps), which halves the
    extraction time. The returned fps is the effective rate of the kept frames."""
    import cv2

    cap = cv2.VideoCapture(str(path))
    source_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    fps = source_fps / frame_step
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = min(1.0, max_side / max(width, height, 1))  # MediaPipe downsizes internally anyway

    global _timestamp_ms
    mp, hand_lm, pose_lm = get_landmarkers()
    hands_seq, pose_seq = [], []
    frame_idx = 0
    read_idx = 0
    start_ts = _timestamp_ms
    rgb = None
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            read_idx += 1
            if (read_idx - 1) % frame_step:
                continue  # skipped frame: decoded (unavoidable) but not run through MediaPipe
            if scale < 1.0:
                frame = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            ts = start_ts + int(frame_idx * 1000 / fps)
            _timestamp_ms = ts

            h = np.full((2, 21, 3), np.nan, dtype=np.float32)
            res = hand_lm.detect_for_video(image, ts)
            for landmarks, handedness in zip(res.hand_landmarks, res.handedness):
                slot = 0 if handedness[0].category_name == "Left" else 1
                h[slot] = [[p.x, p.y, p.z] for p in landmarks]

            p = np.full((N_POSE, 4), np.nan, dtype=np.float32)
            res = pose_lm.detect_for_video(image, ts)
            if res.pose_landmarks:
                p[:] = [[q.x, q.y, q.z, q.visibility] for q in res.pose_landmarks[0][:N_POSE]]

            hands_seq.append(h)
            pose_seq.append(p)
            frame_idx += 1
    finally:
        cap.release()
        if rgb is not None:
            reset_tracking(mp, hand_lm, pose_lm, rgb.shape)

    if not hands_seq:  # unreadable / empty video
        return None
    return np.stack(hands_seq), np.stack(pose_seq), fps, width, height


# ---------------------------------------------------------------- one (sign, split) job

def signer_of(filename, sign):
    # e.g. "4a.7002-apple-2022_12_20_01_59_37.619-0.mp4" -> "4a.7002"
    return filename.split(f"-{sign}-")[0]


def run_job(sign, split, cap, keep_reference, max_side, frame_step, limit, out_dir=OUT_DIR, retries=3):
    out_path = Path(out_dir) / split / f"{sign}.npz"
    if out_path.exists():
        return {"sign": sign, "split": split, "status": "skipped (exists)"}
    out_path.parent.mkdir(parents=True, exist_ok=True)

    max_videos = limit if limit else (cap if split == "train" else None)
    keep_ref = keep_reference if split == "val" else 0  # reference candidates come from val
    url = TAR_URL.format(split=split, sign=sign)
    started = time.time()

    for attempt in range(1, retries + 1):
        records, n_unreadable, kept_refs = [], 0, 0
        try:
            with tempfile.TemporaryDirectory() as tmp, urllib.request.urlopen(url, timeout=120, context=SSL_CONTEXT) as resp:
                # "r|" = streaming mode: read members one by one, never the whole tar
                with tarfile.open(fileobj=resp, mode="r|") as tar:
                    for member in tar:
                        if not (member.isfile() and member.name.endswith(".mp4")):
                            continue
                        name = os.path.basename(member.name)
                        video_path = Path(tmp) / name
                        with tar.extractfile(member) as src, open(video_path, "wb") as dst:
                            shutil.copyfileobj(src, dst)

                        try:
                            result = extract_video(video_path, max_side, frame_step)
                        except Exception:  # a corrupt video should cost one video, not the whole job
                            result = None
                        if result is None:
                            n_unreadable += 1
                        else:
                            records.append((name, signer_of(name, sign)) + result)
                            if kept_refs < keep_ref:
                                (REF_DIR / sign).mkdir(parents=True, exist_ok=True)
                                shutil.copy(video_path, REF_DIR / sign / name)
                                kept_refs += 1
                        video_path.unlink()

                        if max_videos and len(records) >= max_videos:
                            break  # leaving the with-block closes the download early
            break
        except Exception as e:  # network drop etc.: retry the whole job
            if attempt == retries:
                return {"sign": sign, "split": split, "status": f"FAILED: {e}"}
            time.sleep(10 * attempt)

    save_npz(out_path, records)
    n_no_hand = sum(1 for r in records if np.isnan(r[2]).all())
    return {"sign": sign, "split": split, "status": "ok", "videos": len(records),
            "no_hand_videos": n_no_hand, "unreadable": n_unreadable,
            "minutes": round((time.time() - started) / 60, 1)}


def save_npz(out_path, records):
    names, signers, hands, pose, fps, width, height = zip(*records)
    lengths = [len(h) for h in hands]
    tmp_path = out_path.with_suffix(".tmp.npz")
    np.savez_compressed(
        tmp_path,
        hands=np.concatenate(hands).astype(np.float16),
        pose=np.concatenate(pose).astype(np.float16),
        offsets=np.concatenate([[0], np.cumsum(lengths)]).astype(np.int64),
        names=np.array(names), signers=np.array(signers),
        fps=np.array(fps, dtype=np.float32),
        width=np.array(width, dtype=np.int32), height=np.array(height, dtype=np.int32),
    )
    tmp_path.replace(out_path)  # write-then-rename: a crash never leaves a half-written file


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--signs", nargs="*", help="default: every sign in config/vocabulary.json")
    ap.add_argument("--splits", nargs="*", default=["train", "val", "test"])
    ap.add_argument("--train-cap", type=int, default=250, help="max videos per sign from train")
    ap.add_argument("--keep-reference", type=int, default=3, help="raw val videos kept per sign")
    ap.add_argument("--max-side", type=int, default=640, help="resize frames so the long side is this")
    ap.add_argument("--frame-step", type=int, default=2, help="process every Nth frame (2: 30 -> 15 fps)")
    ap.add_argument("--workers", type=int, default=6, help="parallel (sign, split) jobs")
    ap.add_argument("--limit", type=int, help="test mode: stop each job after N videos")
    ap.add_argument("--out-dir", default=str(OUT_DIR),
                    help="where the .npz files go (e.g. a separate folder for out-of-vocabulary signs)")
    args = ap.parse_args()

    signs = args.signs or load_vocabulary()
    ensure_mediapipe_models()
    jobs = [(s, sp) for s in signs for sp in args.splits]
    print(f"{len(jobs)} jobs ({len(signs)} signs x {args.splits}), {args.workers} workers")

    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    fields = ["sign", "split", "status", "videos", "no_hand_videos", "unreadable", "minutes"]
    new_log = not LOG_FILE.exists()
    with open(LOG_FILE, "a", newline="") as f, ProcessPoolExecutor(args.workers) as pool:
        log = csv.DictWriter(f, fieldnames=fields)
        if new_log:
            log.writeheader()
        futures = [pool.submit(run_job, s, sp, args.train_cap, args.keep_reference,
                               args.max_side, args.frame_step, args.limit, args.out_dir) for s, sp in jobs]
        for done, fut in enumerate(as_completed(futures), 1):
            row = fut.result()
            log.writerow(row)
            f.flush()
            print(f"[{done}/{len(jobs)}] {row}")


if __name__ == "__main__":
    main()
