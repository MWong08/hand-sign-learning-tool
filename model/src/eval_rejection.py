"""Feasibility experiment: can the app say "that's not a sign I know" instead of forcing one of
its 50 labels onto everything?

Out-of-vocabulary (OOV) signs: 17 other PopSign signs, test signers only, extracted with
  python src/extract_popsign.py --signs <...> --splits test --keep-reference 0 --out-dir data/processed/landmarks_oov
Some were picked to be unlike the curriculum (airplane, scissors, ...) and some to resemble it
(hat, pretty, bed, finish, tiger), so the result isn't flattered by easy cases.

Scores tried (higher = "this is a sign I know"):
  prob       the model's top probability
  margin     top probability minus the second
  closeness  how close the attempt is to the predicted sign's template (diagnostics.py, 0-100)
  prob+closeness  both must pass their own threshold

No OOV data is used to choose anything: each threshold is set on the VAL signers' in-vocabulary
attempts so that 95% of correctly recognised attempts are still accepted (the learner is rarely
told a correct sign is unknown). OOV clips are then only used to measure the share rejected.

Run from model/:  python src/eval_rejection.py
Output: artifacts/results/rejection_eval.json
"""
import json
import os
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
import numpy as np
import tensorflow as tf
from sklearn.metrics import roc_auc_score

import diagnostics as D
import preprocess as P

MODEL_DIR = Path(__file__).resolve().parent.parent
OOV_DIR = P.OUT_DIR / "landmarks_oov" / "test"
KEEP_CORRECT = 0.95


def load_oov():
    X, names = [], []
    for f in sorted(OOV_DIR.glob("*.npz")):
        with np.load(f) as d:
            off = d["offsets"]
            for i in range(len(off) - 1):
                x = P.preprocess_video(d["hands"][off[i]:off[i + 1]], d["pose"][off[i]:off[i + 1]],
                                       int(d["width"][i]), int(d["height"][i]))
                if x is not None:
                    X.append(x)
                    names.append(f.stem)
    return np.stack(X).astype(np.float32), np.array(names)


def scores(model, templates, labels, X):
    probs = model.predict(X, batch_size=512, verbose=0)
    order = np.argsort(-probs, axis=1)
    top, second = probs[np.arange(len(X)), order[:, 0]], probs[np.arange(len(X)), order[:, 1]]
    close = np.array([D.closeness(D.deviations(x, templates[labels[k]]), templates[labels[k]])
                      for x, k in zip(X.astype(np.float64), order[:, 0])])
    return {"pred": order[:, 0], "prob": top, "margin": top - second, "closeness": close}


def main():
    model = tf.keras.models.load_model(MODEL_DIR / "artifacts" / "models" / "transformer_crop.keras")
    labels = json.loads((MODEL_DIR.parent / "app" / "public" / "models" / "labels.json").read_text())
    templates = {k: D.from_json(v) for k, v in
                 json.loads((MODEL_DIR.parent / "app" / "public" / "models" / "templates.json").read_text()).items()}

    val, test = np.load(P.OUT_DIR / "dataset_val.npz"), np.load(P.OUT_DIR / "dataset_test.npz")
    sv = scores(model, templates, labels, val["X"])
    st = scores(model, templates, labels, test["X"])
    Xo, oov_names = load_oov()
    so = scores(model, templates, labels, Xo)
    print(f"in-vocabulary test clips {len(test['X'])}, OOV clips {len(Xo)} ({len(set(oov_names))} signs)")

    val_ok = sv["pred"] == val["y"]
    test_ok = st["pred"] == test["y"]
    results = {"oov_signs": sorted(set(oov_names)), "n_test": int(len(test["X"])), "n_oov": int(len(Xo)), "methods": {}}

    def report(name, accept_val, accept_test, accept_oov, auc=None):
        r = {
            "auroc_in_vs_oov": None if auc is None else round(auc, 3),
            "val_correct_accepted": round(float(accept_val[val_ok].mean()), 3),
            "test_correct_accepted": round(float(accept_test[test_ok].mean()), 3),
            "test_wrong_rejected": round(float(1 - accept_test[~test_ok].mean()), 3),
            "oov_rejected": round(float(1 - accept_oov.mean()), 3),
        }
        results["methods"][name] = r
        print(f"{name:16s} {r}")
        return r

    thresholds = {}
    for s in ("prob", "margin", "closeness"):
        thresholds[s] = float(np.quantile(sv[s][val_ok], 1 - KEEP_CORRECT))
        auc = roc_auc_score(np.r_[np.ones(len(st[s])), np.zeros(len(so[s]))], np.r_[st[s], so[s]])
        report(s, sv[s] >= thresholds[s], st[s] >= thresholds[s], so[s] >= thresholds[s], auc)

    # both must pass: loosen each to keep KEEP_CORRECT of val-correct jointly (search a shared quantile)
    for q in np.linspace(0.05, 0.0, 51):
        tp, tc = np.quantile(sv["prob"][val_ok], q), np.quantile(sv["closeness"][val_ok], q)
        acc = (sv["prob"] >= tp) & (sv["closeness"] >= tc)
        if acc[val_ok].mean() >= KEEP_CORRECT:
            break
    thresholds["prob+closeness"] = {"prob": float(tp), "closeness": float(tc)}
    both = lambda s: (s["prob"] >= tp) & (s["closeness"] >= tc)  # noqa: E731
    report("prob+closeness", both(sv), both(st), both(so))

    # where do unknown signs end up, and which slip through (with the best single score)
    best = max(("prob", "margin", "closeness"), key=lambda s: results["methods"][s]["oov_rejected"])
    acc_o = so[best] >= thresholds[best]
    per_sign = {}
    for name in sorted(set(oov_names)):
        m = oov_names == name
        preds, counts = np.unique(so["pred"][m], return_counts=True)
        top = preds[np.argsort(-counts)[:2]]
        per_sign[name] = {"clips": int(m.sum()), "rejected": round(float(1 - acc_o[m].mean()), 2),
                          "mostly_read_as": [labels[k] for k in top]}
    results["thresholds"] = thresholds
    results["per_oov_sign_" + best] = per_sign
    print(f"per OOV sign ({best}):")
    for k, v in per_sign.items():
        print(f"  {k:12s} rejected {v['rejected']:.0%}  read as {v['mostly_read_as']}")

    out = MODEL_DIR / "artifacts" / "results" / "rejection_eval.json"
    out.write_text(json.dumps(results, indent=1))
    print("->", out)


if __name__ == "__main__":
    main()
