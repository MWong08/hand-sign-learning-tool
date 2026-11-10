import { describe, expect, it } from "vitest";
import parity from "./__fixtures__/parity.json";
import { createFramingMonitor, FRAMING, frameIssues } from "./framing.js";

const SIZE = { width: 640, height: 480 };

// a pose with the nose and shoulders where we want them (other points unused)
function pose({ noseY = 0.35, midX = 0.5, midY = 0.7, width = 0.4, vis = 1 } = {}) {
  const half = (width * SIZE.height) / SIZE.width / 2; // shoulder width given as a share of frame height
  const p = Array.from({ length: 25 }, () => [0.5, 0.5, 0, 1]);
  p[0] = [midX, noseY, 0, vis];
  p[11] = [midX + half, midY, 0, vis];
  p[12] = [midX - half, midY, 0, vis];
  return p;
}
const frame = (opts, hands = [null, null]) => ({ hands, pose: pose(opts) });

describe("frameIssues", () => {
  it("reports nothing for a well-framed learner", () => {
    expect(frameIssues(frame(), SIZE, 120)).toEqual([]);
  });

  it("reports no person when there is no pose", () => {
    expect(frameIssues({ hands: [null, null], pose: null }, SIZE)).toEqual(["noPerson"]);
  });

  it("detects distance problems from shoulder width", () => {
    expect(frameIssues(frame({ width: 0.9 }), SIZE)).toContain("tooClose");
    expect(frameIssues(frame({ width: 0.1 }), SIZE)).toContain("tooFar");
  });

  it("detects the head or shoulders cut off, and being off-centre", () => {
    expect(frameIssues(frame({ noseY: 0.05 }), SIZE)).toContain("headCut");
    expect(frameIssues(frame({ midY: 0.98 }), SIZE)).toContain("shouldersHidden");
    expect(frameIssues(frame({ vis: 0.1 }), SIZE)).toEqual(expect.arrayContaining(["headCut", "shouldersHidden"]));
    expect(frameIssues(frame({ midX: 0.1 }), SIZE)).toContain("offCentre");
  });

  it("detects lighting from brightness", () => {
    expect(frameIssues(frame(), SIZE, 20)).toContain("dark");
    expect(frameIssues(frame(), SIZE, 250)).toContain("bright");
  });

  it("flags a hand at the top or side edge, but not below the picture", () => {
    const at = (x, y) => [[x, y, 0], [0.5, 0.5, 0]];
    expect(frameIssues(frame({}, [null, at(0.5, 0.0)]), SIZE)).toContain("handEdge");
    expect(frameIssues(frame({}, [at(0.999, 0.5), null]), SIZE)).toContain("handEdge");
    expect(frameIssues(frame({}, [null, at(0.5, 1.0)]), SIZE)).not.toContain("handEdge");
  });

  it("never warns on real training-style recordings (PopSign frames)", () => {
    let frames = 0;
    let flagged = 0;
    for (const sample of parity) {
      const size = { width: sample.width, height: sample.height };
      for (const f of sample.frames) {
        if (!f.pose) continue;
        frames++;
        if (frameIssues(f, size).filter((c) => c !== "handEdge").length) flagged++;
      }
    }
    expect(frames).toBeGreaterThan(100);
    expect(flagged).toBe(0);
  });
});

describe("framing monitor", () => {
  const pushN = (m, n, f, luma = 120) => {
    let r;
    for (let i = 0; i < n; i++) r = m.push(f, SIZE, luma);
    return r;
  };

  it("is not ready until a full window has been seen", () => {
    const m = createFramingMonitor();
    expect(pushN(m, FRAMING.windowFrames - 1, frame()).ready).toBe(false);
    expect(pushN(m, 1, frame()).ready).toBe(true);
  });

  it("ignores a brief glitch and reports a lasting problem", () => {
    const m = createFramingMonitor();
    pushN(m, FRAMING.windowFrames, frame());
    expect(pushN(m, 3, frame({ width: 0.1 })).ok).toBe(true);
    const r = pushN(m, FRAMING.windowFrames, frame({ width: 0.1 }));
    expect(r.ok).toBe(false);
    expect(r.issue.code).toBe("tooFar");
  });

  it("clears only after the problem has mostly gone (no flicker)", () => {
    const m = createFramingMonitor();
    pushN(m, FRAMING.windowFrames, frame({ width: 0.1 }));
    expect(pushN(m, 6, frame()).ok).toBe(false); // 9 of 15 still bad
    expect(pushN(m, 6, frame()).ok).toBe(true);  // 3 of 15 bad
  });

  it("shows the most important issue first", () => {
    const m = createFramingMonitor();
    const r = pushN(m, FRAMING.windowFrames, frame({ width: 0.1, midX: 0.1 }), 20);
    expect(r.active).toEqual(["dark", "tooFar", "offCentre"]);
    expect(r.issue.code).toBe("dark");
  });

  it("keeps using the last brightness reading between measurements", () => {
    const m = createFramingMonitor();
    m.push(frame(), SIZE, 20);
    const r = pushN(m, FRAMING.windowFrames, frame(), null);
    expect(r.issue?.code).toBe("dark");
  });
});
