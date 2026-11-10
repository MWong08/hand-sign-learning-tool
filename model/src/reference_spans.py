"""Where the sign happens in each app reference clip (app/public/reference/{sign}.mp4): the
start and end time, in seconds, of the active segment (frames with a hand, preprocess.trim_to_active),
looked up in the clip's extracted val landmarks. Used by app/scripts/e2e_phrases.mjs to join
clips into phrase videos signed straight through, with no hand lowering in between.

Run from model/:  python src/reference_spans.py  -> data/processed/reference_spans.json
"""
import json

import numpy as np

import preprocess as P


def main():
    sources = json.loads((P.MODEL_DIR.parent / "app" / "public" / "reference" / "sources.json").read_text())["clips"]
    spans = {}
    for sign, clip in sources.items():
        with np.load(P.LANDMARK_DIR / "val" / f"{sign}.npz") as d:
            names = [str(n) for n in d["names"]]
            stem = clip.removesuffix(".mp4")
            i = next((k for k, n in enumerate(names) if n.removesuffix(".mp4") == stem), None)
            if i is None:
                continue
            h = d["hands"][d["offsets"][i]:d["offsets"][i + 1]].astype(np.float32)
            fps = float(d["fps"][i])
        act = P.trim_to_active((~np.isnan(h[:, :, P.WRIST, 0])).any(axis=1))
        if act is None:
            continue
        spans[sign] = [round(act[0] / fps, 3), round(act[1] / fps, 3)]  # fps: the landmarks' own rate (15)
    out = P.OUT_DIR / "reference_spans.json"
    out.write_text(json.dumps(spans, indent=1))
    print(f"{len(spans)} of {len(sources)} reference clips -> {out}")


if __name__ == "__main__":
    main()
