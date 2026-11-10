// MediaPipe hand + pose landmarks in the browser, configured exactly like the Python
// extraction (model/src/extract_popsign.py) so live landmarks match the training data:
// same .task model files, VIDEO mode, 2 hands, thresholds 0.3 / 0.3 / 0.1, pose points 0-24.
import { FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { asset } from "./assets.js";

const N_POSE = 25;
// Pose is detected on every POSE_EVERY-th frame and reused in between. The features only use
// the per-sign median of the shoulders and nose, which barely move: simulated on the val
// signers, accuracy was 91.18% with pose every frame vs 91.14% every 3rd frame (DEVLOG
// 2026-10-25), and pose detection is a large share of the per-frame time.
export const POSE_EVERY = 3;

// Tracking runs on the GPU where available: measured in Chrome on the development laptop, hand
// + pose detection took ~110 ms per frame on the CPU (only ~9 fps) and ~31 ms on the GPU, which
// fits the 67 ms budget for 15 fps (DEVLOG 2026-11-09). Devices without GPU support fall back to
// the CPU delegate. (Training landmarks came from the CPU delegate in Python; the end-to-end
// browser test checks the GPU landmarks give the same accuracy.)
export async function createLandmarkers() {
  try {
    return await createWith("GPU");
  } catch (err) {
    console.warn("MediaPipe GPU delegate unavailable, using the CPU:", err);
    return createWith("CPU");
  }
}

async function createWith(delegate) {
  // runtime files are served from public/mediapipe, so the app works without a CDN
  const fileset = await FilesetResolver.forVisionTasks(asset("mediapipe/wasm"));
  const hands = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: asset("mediapipe/hand_landmarker.task"), delegate },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.1,
  });
  const pose = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: asset("mediapipe/pose_landmarker_lite.task"), delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  return { hands, pose, delegate, frameIndex: 0, lastPose: null };
}

// Run both landmarkers on the current video frame and return one frame in the format
// preprocess.js expects: { hands: [left | null, right | null], pose: points | null }
export function detectFrame(landmarkers, video, timestampMs) {
  const { hands, pose } = landmarkers;
  const frame = { hands: [null, null], pose: null };

  const h = hands.detectForVideo(video, timestampMs);
  h.landmarks.forEach((points, i) => {
    const slot = h.handedness[i][0].categoryName === "Left" ? 0 : 1;
    frame.hands[slot] = points.map((p) => [p.x, p.y, p.z]);
  });

  if (landmarkers.frameIndex++ % POSE_EVERY === 0 || landmarkers.lastPose === null) {
    const p = pose.detectForVideo(video, timestampMs);
    landmarkers.lastPose = p.landmarks.length > 0
      ? p.landmarks[0].slice(0, N_POSE).map((q) => [q.x, q.y, q.z, q.visibility ?? 0])
      : null;
  }
  frame.pose = landmarkers.lastPose;
  return frame;
}
