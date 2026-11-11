// Webcam with the landmark overlay. Mirrored for display only, so it feels like a mirror;
// landmarks are computed on the unmirrored frame, as in training.
// The framing check's advice (lib/framing.js) is shown over the top of the picture.
//
// Controls: before detection starts, a Start button sits over the picture (the learner can get
// into position first, with the skeleton and set-up check already live). Once started, a row
// below has Pause, and Restart when the page passes onRestart (restartLabel names what restarts).
export default function CameraView({ videoRef, canvasRef, status, error, framing, detecting, start, pause, onRestart, restartLabel = "Restart" }) {
  const ready = status === "ready";
  return (
    <div className="camera-block">
      <div className="camera">
        <div className="camera-mirror">
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} />
        </div>
        {ready && framing?.ready && (framing.issue
          ? <p className="framing-tip" role="status">{framing.issue.message}</p>
          : <p className="framing-ok" role="status" aria-label="Camera set-up looks good">✓ Good set-up</p>)}
        {ready && start && !detecting && (
          <div className="camera-start">
            <button type="button" className="button primary start-button" onClick={start}>▶ Start</button>
            <span>Get into position, then press Start.</span>
          </div>
        )}
        {status === "loading" && <p className="camera-message">Starting camera and loading models…</p>}
        {status === "error" && <p className="camera-message error">Camera unavailable: {error}</p>}
      </div>
      {ready && start && detecting && (
        <div className="camera-controls">
          <button type="button" className="button small" onClick={pause}>⏸ Pause</button>
          {onRestart && <button type="button" className="button small" onClick={onRestart}>↺ {restartLabel}</button>}
        </div>
      )}
    </div>
  );
}
