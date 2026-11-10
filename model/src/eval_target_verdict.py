"""Experiment: when practising a KNOWN target sign, should a near miss count as correct?

Problem seen in testing: the learner signs the target, the result says closeness 100%, but the
verdict is "Almost there, it looked more like <look-alike>". The verdict uses only the model's
top-1 guess over all 50 signs; closeness compares the attempt with the target's template. For
look-alike pairs the model can rank the target second even when the attempt matches it well.

In practice mode we know what the learner is TRYING to sign, so the decision can use that.
Rules compared (all only upgrade "close" -> "correct"; the target must be in the top 3):
  baseline   target is the top-1 prediction (current app)
  ratio      p(target) >= r * p(top)                  (a prior favouring the intended sign)
  closeness  closeness to the target >= c and no flagged component
  either     ratio OR closeness

Genuine attempts: a clip of sign T judged against target T.
Wrong attempts:   a clip of sign S judged against every other target T that is in its top 3
                  (the only wrong attempts a rule could wrongly accept).
Thresholds are picked on the VAL signers so the share of wrong attempts accepted rises by at
most 1 percentage point over the baseline; results are then reported on the TEST signers.

Run from model/:  python src/eval_target_verdict.py
Output: artifacts/results/target_verdict_eval.json
"""
import json
import os
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
import numpy as np
import tensorflow as tf

import diagnostics as D
import preprocess as P

MODEL_DIR = Path(__file__).resolve().parent.parent
APP_MODELS = MODEL_DIR.parent / "app" / "public" / "models"
TOP_K = 3
MAX_EXTRA_FALSE_ACCEPT = 0.01


def attempts(model, templates, labels, X, y):
    """One row per (clip, target) pair with the target in the clip's top 3."""
    probs = model.predict(X, batch_size=512, verbose=0)
    order = np.argsort(-probs, axis=1)[:, :TOP_K]
    rows = []
    for i, x in enumerate(X.astype(np.float64)):
        top_p = probs[i, order[i, 0]]
        for rank, t in enumerate(order[i]):
            tmpl = templates[labels[t]]
            d = D.diagnose(x, tmpl)
            rows.append((int(y[i] == t), rank, probs[i, t] / top_p, d["closeness"], len(d["issues"]) == 0,
                         int(y[i]), int(t)))
        if y[i] not in order[i]:  # genuine attempt with the target outside the top 3: never accepted
            rows.append((1, TOP_K, 0.0, 0.0, False, int(y[i]), int(y[i])))
    a = np.array(rows, dtype=np.float64)
    return {"genuine": a[:, 0] == 1, "rank": a[:, 1], "ratio": a[:, 2], "close": a[:, 3],
            "clean": a[:, 4] == 1, "sign": a[:, 5].astype(int), "target": a[:, 6].astype(int)}


def rules(a, r=None, c=None):
    base = a["rank"] == 0
    ratio = base | ((a["rank"] < TOP_K) & (a["ratio"] >= r)) if r is not None else None
    close = base | ((a["rank"] < TOP_K) & (a["close"] >= c) & a["clean"]) if c is not None else None
    return base, ratio, close


def rates(a, accept, n_clips):
    g = a["genuine"]
    return {"genuine_accepted": round(float(accept[g].mean()), 4),
            # per clip: share of clips of a DIFFERENT sign that get accepted for some wrong target
            "wrong_accepts_per_clip": round(float(accept[~g].sum() / n_clips), 4)}


def main():
    model = tf.keras.models.load_model(MODEL_DIR / "artifacts" / "models" / "transformer_crop.keras")
    labels = json.loads((APP_MODELS / "labels.json").read_text())
    templates = {k: D.from_json(v) for k, v in json.loads((APP_MODELS / "templates.json").read_text()).items()}
    val, test = np.load(P.OUT_DIR / "dataset_val.npz"), np.load(P.OUT_DIR / "dataset_test.npz")
    av = attempts(model, templates, labels, val["X"], val["y"])
    at = attempts(model, templates, labels, test["X"], test["y"])
    nv, nt = len(val["X"]), len(test["X"])

    base_v = rates(av, rules(av)[0], nv)["wrong_accepts_per_clip"]
    budget = base_v + MAX_EXTRA_FALSE_ACCEPT

    def pick(grid, make):  # loosest threshold that stays within the false-accept budget on val
        best = None
        for v in grid:
            if rates(av, make(v), nv)["wrong_accepts_per_clip"] <= budget:
                best = v
        return best

    r = pick(np.round(np.arange(1.0, 0.0, -0.02), 2), lambda v: rules(av, r=v)[1])
    c = pick(np.arange(100, -1, -2.0), lambda v: rules(av, c=v)[2])
    # closeness may not fit the budget at any threshold; then report it at fixed values to show the cost
    base, ratio, _ = rules(at, r=r)
    tested = [("baseline", base), (f"ratio>={r}", ratio)]
    for cc in ([c] if c is not None else [100, 90]):
        close = rules(at, c=cc)[2]
        tested += [(f"closeness>={cc}", close), (f"ratio>={r} or closeness>={cc}", ratio | close)]

    near = (at["rank"] > 0) & (at["rank"] < TOP_K)  # the target was 2nd or 3rd
    perfect = near & (at["close"] >= 100) & at["clean"]
    out = {"thresholds_chosen_on_val": {"ratio": r, "closeness": c},
           "budget_val_wrong_accepts_per_clip": round(budget, 4),
           "test": {name: rates(at, acc, nt) for name, acc in tested},
           "test_target_2nd_or_3rd": {
               "pairs": int(near.sum()),
               "genuine_share": round(float(at["genuine"][near].mean()), 3),
               "with_closeness_100_and_no_issue": int(perfect.sum()),
               "genuine_share_of_those": round(float(at["genuine"][perfect].mean()), 3)}}

    # which pairs does the baseline miss most often (genuine attempts ranked 2nd/3rd)
    g = at["genuine"] & (at["rank"] > 0) & (at["rank"] < TOP_K)
    miss = {}
    for s in at["sign"][g]:
        miss[labels[s]] = miss.get(labels[s], 0) + 1
    out["test_signs_most_often_ranked_2nd_or_3rd"] = dict(sorted(miss.items(), key=lambda kv: -kv[1])[:10])
    cm = np.load(MODEL_DIR / "artifacts" / "results" / "transformer_crop" / "confusion_matrix.npy")
    off = cm.copy()
    np.fill_diagonal(off, 0)
    pairs = np.dstack(np.unravel_index(np.argsort(-off, axis=None)[:10], off.shape))[0]
    out["top_confusions_true_to_pred"] = [[labels[i], labels[j], int(off[i, j])] for i, j in pairs]

    out["contrast_feedback"] = eval_contrast(model, templates, labels, test["X"], test["y"])
    print(json.dumps(out, indent=1))
    (MODEL_DIR / "artifacts" / "results" / "target_verdict_eval.json").write_text(json.dumps(out, indent=1))


def eval_contrast(model, templates, labels, X, y):
    """Is contrast() feedback pointing at the right thing?

    Scenario: a test clip of sign S that the model reads correctly as S, judged as an attempt at T =
    the model's 2nd guess (the learner was going for T, produced something that reads as S).
    There is no per-clip ground truth for "the part that's wrong", so two checks against the
    templates (built from TRAIN signers, so independent of these clips):
      part     the chosen component is one of the 2 (of 7) where the S and T templates differ most
      way      the hint points from S towards T (the same hint the S template itself would get)
    Compared with the current tip (the worst flagged component of diagnose(x, T)) and with chance.
    Also writes the parity fixture for contrast() in diagnose.js."""
    probs = model.predict(X, batch_size=512, verbose=0)
    order = np.argsort(-probs, axis=1)
    rows = []
    for x, s, (p1, p2) in zip(X.astype(np.float64), y, order[:, :2]):
        if p1 != s:
            continue
        tS, tT = templates[labels[s]], templates[labels[p2]]
        sep = D.deviations(tS["mean"], tT)
        sep = {c: sep[c] / tT["thresholds"][c] for c in D.COMPONENTS}
        top2 = sorted(D.COMPONENTS, key=lambda c: -sep[c])[:2]
        m_s = {k: v["mean"] for k, v in tS["measures"].items()}

        def score(fb):
            if fb is None:
                return (0, 0, 0)
            return (1, int(fb["component"] in top2), int(fb["hint"] == D.hint_for(fb["component"], m_s, tT)))

        current = D.diagnose(x, tT)["issues"]
        rows.append(score(D.contrast(x, tT, tS)) + score(current[0] if current else None))
    a = np.array(rows, dtype=float)

    def summary(cols):
        given = a[:, cols[0]] == 1
        return {"gives_a_tip": round(float(given.mean()), 3),
                "right_part_when_given": round(float(a[given, cols[1]].mean()), 3),
                "right_way_when_given": round(float(a[given, cols[2]].mean()), 3)}

    result = {"cases": len(a), "contrast": summary([0, 1, 2]), "current_tip": summary([3, 4, 5]),
              "chance_right_part": round(2 / len(D.COMPONENTS), 3)}

    # parity fixture for diagnose.js: pairs from the top confusions, plus random second guesses
    rng = np.random.default_rng(1)
    cases = []
    for k in rng.choice(len(X), 20, replace=False):
        t, look = labels[order[k, 1]], labels[order[k, 0]]
        x = np.round(X[k].astype(np.float64), 6)
        cases.append({"target": t, "look": look, "x": x.tolist(), "expected": D.contrast(x, templates[t], templates[look])})
    fx = MODEL_DIR.parent / "app" / "src" / "lib" / "__fixtures__" / "contrast.json"
    fx.write_text(json.dumps(cases))
    result["fixture"] = f"{len(cases)} cases -> {fx.name}"
    return result


if __name__ == "__main__":
    main()
