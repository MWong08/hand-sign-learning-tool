"""Train and compare sequence models for isolated sign recognition (CRISP-DM: Modelling + Evaluation).

Every model gets identical treatment so the comparison is fair:
  - input: (24 frames, 64 features) from preprocess.py
  - the same first layers: a Normalization layer (train-set mean/std, saved inside the model so
    the browser needn't repeat it) and GaussianNoise (light augmentation, active only in training)
  - the same optimiser, batch size, class weights, early stopping on validation accuracy
  - the test set is used once per model, after training, never for choosing anything

Model choice is made on validation results; the test set reports the final numbers.

Run from model/:
  python src/train.py                      # all models
  python src/train.py --models gru lstm    # some models
  python src/train.py --models transformer --augment-crop   # + phrase-style crops (make_crop_augmentation.py)
Outputs: artifacts/models/{name}.keras, artifacts/results/model_comparison.csv, per-model reports
"""
import argparse
import json
import os
import time
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
import numpy as np
import tensorflow as tf
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.utils.class_weight import compute_class_weight

MODEL_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = MODEL_DIR / "data" / "processed"
MODELS_OUT = MODEL_DIR / "artifacts" / "models"
RESULTS_OUT = MODEL_DIR / "artifacts" / "results"
SEED = 42


def load(split):
    d = np.load(DATA_DIR / f"dataset_{split}.npz")
    return d["X"], d["y"], list(d["signs"])


# ---------------------------------------------------------------- models

def stem(x_train, inputs):
    """Shared first layers for every model."""
    norm = tf.keras.layers.Normalization(axis=-1)
    norm.adapt(x_train.reshape(-1, x_train.shape[-1]))
    x = norm(inputs)
    return tf.keras.layers.GaussianNoise(0.05)(x)


def build_gru(x_train, n_classes):
    inp = tf.keras.Input(x_train.shape[1:])
    x = stem(x_train, inp)
    x = tf.keras.layers.GRU(128)(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    return tf.keras.Model(inp, tf.keras.layers.Dense(n_classes, activation="softmax")(x), name="gru")


def build_lstm(x_train, n_classes):
    inp = tf.keras.Input(x_train.shape[1:])
    x = stem(x_train, inp)
    x = tf.keras.layers.LSTM(128)(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    return tf.keras.Model(inp, tf.keras.layers.Dense(n_classes, activation="softmax")(x), name="lstm")


def build_cnn_lstm(x_train, n_classes):
    """The IR's proposed hybrid: 1D convolutions pick up short motion patterns over a few
    frames, then an LSTM models how they unfold over the whole sign."""
    inp = tf.keras.Input(x_train.shape[1:])
    x = stem(x_train, inp)
    for filters in (64, 128):
        x = tf.keras.layers.Conv1D(filters, 3, padding="same", activation="relu")(x)
        x = tf.keras.layers.BatchNormalization()(x)
    x = tf.keras.layers.LSTM(128)(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    return tf.keras.Model(inp, tf.keras.layers.Dense(n_classes, activation="softmax")(x), name="cnn_lstm")


def build_bilstm_popsign(x_train, n_classes):
    """Reference model from the PopSign v1.0 paper: 2 x BiLSTM(128) -> Dropout(0.5) -> softmax."""
    inp = tf.keras.Input(x_train.shape[1:])
    x = stem(x_train, inp)
    x = tf.keras.layers.Bidirectional(tf.keras.layers.LSTM(128, return_sequences=True))(x)
    x = tf.keras.layers.Bidirectional(tf.keras.layers.LSTM(128))(x)
    x = tf.keras.layers.Dropout(0.5)(x)
    return tf.keras.Model(inp, tf.keras.layers.Dense(n_classes, activation="softmax")(x), name="bilstm_popsign")


def build_transformer(x_train, n_classes, d_model=128, heads=4, blocks=2):
    """Small Transformer encoder: self-attention lets every frame look at every other frame,
    instead of reading the sequence step by step like an RNN."""
    inp = tf.keras.Input(x_train.shape[1:])
    x = stem(x_train, inp)
    x = tf.keras.layers.Dense(d_model)(x)
    positions = tf.keras.layers.Embedding(x_train.shape[1], d_model)(tf.range(x_train.shape[1]))
    x = x + positions  # attention has no sense of order on its own
    for _ in range(blocks):
        attn = tf.keras.layers.MultiHeadAttention(heads, d_model // heads, dropout=0.1)(x, x)
        x = tf.keras.layers.LayerNormalization()(x + attn)
        ff = tf.keras.layers.Dense(d_model * 2, activation="relu")(x)
        ff = tf.keras.layers.Dense(d_model)(ff)
        x = tf.keras.layers.LayerNormalization()(x + tf.keras.layers.Dropout(0.1)(ff))
    x = tf.keras.layers.GlobalAveragePooling1D()(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    return tf.keras.Model(inp, tf.keras.layers.Dense(n_classes, activation="softmax")(x), name="transformer")


BUILDERS = {
    "gru": build_gru,
    "lstm": build_lstm,
    "cnn_lstm": build_cnn_lstm,
    "bilstm_popsign": build_bilstm_popsign,
    "transformer": build_transformer,
}


# ---------------------------------------------------------------- training + evaluation

def latency_ms(model, sample, runs=200):
    """Mean time for one prediction (batch of 1), as the app will run it every few frames.
    Measured in Python on this CPU; browser (TF.js) timing is measured separately later."""
    fn = tf.function(lambda x: model(x, training=False))
    x = tf.constant(sample[None])
    fn(x)  # warm-up (graph tracing)
    start = time.perf_counter()
    for _ in range(runs):
        fn(x)
    return (time.perf_counter() - start) / runs * 1000


def train_one(name, data, epochs, batch_size, save_name=None):
    (x_tr, y_tr), (x_va, y_va), (x_te, y_te), signs = data
    save_name = save_name or name
    tf.keras.utils.set_random_seed(SEED)
    model = BUILDERS[name](x_tr, len(signs))
    model.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
                  loss="sparse_categorical_crossentropy",
                  metrics=["accuracy", tf.keras.metrics.SparseTopKCategoricalAccuracy(3, name="top3")])

    # class weights: signs with fewer training videos (e.g. think: 148 vs 250) count a bit more
    weights = compute_class_weight("balanced", classes=np.arange(len(signs)), y=y_tr)
    callbacks = [
        tf.keras.callbacks.EarlyStopping("val_accuracy", patience=10, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau("val_loss", factor=0.5, patience=4),
    ]
    start = time.time()
    hist = model.fit(x_tr, y_tr, validation_data=(x_va, y_va), epochs=epochs, batch_size=batch_size,
                     class_weight=dict(enumerate(weights)), callbacks=callbacks, verbose=2)
    train_min = (time.time() - start) / 60

    _, val_acc, val_top3 = model.evaluate(x_va, y_va, verbose=0)
    probs = model.predict(x_te, verbose=0)
    pred = probs.argmax(axis=1)
    top3 = np.mean([y in p for y, p in zip(y_te, np.argsort(-probs, axis=1)[:, :3])])

    MODELS_OUT.mkdir(parents=True, exist_ok=True)
    path = MODELS_OUT / f"{save_name}.keras"
    model.save(path)

    out = RESULTS_OUT / save_name
    out.mkdir(parents=True, exist_ok=True)
    (out / "classification_report.txt").write_text(
        classification_report(y_te, pred, target_names=signs, digits=3), encoding="utf-8")
    np.save(out / "confusion_matrix.npy", confusion_matrix(y_te, pred, labels=np.arange(len(signs))))
    (out / "history.json").write_text(json.dumps({k: [float(v) for v in vs] for k, vs in hist.history.items()}))

    return {
        "model": save_name,
        "params": model.count_params(),
        "size_kb": round(path.stat().st_size / 1024),
        "epochs": len(hist.history["loss"]),
        "train_min": round(train_min, 1),
        "val_acc": round(val_acc, 4),
        "test_acc": round(float((pred == y_te).mean()), 4),
        "test_top3": round(float(top3), 4),
        "test_macro_f1": round(float(f1_score(y_te, pred, average="macro")), 4),
        "latency_ms": round(latency_ms(model, x_te[0]), 2),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=list(BUILDERS))
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--augment-crop", action="store_true",
                    help="also train on dataset_train_crop.npz (phrase-style cropped copies); saved as <model>_crop")
    args = ap.parse_args()

    x_tr, y_tr, signs = load("train")
    if args.augment_crop:
        x_aug, y_aug, _ = load("train_crop")
        x_tr, y_tr = np.concatenate([x_tr, x_aug]), np.concatenate([y_tr, y_aug])
    x_va, y_va, _ = load("val")
    x_te, y_te, _ = load("test")
    data = ((x_tr, y_tr), (x_va, y_va), (x_te, y_te), signs)
    print(f"train {x_tr.shape}, val {x_va.shape}, test {x_te.shape}, {len(signs)} classes")

    RESULTS_OUT.mkdir(parents=True, exist_ok=True)
    table = RESULTS_OUT / "model_comparison.csv"
    for name in args.models:
        print(f"\n===== {name} =====")
        row = train_one(name, data, args.epochs, args.batch_size,
                        save_name=f"{name}_crop" if args.augment_crop else name)
        print(row)
        new = not table.exists()
        with open(table, "a", encoding="utf-8") as f:
            if new:
                f.write(",".join(row) + "\n")
            f.write(",".join(str(v) for v in row.values()) + "\n")


if __name__ == "__main__":
    main()
