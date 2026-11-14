import { describe, expect, it } from "vitest";
import { buildLexicon, textToSigns, words } from "./textToSign.js";

const vocab = {
  units: [
    { signs: [{ id: "hello", label: "Hello" }, { id: "thankyou", label: "Thank you" }, { id: "bye", label: "Bye" }] },
    { signs: [{ id: "minemy", label: "Mine / My" }, { id: "hesheit", label: "He / She / It" }, { id: "mom", label: "Mom" }] },
    { signs: [{ id: "dog", label: "Dog" }, { id: "where", label: "Where" }, { id: "hungry", label: "Hungry" }] },
  ],
};
const lexicon = buildLexicon(vocab);
const signs = (text) => textToSigns(text, lexicon).filter((t) => t.signId).map((t) => t.signId);

describe("text to sign", () => {
  it("splits text into lower-case words, ignoring punctuation", () => {
    expect(words("Hello, my MOM! Where's the dog?")).toEqual(["hello", "my", "mom", "wheres", "the", "dog"]);
  });

  it("finds signs by label, label alternative and synonym", () => {
    expect(signs("Hello my mom")).toEqual(["hello", "minemy", "mom"]);
    expect(signs("hi mother, she is hungry")).toEqual(["hello", "mom", "hesheit", "hungry"]);
    expect(signs("me")).toEqual([]); // a different sign from MINE / MY
  });

  it("matches multi-word labels as one sign", () => {
    expect(signs("thank you, bye")).toEqual(["thankyou", "bye"]);
    expect(signs("thanks")).toEqual(["thankyou"]);
  });

  it("accepts plurals", () => {
    expect(signs("dogs")).toEqual(["dog"]);
  });

  it("skips small words ASL leaves out, and reports words it has no sign for", () => {
    const out = textToSigns("Where is the dog? Banana", lexicon);
    expect(out).toEqual([
      { word: "where", signId: "where" },
      { word: "is", skipped: true },
      { word: "the", skipped: true },
      { word: "dog", signId: "dog" },
      { word: "banana", unknown: true },
    ]);
  });
});
