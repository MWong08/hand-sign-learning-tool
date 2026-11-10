# Interactive Hand Sign Learning Tool — Development

Real-time dynamic ASL sign recognition with diagnostic feedback, delivered as a browser-based
curriculum. FYP (APU, CS(AI)), Wong Zhi Xian TP070421.

## Layout

```
model/        Python: data preparation, model training and evaluation, export to TF.js
  config/     vocabulary.json: the 50 signs in 8 units + phrases (single source for model and app)
  src/        scripts (run from model/)
  tools/      verify_tfjs: checks exported models give the same outputs in TF.js
  data/       raw + processed data (git-ignored)
  artifacts/  trained models, results (git-ignored)
app/          React + Vite web app
  src/lib/    pure logic (preprocessing, segmentation, diagnosis, curriculum rules, storage), unit-tested
  src/pages/  screens; src/hooks/ camera pipeline, progress, routing
  scripts/    evaluation scripts that run the app's own code (phrases, end-to-end browser test)
  public/     models, MediaPipe runtime, reference videos, vocabulary
docs/         DEVLOG.md: every decision, alternative and result (feeds FYP report Ch 4–6)
```

## How it works

```
webcam ─> MediaPipe Hand + Pose landmarks (15 fps; pose every 3rd frame)
       ─> attempt recorder (single sign: hand raised → lowered)  or  pause segmenter (phrases)
       ─> preprocessing: trim → signing hand (mirror left-handers) → 64 features/frame → 24 frames
       ─> TF.js Transformer (transformer_crop) → probability of each of the 50 signs
       ─> verdict vs target (correct / close / incorrect)
       ─> diagnosis vs that sign's template: closeness 0-100 + what to fix (finger / position / movement)
       ─> saved to IndexedDB → mastery (2 correct in a row) → units unlock in order
```

## Rebuilding everything from scratch (maintenance notes)

Model side, from `model/` with the venv active (`python -m venv .venv`, `.venv\Scripts\activate`,
`pip install -r requirements.txt`, then the `--no-deps` line in requirements.txt for the TF.js converter):

| Step | Command | Output | Time |
|---|---|---|---|
| 1. Extract landmarks (streams PopSign videos, keeps landmarks only) | `python src/extract_popsign.py --workers 8` | `data/processed/landmarks/` | ~14 h, resumable |
| 2. Data-quality report | `python src/check_landmarks.py` | `data/processed/quality_report.csv` | 1 min |
| 3. Build datasets (preprocessing) | `python src/preprocess.py` | `data/processed/dataset_*.npz` | 1 min |
| 4. Phrase-style augmentation | `python src/make_crop_augmentation.py` | `dataset_train_crop.npz` | 1 min |
| 5. Train + compare models | `python src/train.py` and `python src/train.py --models transformer --augment-crop` | `artifacts/models/`, `artifacts/results/model_comparison.csv` | ~45 min |
| 6. Export to TF.js | `python src/export_tfjs.py` | `../app/public/models/transformer_crop/` | 1 min |
| 7. Diagnostic templates | `python src/diagnostics.py` | `../app/public/models/templates.json` | 1 min |
| 8. Reference videos + vocabulary | `python src/prepare_app_assets.py` | `../app/public/reference/`, `vocabulary.json` | 1 min |
| 9. Test fixtures for the app | `python src/export_parity_fixture.py` | `../app/src/lib/__fixtures__/` | <1 min |
| 10. Phrase evaluation sets | `python src/make_phrase_eval.py` (`--split val` for tuning) | `data/processed/phrase_eval*.json` | 1 min |

Experiments (feasibility, DEVLOG 2026-11-08): `python src/eval_continuous.py` (phrases without pauses, sliding window)
and `python src/eval_rejection.py` (unknown-sign rejection; needs 17 extra signs extracted with `--out-dir data/processed/landmarks_oov`).

Check the TF.js export: `cd tools/verify_tfjs && npm install && npm run verify`.

Data: PopSign ASL v1.0 (Georgia Tech / DPAN), CC BY 4.0, https://signdata.cc.gatech.edu. No account needed.
(`src/download_metadata.py` is from the earlier Kaggle plan and is no longer used; see DEVLOG 2026-10-05.)

## User testing (UAT)

Settings → **User testing**: enter a participant code (P01), start the session, hand over the device, and press
**End session and download data** afterwards. One CSV per participant (screens visited, attempts, verdicts, tips,
camera set-up problems, time from start). The camera shows set-up advice (too dark, too far, head cut off) throughout.

## Running the app

```
cd app
npm install
npm run dev        # open http://localhost:5173 and allow the camera
npm test           # 94 unit tests: parity with Python, segmenter, diagnosis, framing, curriculum rules, storage, UAT
npm run build      # production build in app/dist (static files; host anywhere)
```

Evaluation scripts (from `app/`, using the app's own code):

```
node scripts/eval_phrases.mjs transformer_crop test     # phrase recognition (WER) on test-signer phrases
FFMPEG=<path to ffmpeg> node scripts/e2e_signs.mjs 2     # live browser pipeline with a fake camera (dev server running)
FFMPEG=<path to ffmpeg> node scripts/e2e_uat.mjs         # framing check + a full UAT session, fake camera
```

The app needs `public/models/` (steps 6–7), `public/reference/` (step 8) and `public/mediapipe/` (`.task` files
plus the MediaPipe WASM runtime, copied from `node_modules/@mediapipe/tasks-vision/wasm`).
