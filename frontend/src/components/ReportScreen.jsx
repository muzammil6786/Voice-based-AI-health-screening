function fmt(v) {
  return v === null || v === undefined || v === "" ? "Not stated" : v;
}

export default function ReportScreen({ report, loading, onRestart }) {
  if (loading || !report) {
    return <div className="processing-note">Compiling the screening report…</div>;
  }

  const {
    patientName,
    mainConcern,
    symptoms = [],
    duration,
    severity,
    flaggedForFollowUp = [],
    summary,
    completeness,
  } = report;

  return (
    <div className="report-sheet">
      <div className="chart-eyebrow">
        <span>Screening report</span>
        <span>{new Date().toLocaleDateString()}</span>
      </div>
      <h2>{fmt(patientName) === "Not stated" ? "Unnamed patient" : patientName}</h2>
      <div className="completeness-tag">{completeness || "unknown"} call</div>

      <div className="report-section">
        <div className="label">Main concern</div>
        <div className="body-text">{fmt(mainConcern)}</div>
      </div>

      <div className="report-section">
        <div className="label">Duration</div>
        <div className="body-text">{fmt(duration)}</div>
      </div>

      <div className="report-section">
        <div className="label">Severity</div>
        <div className="body-text">{fmt(severity)}</div>
      </div>

      <div className="report-section">
        <div className="label">Symptoms mentioned</div>
        <div className="chip-row">
          {symptoms.length ? (
            symptoms.map((s, i) => (
              <span className="chip" key={i}>
                {s}
              </span>
            ))
          ) : (
            <span className="body-text">None recorded</span>
          )}
        </div>
      </div>

      <div className="report-section">
        <div className="label">Flagged for follow-up</div>
        <div className="chip-row">
          {flaggedForFollowUp.length ? (
            flaggedForFollowUp.map((f, i) => (
              <span className="chip flag" key={i}>
                {f}
              </span>
            ))
          ) : (
            <span className="body-text">Nothing flagged</span>
          )}
        </div>
      </div>

      <div className="report-section">
        <div className="label">Summary</div>
        <div className="body-text">{fmt(summary)}</div>
      </div>

      <div className="report-footer">
        <button className="new-call-btn" onClick={onRestart}>
          Start another call
        </button>
      </div>
    </div>
  );
}
