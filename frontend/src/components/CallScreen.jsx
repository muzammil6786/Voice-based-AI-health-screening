import { useEffect, useRef } from "react";
import HeartLine from "./HeartLine.jsx";

const FIELD_LABELS = [
  ["name", "Name"],
  ["mainConcern", "Main concern"],
  ["duration", "Duration"],
  ["severity", "Severity"],
];

function fmt(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return v;
}

export default function CallScreen({ session }) {
  const {
    log,
    collected,
    aiSpeaking,
    recording,
    processing,
    error,
    startRecording,
    stopRecording,
    endCall,
    connectionState,
    speechSupported,
    retryConnection,
  } = session;

  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const canTalk = connectionState === "open" && !processing && speechSupported;

  const hint =
    connectionState === "connecting"
      ? "Connecting…"
      : processing
        ? "Thinking…"
        : aiSpeaking
          ? "Tap and hold to jump in"
          : recording
            ? "Recording — release to send"
            : "Hold to talk";

  console.log({
    connectionState,
    processing,
    speechSupported,
    canTalk,
    recording,
    aiSpeaking,
  });

  return (
    <>
      {error && (
        <div className="error-banner">
          {error}
          {connectionState === "closed" && (
            <button className="retry-link" onClick={retryConnection}>
              Retry
            </button>
          )}
        </div>
      )}

      <div className="call-layout">
        <section className="transcript-panel">
          <div className="panel-label">Transcript</div>
          <div className="transcript-log">
            {log.length === 0 && (
              <div style={{ color: "rgba(238,237,228,0.4)", fontSize: 13 }}>
                {connectionState === "connecting"
                  ? "Connecting to the call…"
                  : "Waiting for the call to begin…"}
              </div>
            )}
            {log.map((entry, i) => (
              <div key={i} className={`log-entry ${entry.speaker}`}>
                <div className="who">
                  {entry.speaker === "ai" ? "Screening AI" : "You"}
                </div>
                <div className="text">{entry.text}</div>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>

        <section className="call-controls">
          <div className="pulse-wrap">
            <div
              className={`pulse-ring${recording || aiSpeaking ? " animating" : ""}`}
            />
            <button
              type="button"
              className={`talk-btn${recording ? " recording" : ""}`}
              disabled={!canTalk}
              onPointerDown={(e) => {
                e.preventDefault();
                startRecording();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                stopRecording();
              }}
              onPointerCancel={() => {
                if (recording) {
                  stopRecording();
                }
              }}
            >
              {recording ? "Release to send" : "Hold to talk"}
            </button>
          </div>

          <HeartLine active={recording || aiSpeaking} />
          <div className="turn-hint">{hint}</div>

          <button className="end-call-btn" onClick={endCall}>
            End call
          </button>

          {collected && (
            <div className="field-sheet" style={{ width: "100%" }}>
              {FIELD_LABELS.map(([key, label]) => (
                <div className="field-row" key={key}>
                  <span className="k">{label}</span>
                  <span className="v">{fmt(collected[key])}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
