// Curriculum vocabulary (public/vocabulary.json, copied from model/config/vocabulary.json by
// model/src/prepare_app_assets.py, so the app and the model share one source).
import { asset } from "./assets.js";

let cache = null;

export async function loadVocabulary() {
  if (!cache) cache = await fetch(asset("vocabulary.json")).then((r) => r.json());
  return cache;
}

export const referenceVideo = (signId) => asset(`reference/${signId}.mp4`);

// sign id -> display label, e.g. "thankyou" -> "Thank you"
export function labelOf(vocab, signId) {
  for (const unit of vocab.units) {
    const sign = unit.signs.find((s) => s.id === signId);
    if (sign) return sign.label;
  }
  return signId;
}
