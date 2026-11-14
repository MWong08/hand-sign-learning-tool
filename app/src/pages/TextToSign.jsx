// Text to sign: the learner builds a sentence and watches it signed, one reference clip after
// another. Two ways in, since only the curriculum's words have videos:
//   - type a sentence: it is matched to signs (lib/textToSign.js), skipping small words ASL leaves
//     out and listing any word with no sign;
//   - drag words from the word bank into the sentence (or tap them, which also works on phones,
//     where drag and drop isn't available). Words in the sentence can be dragged to reorder,
//     dragged back to the bank (or ×) to remove, and tapped to play from there.
import { useEffect, useMemo, useRef, useState } from "react";
import { SpeedSwitch, usePreference, useVideoSpeed } from "../components/ui.jsx";
import { buildLexicon, textToSigns } from "../lib/textToSign.js";
import { labelOf, referenceVideo } from "../lib/vocabulary.js";

const EXAMPLES = ["Hello, my mom", "Where is the dog?", "Dad is thirsty, drink water", "Thank you, bye"];
let nextKey = 1; // each word in the sentence gets its own key, so the same sign can appear twice
const item = (signId) => ({ key: nextKey++, signId });

export default function TextToSign({ vocab, progress }) {
  const lexicon = useMemo(() => buildLexicon(vocab), [vocab]);
  const [text, setText] = useState("");
  const [notes, setNotes] = useState(null); // { skipped: [...], unknown: [...] } from the last typed text
  const [sentence, setSentence] = useState([]);
  const [filter, setFilter] = useState("");
  const [over, setOver] = useState(null); // drop highlight: "sentence" | "bank" | null
  const player = useSentencePlayer(sentence);

  const show = (value) => {
    const tokens = textToSigns(value, lexicon);
    const list = tokens.filter((t) => t.signId).map((t) => item(t.signId));
    setSentence(list);
    setNotes({ skipped: tokens.filter((t) => t.skipped).map((t) => t.word), unknown: tokens.filter((t) => t.unknown).map((t) => t.word) });
    player.restart();
    progress.logAction("text-to-sign", "translate");
  };
  const submit = (e) => {
    e.preventDefault();
    show(text);
  };

  const add = (signId, at = sentence.length) => {
    setSentence((s) => [...s.slice(0, at), item(signId), ...s.slice(at)]);
    setNotes(null);
  };
  const remove = (k) => setSentence((s) => s.filter((_, i) => i !== k));
  const move = (from, to) => setSentence((s) => {
    const list = [...s];
    const [w] = list.splice(from, 1);
    list.splice(from < to ? to - 1 : to, 0, w);
    return list;
  });
  const clear = () => {
    setSentence([]);
    setNotes(null);
    setText("");
  };

  // drag and drop: the dragged word travels as JSON { signId } (from the bank) or { from } (a
  // position in the sentence)
  const drag = (data) => (e) => {
    e.dataTransfer.setData("text/plain", JSON.stringify(data));
    e.dataTransfer.effectAllowed = "copyMove";
  };
  const read = (e) => {
    try { return JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return null; }
  };
  const dropOnSentence = (at) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    const d = read(e);
    if (!d) return;
    if (d.signId) add(d.signId, at ?? sentence.length);
    else if (Number.isInteger(d.from)) move(d.from, at ?? sentence.length);
  };
  const dropOnBank = (e) => {
    e.preventDefault();
    setOver(null);
    const d = read(e);
    if (Number.isInteger(d?.from)) remove(d.from);
  };
  const allowDrop = (zone) => (e) => {
    e.preventDefault();
    if (over !== zone) setOver(zone);
  };

  const q = filter.trim().toLowerCase();
  const gloss = sentence.map((w) => labelOf(vocab, w.signId)).join(" · ");

  return (
    <section className="text-to-sign">
      <h1>Text to sign</h1>
      <p className="muted">
        Type a sentence, or drag words into it, to see it signed. Only the app's {vocab.units.reduce((n, u) => n + u.signs.length, 0)} words
        have videos, and small words like “is” and “the” are left out, as they usually are in ASL.
      </p>

      <form className="tts-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="tts-text">Sentence</label>
        <input id="tts-text" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Hello, my mom" autoComplete="off" />
        <button type="submit" className="button primary" disabled={!text.trim()}>Show signs</button>
      </form>
      <p className="tts-examples">
        <span className="muted">Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="chip" onClick={() => { setText(ex); show(ex); }}>{ex}</button>
        ))}
      </p>
      {notes && (notes.unknown.length > 0 || notes.skipped.length > 0) && (
        <p className="tts-notes" role="status">
          {notes.unknown.length > 0 && <>No sign in this app for: <strong>{notes.unknown.join(", ")}</strong>. </>}
          {notes.skipped.length > 0 && <span className="muted">Left out: {notes.skipped.join(", ")}.</span>}
        </p>
      )}

      <div className="tts-main">
        <div className="tts-left">
          <div className={`tts-sentence ${over === "sentence" ? "over" : ""}`} onDragOver={allowDrop("sentence")}
            onDragLeave={() => setOver(null)} onDrop={dropOnSentence(null)} aria-label="Your sentence">
            {sentence.length === 0 && <span className="muted">Drag words here, or tap them in the word bank below.</span>}
            {sentence.map((w, i) => (
              <span key={w.key} className={`tts-word ${i === player.index && player.playing ? "current" : ""}`} draggable
                onDragStart={drag({ from: i })} onDragOver={(e) => e.preventDefault()} onDrop={dropOnSentence(i)}>
                <button type="button" className="tts-word-play" onClick={() => player.playFrom(i)} aria-label={`Play from ${labelOf(vocab, w.signId)}`}>
                  {labelOf(vocab, w.signId)}
                </button>
                <button type="button" className="tts-word-remove" onClick={() => remove(i)} aria-label={`Remove ${labelOf(vocab, w.signId)}`}>×</button>
              </span>
            ))}
          </div>
          {sentence.length > 0 && <button type="button" className="link-button tts-clear" onClick={clear}>Clear sentence</button>}
        </div>

        <SentencePlayer vocab={vocab} sentence={sentence} gloss={gloss} {...player} />

        <div className={`card tts-bank ${over === "bank" ? "over" : ""}`} onDragOver={allowDrop("bank")} onDragLeave={() => setOver(null)} onDrop={dropOnBank}>
          <div className="tts-bank-head">
            <h2>Word bank</h2>
            <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a word" aria-label="Find a word" />
          </div>
          {vocab.units.map((unit) => {
            const signs = unit.signs.filter((s) => !q || s.label.toLowerCase().includes(q));
            if (signs.length === 0) return null;
            return (
              <div key={unit.id} className="tts-group">
                <h3>{unit.title}</h3>
                <div className="tts-chips">
                  {signs.map((s) => (
                    <button key={s.id} type="button" className="chip tts-bank-word" draggable onDragStart={drag({ signId: s.id })}
                      onClick={() => add(s.id)} aria-label={`Add ${s.label}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// which clip of the sentence is playing, and whether it plays on or stops at the end
function useSentencePlayer(sentence) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = usePreference("tts-loop", true);
  const n = sentence.length;
  // words removed: keep the position inside the sentence
  useEffect(() => {
    if (index >= n) setIndex(Math.max(0, n - 1));
  }, [n, index]);
  const restart = () => {
    setIndex(0);
    setPlaying(true);
  };
  const playFrom = (i) => {
    setIndex(i);
    setPlaying(true);
  };
  const ended = () => {
    if (index < n - 1) setIndex(index + 1);
    else if (loop) setIndex(0);
    else setPlaying(false);
  };
  const toggle = () => {
    if (!playing && !loop && index === n - 1) setIndex(0); // finished: play again from the start
    setPlaying(!playing);
  };
  return { index: Math.min(index, Math.max(0, n - 1)), playing, loop, setLoop, restart, playFrom, ended, toggle };
}

function SentencePlayer({ vocab, sentence, gloss, index, playing, loop, setLoop, ended, toggle }) {
  const [speed, setSpeed] = useVideoSpeed();
  const [mirror, setMirror] = usePreference("video-mirror", false);
  const videoRef = useRef(null);
  const current = sentence[index];
  const following = sentence[index + 1] ?? (loop ? sentence[0] : null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, speed, current?.key]);

  return (
    <figure className="reference tts-player">
      {current ? (
        <>
          <span className="phrase-next">{labelOf(vocab, current.signId)} <span className="muted">({index + 1} of {sentence.length})</span></span>
          {/* a new element per word restarts the clip; a single word loops on its own */}
          <video ref={videoRef} key={`${current.key}-${index}`} className={mirror ? "mirrored" : ""} src={referenceVideo(current.signId)}
            muted playsInline autoPlay={playing} loop={sentence.length === 1 && loop}
            onLoadedData={(e) => { e.currentTarget.playbackRate = speed; }} onEnded={ended} />
          {/* fetch the next clip early, so the change is smooth */}
          {following && following.key !== current.key && <link rel="preload" as="video" href={referenceVideo(following.signId)} />}
        </>
      ) : (
        <div className="tts-empty"><span aria-hidden="true">🤟</span>The signs will play here.</div>
      )}
      <div className="video-controls">
        <button type="button" className="button small" onClick={toggle} disabled={!current}>{playing ? "⏸ Pause" : "▶ Play"}</button>
        <button type="button" className={`chip ${loop ? "on" : ""}`} aria-pressed={loop} onClick={() => setLoop(!loop)}>🔁 Repeat</button>
        <SpeedSwitch speed={speed} setSpeed={setSpeed} />
        <button type="button" className={`chip ${mirror ? "on" : ""}`} aria-pressed={mirror} onClick={() => setMirror(!mirror)}>⇆ Mirror</button>
      </div>
      <figcaption>
        {gloss && <span className="phrase-gloss">{sentence.map((w, k) => <span key={w.key} className={k === index ? "current" : ""}>{labelOf(vocab, w.signId)}</span>)}</span>}
        Clips: PopSign ASL v1.0 (Georgia Tech / DPAN), CC BY 4.0
      </figcaption>
    </figure>
  );
}
