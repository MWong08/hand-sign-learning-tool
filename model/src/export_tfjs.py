"""Export trained Keras models to TensorFlow.js for in-browser inference.

  .keras  --model.export()-->  TF SavedModel  --tensorflowjs converter-->  TF.js graph model
                                                                           (model.json + weight shards)

Also writes, next to the models:
  labels.json         class index -> sign id (the vocabulary order used in training)
  preprocessing.json  the constants the browser must use to match preprocess.py exactly
  verify/samples.json a few test samples with the Python model's outputs, so the browser
                      (or Node) can check it gets the same predictions

Windows note: the converter (tensorflowjs 4.22) imports tensorflow_decision_forests at module
level, a package with no Windows build that is only needed for converting decision-forest
models. A placeholder module is registered before the import; nothing else is faked.

Run from model/:  python src/export_tfjs.py              (default: the selected transformer)
Output: ../app/public/models/{name}/
"""
import argparse
import json
import shutil
import sys
import types
from pathlib import Path

import numpy as np

sys.modules.setdefault("tensorflow_decision_forests", types.ModuleType("tensorflow_decision_forests"))
import tensorflow as tf  # noqa: E402
from tensorflowjs.converters import tf_saved_model_conversion_v2 as tfjs_saved_model  # noqa: E402

import preprocess  # noqa: E402  (shares the constants the browser must match)

MODEL_DIR = Path(__file__).resolve().parent.parent
MODELS_IN = MODEL_DIR / "artifacts" / "models"
SAVED_DIR = MODEL_DIR / "artifacts" / "saved_models"
APP_MODELS = MODEL_DIR.parent / "app" / "public" / "models"
DATA_DIR = MODEL_DIR / "data" / "processed"


def export(name, n_verify=32):
    # Note: recurrent layers (LSTM/GRU) export as a while-loop, which TF.js runs with
    # executeAsync() instead of predict(). Rebuilding them with unroll=True was tried and
    # rejected: the rebuilt model's weights didn't line up (4/32 correct) and the file grew
    # from 1.2 MB to 12.6 MB. The Transformer has no loop and runs with predict().
    model = tf.keras.models.load_model(MODELS_IN / f"{name}.keras")

    saved = SAVED_DIR / name
    shutil.rmtree(saved, ignore_errors=True)
    model.export(str(saved))  # serving signature: inference only (GaussianNoise/Dropout off)

    out = APP_MODELS / name
    shutil.rmtree(out, ignore_errors=True)
    tfjs_saved_model.convert_tf_saved_model(
        str(saved), str(out), signature_def="serving_default", saved_model_tags="serve")

    # reference outputs for checking the browser model gives the same answers
    test = np.load(DATA_DIR / "dataset_test.npz")
    rng = np.random.default_rng(0)
    idx = rng.choice(len(test["X"]), n_verify, replace=False)
    x = test["X"][idx]
    probs = model.predict(x, verbose=0)
    (out / "verify").mkdir(exist_ok=True)
    (out / "verify" / "samples.json").write_text(json.dumps({
        "x": x.round(6).tolist(), "y": test["y"][idx].tolist(), "probs": probs.round(6).tolist()}))

    size_kb = sum(f.stat().st_size for f in out.glob("*") if f.is_file()) / 1024
    print(f"{name}: exported to {out} ({size_kb:.0f} KB)")


def write_shared_files():
    signs = [str(s) for s in np.load(DATA_DIR / "dataset_test.npz")["signs"]]
    APP_MODELS.mkdir(parents=True, exist_ok=True)
    (APP_MODELS / "labels.json").write_text(json.dumps(signs, indent=1))
    (APP_MODELS / "preprocessing.json").write_text(json.dumps({
        "seq_len": preprocess.SEQ_LEN,
        "max_gap": preprocess.MAX_GAP,
        "fps": 15,
        "canonical_slot": preprocess.CANONICAL_SLOT,
        "canonical_label": "Right",
        "pose_mirror": preprocess.POSE_MIRROR,
        "n_features": preprocess.N_FEATURES,
        "landmarks": {"nose": preprocess.NOSE, "l_shoulder": preprocess.L_SHOULDER,
                      "r_shoulder": preprocess.R_SHOULDER, "wrist": preprocess.WRIST,
                      "middle_mcp": preprocess.MIDDLE_MCP},
    }, indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=["transformer_crop"])
    args = ap.parse_args()
    write_shared_files()
    for name in args.models:
        export(name)


if __name__ == "__main__":
    main()
