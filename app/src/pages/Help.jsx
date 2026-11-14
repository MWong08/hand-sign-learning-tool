// Getting started (IR NFR "beginner accessibility": usable with no prior signing experience).
export default function Help() {
  return (
    <section className="help">
      <h2>Getting started</h2>

      <h3>1. Set up your camera</h3>
      <ul>
        <li>Make sure your <strong>head, shoulders and signing hand</strong> are all in view. The app measures your hand's position relative to your face and shoulders.</li>
        <li>Use good, even lighting and a plain background if you can.</li>
        <li>On a laptop, sit about an arm's length from the camera. On a phone, prop it up rather than holding it.</li>
        <li>A message over the camera tells you if something needs fixing (too dark, too far, head cut off). When it shows <strong>✓ Good set-up</strong>, you're ready.</li>
      </ul>

      <h3>2. Lessons</h3>
      <p>
        Each unit is split into short <strong>lessons</strong> of 2–4 signs. In a lesson every new sign comes back
        several times: you copy it from the video, pick it out of a few clips, sign it from memory, and use it in a
        phrase. Anything you miss comes back once more at the end.
      </p>
      <p>
        At the end you get <strong>1–3 stars</strong>, XP and a review of every sign. Press
        <strong> 🎬 Compare side by side</strong> to replay your own attempt next to the demo, in step, with the part
        to fix marked in red. Signs you keep finding hard are collected in <strong>Practise weak signs</strong>.
      </p>

      <h3>3. Signing a sign</h3>
      <ol>
        <li>Watch the reference video. It's a Deaf signer performing the sign. It plays a little slower than real
          time; change the speed with <strong>🐢 0.5× / 0.75× / 1×</strong>.</li>
        <li>Get into position (you'll see yourself on the camera), then press <strong>▶ Start</strong>. Nothing is
          checked until you do; <strong>Pause</strong> stops it again, and <strong>Restart</strong> starts the sign,
          phrase or quiz over.</li>
        <li>Raise <strong>one hand</strong> and copy the sign.</li>
        <li><strong>Lower your hand</strong> when you finish. That tells the app the sign is complete.</li>
      </ol>
      <p>
        You'll see whether it was <strong>correct</strong>, <strong>almost there</strong> or <strong>not quite</strong>, a
        <strong> closeness</strong> score (how similar your sign was to how Deaf signers perform it), and up to two
        <strong> things to fix</strong>, such as a finger to straighten, or signing higher or lower.
      </p>
      <p>Get a sign right <strong>twice in a row</strong> to master it. Master every sign in a unit to unlock the next one.</p>

      <h3>4. Phrases and free signing</h3>
      <p>
        Sign the whole phrase in one go, <strong>moving straight from one sign to the next</strong>, the way fluent
        signers do. The app follows along and marks each sign as you make it. If you'd rather go slowly, hold your hand
        still until the ring around 👀 fills (under a second), or lower it, between signs.
      </p>
      <p>
        After a phrase you also get feedback on its <strong>flow</strong>: whether you joined the signs smoothly or
        stopped between them.
      </p>
      <p>
        In <strong>Free signing</strong> the camera stays off until you press <strong>Start free signing</strong>; sign
        any words and they appear as they're recognised.
      </p>
      <p>
        <strong>Text to sign</strong> works the other way round: type a sentence, or drag words from the word bank (tap
        them on a phone), and the app plays the signs one after another. Only the app's words have videos.
      </p>

      <h3>Your preferences</h3>
      <p>
        In <a href="#/settings">More</a> you can set your <strong>dominant hand</strong> (left flips the demo videos
        so the signer uses the same hand as you), start the camera <strong>automatically</strong>, add a
        <strong> 3-2-1 countdown</strong> before each attempt, and choose the <strong>theme</strong> and
        <strong> text size</strong>.
      </p>

      <h3>5. Quiz</h3>
      <p>Sign words from memory. The reference video is shown only after you answer.</p>

      <h3>Good to know</h3>
      <ul>
        <li>The signs are <strong>American Sign Language (ASL)</strong>. Some are shown one-handed, as in the PopSign dataset the app learned from.</li>
        <li>Feedback is a guide, not a teacher's judgement. Regional variants of a sign may be marked as different.</li>
        <li>Everything runs in your browser. No video is uploaded or saved. The replay of your attempt is kept in
          memory only while the lesson is open.</li>
      </ul>
      <p><a className="button primary" href="#/lesson/0/0">Start Lesson 1</a></p>
    </section>
  );
}
