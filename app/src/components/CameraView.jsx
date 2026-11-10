// Webcam with the landmark overlay. Mirrored for display only, so it feels like a mirror;
// landmarks are computed on the unmirrored frame, as in training.
// The framing check's advice (lib/framing.js) is shown over the top of the picture.
export default function CameraView({ videoRef, canvasRef, status, error, framing }) {
  return (
    <div className="camera">
      <div className="camera-mirror">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
      </div>
      {status === "ready" && framing?.ready && (framing.issue
        ? <p className="framing-tip" role="status">{framing.issue.message}</p>
        : <p className="framing-ok" role="status" aria-label="Camera set-up looks good">✓ Good set-up</p>)}
      {status === "loading" && <p className="camera-message">Starting camera and loading models…</p>}
      {status === "error" && <p className="camera-message error">Camera unavailable: {error}</p>}
    </div>
  );
}
