// Text to sign: turns typed English into the curriculum's signs, in order, so the app can play
// their videos (pages/TextToSign.jsx).
//
// Matching, word by word, longest first (so "thank you" is one sign, not two):
//   - a sign's label, or any of its alternatives ("Mine / My" -> "mine" or "my");
//   - a few synonyms signed the same way (SYNONYMS), e.g. "hi" -> Hello, "mother" -> Mom;
//   - a plural, by dropping a final "s" ("dogs" -> Dog).
// Small words that ASL usually leaves out ("is", "the", "a", ...) are reported as skipped, and any
// other word is reported as not in the vocabulary (only the 50 signs have videos).

// extra words for a sign, beyond its label (sign id -> words)
// Only words signed the SAME way in ASL: e.g. "me" (point at yourself) is not MINE/MY, and
// "house" is not HOME, so those are left as "not in the vocabulary" rather than show a wrong sign.
export const SYNONYMS = {
  hello: ["hi"],
  bye: ["goodbye", "good bye"],
  thankyou: ["thanks", "thank u"],
  mom: ["mother", "mum", "mommy", "mummy", "mama"],
  dad: ["father", "daddy", "papa"],
  grandma: ["grandmother", "granny"],
  grandpa: ["grandfather", "grandad", "granddad"],
  hesheit: ["him"],
  sick: ["ill"],
  food: ["eat"], // EAT and FOOD are one sign
};

// words ASL normally drops (articles, "to be", ...): left out without a warning
export const SKIPPED = new Set(["a", "an", "the", "is", "are", "am", "was", "were", "be", "to", "do", "does", "did", "and", "of"]);

const MAX_WORDS = 3; // the longest match tried ("he she it", "thank you")

// lower case, letters and digits only, split into words
export function words(text) {
  return text.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter(Boolean);
}

// "words words" -> sign id, from every label, label alternative, sign id and synonym
export function buildLexicon(vocab) {
  const lexicon = new Map();
  const add = (phrase, id) => {
    const key = words(phrase).join(" ");
    if (key && !lexicon.has(key)) lexicon.set(key, id);
  };
  for (const unit of vocab.units) {
    for (const sign of unit.signs) {
      add(sign.label, sign.id);
      sign.label.split("/").forEach((part) => add(part, sign.id));
      add(sign.id, sign.id);
    }
  }
  for (const [id, extra] of Object.entries(SYNONYMS)) extra.forEach((w) => add(w, id));
  return lexicon;
}

// text -> [{ word, signId } | { word, skipped: true } | { word, unknown: true }], in order
export function textToSigns(text, lexicon) {
  const list = words(text);
  const out = [];
  for (let i = 0; i < list.length;) {
    let found = null;
    for (let n = Math.min(MAX_WORDS, list.length - i); n >= 1 && !found; n--) {
      const phrase = list.slice(i, i + n).join(" ");
      const id = lexicon.get(phrase) ?? (n === 1 && phrase.length > 3 && phrase.endsWith("s") ? lexicon.get(phrase.slice(0, -1)) : undefined);
      if (id) found = { word: phrase, signId: id, length: n };
    }
    if (found) {
      out.push({ word: found.word, signId: found.signId });
      i += found.length;
    } else {
      out.push(SKIPPED.has(list[i]) ? { word: list[i], skipped: true } : { word: list[i], unknown: true });
      i += 1;
    }
  }
  return out;
}
