import { useState } from "react";
import { useCallSession } from "./api/useCallSession.js";
import CallScreen from "./components/CallScreen.jsx";
import ReportScreen from "./components/ReportScreen.jsx";

function Landing({ onStart }) {
  return (
    <div className="landing">
      <div className="eyebrow" style={{ marginBottom: 14 }}>
        Voice health screening
      </div>
      <h2>A quick, spoken check-in before you see the doctor.</h2>
      <p>
        Hold the button to talk, let go when you're done speaking. The assistant will ask a few
        short questions about what's going on — name, main concern, how long it's been happening,
        and how it feels — then put together a short report for your visit.
      </p>
      <button className="start-btn" onClick={onStart}>
        Start call
      </button>
      <div className="disclaimer">
        This is an automated screening tool, not a medical professional. It does not diagnose or
        treat conditions. In an emergency, contact local emergency services immediately.
      </div>
    </div>
  );
}

function ActiveCall({ onEnded }) {
  const session = useCallSession();

  if (session.report || session.reportLoading) {
    return (
      <ReportScreen
        report={session.report}
        loading={session.reportLoading}
        onRestart={onEnded}
      />
    );
  }

  return <CallScreen session={session} />;
}

export default function App() {
  const [screen, setScreen] = useState("landing"); // landing | call
  const [callKey, setCallKey] = useState(0);

  return (
    <div className="app-shell">
      <div className="masthead">
        <div>
          <div className="eyebrow">Take-home demo</div>
          <h1>Screening Line</h1>
        </div>
        <div className={`status-chip${screen === "call" ? " live" : ""}`}>
          <span className="dot" />
          {screen === "call" ? "Live call" : "Idle"}
        </div>
      </div>

      {screen === "landing" && (
        <Landing
          onStart={() => {
            setCallKey((k) => k + 1);
            setScreen("call");
          }}
        />
      )}

      {screen === "call" && (
        <ActiveCall key={callKey} onEnded={() => setScreen("landing")} />
      )}
    </div>
  );
}
