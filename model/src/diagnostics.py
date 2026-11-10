"""Diagnostic feedback: WHICH part of a sign is off, and HOW CLOSE the attempt was (IR FR2).

The classifier only says which sign an attempt looks like. This module compares an attempt
with a per-sign TEMPLATE built from the training signers, one component at a time, so the
feedback is explainable:

  components   thumb, index, middle, ring, pinky   (hand-shape features of that finger's 4 joints)
               position                            (wrist relative to shoulders and to the nose)
               movement                            (the wrist's path over the sign, position removed)

  deviation    mean |attempt - template mean| / template std  (a z-score; 0 = typical signer)

Thresholds are data-driven, not hand-picked: a component is flagged when its deviation is
larger than 95% of real signers' attempts at that sign (the 95th percentile on the validation
signers, who were not used to build the templates).

Directional hints come from simple measures that can be checked against the template:
  finger extension  (fingertip distance from the wrist)      -> "straighten" / "bend"
  height            (wrist height relative to the shoulders) -> "sign higher" / "sign lower"
  distance to face                                           -> "closer to" / "further from your face"
  movement size     (length of the wrist's path)             -> "bigger" / "smaller movement"

Run from model/:  python src/diagnostics.py
  -> ../app/public/models/templates.json   (used by the browser, app/src/lib/diagnose.js)
  -> ../app/src/lib/__fixtures__/diagnostics.json  (parity test for diagnose.js)
  -> artifacts/results/diagnostics_eval.json  (how well the diagnostics behave, for Ch 5)
"""
import json
from pathlib import Path

import numpy as np

MODEL_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = MODEL_DIR / "data" / "processed"
APP_DIR = MODEL_DIR.parent / "app"

FINGERS = ["thumb", "index", "middle", "ring", "pinky"]
# hand-shape features are joints 1..20 relative to the wrist, 3 values each; finger f = joints 4f+1..4f+4
FINGER_COLS = {name: list(range(f * 12, f * 12 + 12)) for f, name in enumerate(FINGERS)}
TIP_COLS = {name: list(range(f * 12 + 9, f * 12 + 12)) for f, name in enumerate(FINGERS)}  # joint 4f+4
LOCATION = [60, 61]   # wrist - shoulder midpoint, in shoulder widths (y grows downwards)
TO_FACE = [62, 63]    # wrist - nose, in shoulder widths
COMPONENTS = FINGERS + ["position", "movement"]
FLAG_PERCENTILE = 95      # tuned on val: 90 flagged 24% of correct attempts, 95 -> 17% (still 72% of wrong ones)
CLOSENESS_ZERO_AT = 1.25  # closeness hits 0 at 1.25 x the 95th percentile (2.0 left wrong signs at a median of 76)
CONTRAST_MIN_GAP = 0.1  # contrast(): ignore parts that fit both signs about equally
EPS = 1e-3


# ---------------------------------------------------------------- measures on one sample (24 x 64)

def movement_path(x):
    """Wrist path over the sign with its average position removed (shape of the movement only)."""
    loc = x[:, LOCATION]
    return loc - loc.mean(axis=0)


def measures(x):
    """Simple interpretable measures used for the directional hints."""
    return {
        **{f"ext_{f}": float(np.linalg.norm(x[:, TIP_COLS[f]], axis=1).mean()) for f in FINGERS},
        "height": float(x[:, LOCATION[1]].mean()),
        "face_dist": float(np.linalg.norm(x[:, TO_FACE], axis=1).mean()),
        "path_len": float(np.linalg.norm(np.diff(x[:, LOCATION], axis=0), axis=1).sum()),
    }


def deviations(x, t):
    """Per-component z-score deviation of sample x from template t."""
    z = np.abs(x - t["mean"]) / (t["std"] + EPS)
    dev = {f: float(z[:, FINGER_COLS[f]].mean()) for f in FINGERS}
    dev["position"] = float(z[:, LOCATION + TO_FACE].mean())
    dev["movement"] = float((np.abs(movement_path(x) - t["path_mean"]) / (t["path_std"] + EPS)).mean())
    return dev


def closeness(dev, t):
    """0-100. 100 when the overall deviation is no worse than a typical (median) real signer,
    falling linearly to 0 at CLOSENESS_ZERO_AT x the 95th percentile of real signers."""
    overall = float(np.mean([dev[c] for c in COMPONENTS]))
    p50, p95 = t["overall_p50"], t["overall_p95"]
    return float(np.clip(100 * (1 - (overall - p50) / (CLOSENESS_ZERO_AT * p95 - p50)), 0, 100))


def hint_for(c, m, t):
    """Which way to change component c of an attempt (measures m) to move towards template t."""
    tm = t["measures"]
    if c in FINGERS:
        return "straighten" if m[f"ext_{c}"] < tm[f"ext_{c}"]["mean"] else "bend"
    if c == "position":
        dh = m["height"] - tm["height"]["mean"]
        df = m["face_dist"] - tm["face_dist"]["mean"]
        # report whichever is further off, in units of its own spread across signers
        if abs(dh) / tm["height"]["std"] >= abs(df) / tm["face_dist"]["std"]:
            return "higher" if dh > 0 else "lower"   # y grows downwards: larger y = hand too low
        return "closer_to_face" if df > 0 else "further_from_face"
    return "bigger" if m["path_len"] < tm["path_len"]["mean"] else "smaller"


def diagnose(x, t):
    """Full diagnosis of one attempt against one sign's template (mirrored in diagnose.js)."""
    dev = deviations(x, t)
    m = measures(x)
    issues = []
    for c in COMPONENTS:
        if dev[c] <= t["thresholds"][c]:
            continue
        issues.append({"component": c, "hint": hint_for(c, m, t), "severity": round(dev[c] / t["thresholds"][c], 3)})
    issues.sort(key=lambda i: -i["severity"])
    return {"closeness": round(closeness(dev, t), 1), "issues": issues}


def contrast(x, t_target, t_look):
    """When an attempt at the target was read as a look-alike sign: the component where the attempt
    fits the look-alike better than the target, and which way to change it (mirrored in diagnose.js).

    Each component's deviation is divided by its own flag threshold, so components and signs are on
    one scale (1.0 = as far off as the worst 5% of real signers). gap = target - look-alike: a large
    positive gap means "this part looks like the other sign". None when no part fits the other sign
    better by at least CONTRAST_MIN_GAP."""
    dt, dl = deviations(x, t_target), deviations(x, t_look)
    gaps = {c: dt[c] / t_target["thresholds"][c] - dl[c] / t_look["thresholds"][c] for c in COMPONENTS}
    c = max(COMPONENTS, key=lambda k: gaps[k])
    if gaps[c] < CONTRAST_MIN_GAP:
        return None
    return {"component": c, "hint": hint_for(c, measures(x), t_target), "gap": round(gaps[c], 3)}


# ---------------------------------------------------------------- building + calibrating templates

def build_template(xs):
    paths = np.stack([movement_path(x) for x in xs])
    ms = [measures(x) for x in xs]
    return {
        "mean": xs.mean(axis=0), "std": xs.std(axis=0),
        "path_mean": paths.mean(axis=0), "path_std": paths.std(axis=0),
        "measures": {k: {"mean": float(np.mean([m[k] for m in ms])), "std": float(np.std([m[k] for m in ms]) + EPS)}
                     for k in ms[0]},
    }


def calibrate(t, xs_val):
    devs = [deviations(x, t) for x in xs_val]
    t["thresholds"] = {c: float(np.percentile([d[c] for d in devs], FLAG_PERCENTILE)) for c in COMPONENTS}
    overall = [np.mean([d[c] for c in COMPONENTS]) for d in devs]
    t["overall_p50"] = float(np.percentile(overall, 50))
    t["overall_p95"] = float(np.percentile(overall, 95))


def to_json(t):
    r = lambda a: np.round(a, 4).tolist()  # noqa: E731
    return {"mean": r(t["mean"]), "std": r(t["std"]), "path_mean": r(t["path_mean"]), "path_std": r(t["path_std"]),
            "measures": t["measures"], "thresholds": t["thresholds"],
            "overall_p50": t["overall_p50"], "overall_p95": t["overall_p95"]}


def from_json(j):
    t = dict(j)
    for k in ("mean", "std", "path_mean", "path_std"):
        t[k] = np.array(j[k], dtype=np.float64)
    return t


def main():
    tr, va, te = (np.load(DATA_DIR / f"dataset_{s}.npz") for s in ("train", "val", "test"))
    signs = [str(s) for s in tr["signs"]]

    templates = {}
    for i, sign in enumerate(signs):
        t = build_template(tr["X"][tr["y"] == i].astype(np.float64))
        calibrate(t, va["X"][va["y"] == i].astype(np.float64))
        templates[sign] = to_json(t)
    # round-trip through JSON so evaluation and the fixture use exactly what the browser gets
    templates = {s: from_json(json.loads(json.dumps(t))) for s, t in templates.items()}
    out = APP_DIR / "public" / "models" / "templates.json"
    out.write_text(json.dumps({s: to_json(t) for s, t in templates.items()}))
    print(f"templates: {out} ({out.stat().st_size / 1e6:.1f} MB)")

    # ---- evaluation on the TEST signers (not used for templates or thresholds)
    rng = np.random.default_rng(0)
    genuine_flag, genuine_close, wrong_flag, wrong_close = [], [], [], []
    for i, sign in enumerate(signs):
        t = templates[sign]
        for x in te["X"][te["y"] == i].astype(np.float64):
            d = diagnose(x, t)
            genuine_flag.append(len(d["issues"]) > 0)
            genuine_close.append(d["closeness"])
        # attempts at OTHER signs judged against this target (stand-in for wrong attempts)
        others = np.flatnonzero(te["y"] != i)
        for x in te["X"][rng.choice(others, 100, replace=False)].astype(np.float64):
            d = diagnose(x, t)
            wrong_flag.append(len(d["issues"]) > 0)
            wrong_close.append(d["closeness"])
    report = {
        "genuine_attempts_with_any_issue": round(float(np.mean(genuine_flag)), 3),
        "genuine_median_closeness": round(float(np.median(genuine_close)), 1),
        "wrong_sign_attempts_with_any_issue": round(float(np.mean(wrong_flag)), 3),
        "wrong_sign_median_closeness": round(float(np.median(wrong_close)), 1),
    }
    (MODEL_DIR / "artifacts" / "results").mkdir(parents=True, exist_ok=True)
    (MODEL_DIR / "artifacts" / "results" / "diagnostics_eval.json").write_text(json.dumps(report, indent=1))
    print("evaluation on test signers:", report)

    # ---- parity fixture for diagnose.js
    cases = []
    for k in rng.choice(len(te["X"]), 20, replace=False):
        target = signs[int(te["y"][k])] if k % 2 == 0 else signs[int(rng.integers(len(signs)))]
        x = te["X"][k].astype(np.float64)
        cases.append({"target": target, "x": np.round(x, 6).tolist(), "expected": diagnose(np.round(x, 6), templates[target])})
    fx = APP_DIR / "src" / "lib" / "__fixtures__" / "diagnostics.json"
    fx.write_text(json.dumps(cases))
    print(f"fixture: {len(cases)} cases -> {fx}")


if __name__ == "__main__":
    main()
