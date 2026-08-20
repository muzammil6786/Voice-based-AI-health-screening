import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8787/call";
const MAX_RECONNECT_ATTEMPTS = 4;

const SpeechRecognitionImpl =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export function useCallSession() {
  const [connectionState, setConnectionState] = useState("connecting"); // connecting | open | closed
  const [log, setLog] = useState([]); // {speaker:'ai'|'user', text}
  const [collected, setCollected] = useState(null);
  const [callComplete, setCallComplete] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [speechSupported] = useState(Boolean(SpeechRecognitionImpl));

  const wsRef = useRef(null);
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const recognitionStateRef = useRef({ hasStarted: false, stopRequested: false, finished: false });
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const stoppedRef = useRef(false); // true once the effect has been cleaned up for real

  useEffect(() => {
    if (!speechSupported) {
      setError(
        "This browser doesn't support the Web Speech API. Please use Chrome or Edge on desktop or Android."
      );
    }
  }, [speechSupported]);

  const connect = useCallback(() => {
    // Guards against React StrictMode's mount→cleanup→mount in dev, and
    // against a stale reconnect timer firing after the component unmounted.
    let ignore = false;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setConnectionState("connecting");

    ws.onopen = () => {
      if (ignore) return;
      reconnectAttemptsRef.current = 0;
      setConnectionState("open");
      setError(null); // clear any earlier "couldn't reach server" message — we're connected now
      ws.send(JSON.stringify({ type: "start_call" }));
    };

    ws.onclose = () => {
      if (ignore) return;
      setConnectionState("closed");
      // Auto-retry a few times with backoff — handles "backend was still
      // starting up" instead of leaving the user stuck on an error screen.
      if (!stoppedRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const attempt = reconnectAttemptsRef.current + 1;
        reconnectAttemptsRef.current = attempt;
        const delay = Math.min(1000 * attempt, 4000);
        reconnectTimerRef.current = setTimeout(() => {
          if (!stoppedRef.current) connect();
        }, delay);
      } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setError("Couldn't reach the call server. Is the backend running?");
      }
    };

    ws.onerror = () => {
      // onclose fires right after and handles retry/error messaging —
      // avoid setting duplicate/premature error state here.
    };

    ws.onmessage = (event) => {
      if (ignore) return;
      const msg = JSON.parse(event.data);

      if (msg.type === "ai_turn") {
        setProcessing(false);
        setError(null);
        if (msg.transcript) {
          setLog((l) => [...l, { speaker: "user", text: msg.transcript }]);
        } else if (msg.transcript === "") {
          setLog((l) => [...l, { speaker: "user", text: "(no speech detected)" }]);
        }
        setLog((l) => [...l, { speaker: "ai", text: msg.reply }]);
        setCollected(msg.collected);
        setCallComplete(Boolean(msg.callComplete));
        speak(msg.reply);
      }

      if (msg.type === "report") {
        setReportLoading(false);
        setReport(msg.report);
      }

      if (msg.type === "error") {
        setProcessing(false);
        setError(msg.message);
      }
    };

    return () => {
      ignore = true;
      ws.close();
    };
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    const cleanupSocket = connect();

    return () => {
      stoppedRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      cleanupSocket();
      window.speechSynthesis?.cancel();
    };
  }, [connect]);

  const retryConnection = useCallback(() => {
    clearTimeout(reconnectTimerRef.current);
    reconnectAttemptsRef.current = 0;
    setError(null);
    connect();
  }, [connect]);

  function speak(text) {
    if (!text || !window.speechSynthesis) {
      setAiSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.onstart = () => setAiSpeaking(true);
    utterance.onend = () => setAiSpeaking(false);
    utterance.onerror = () => setAiSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  const finishTurn = useCallback(() => {
    const state = recognitionStateRef.current;
    if (state.finished) return;
    state.finished = true;
    recognitionRef.current = null;
    setRecording(false);
    const text = finalTranscriptRef.current.trim();
    setProcessing(true);
    wsRef.current?.send(JSON.stringify({ type: "user_turn", text }));
  }, []);

  const startRecording = useCallback(() => {
    if (!speechSupported) return;
    if (recognitionRef.current) return; // already recording — ignore a duplicate start
    setError(null);

    // Light barge-in: stop the AI's TTS so the user can jump in.
    window.speechSynthesis?.cancel();
    setAiSpeaking(false);

    const recognition = new SpeechRecognitionImpl();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;

    finalTranscriptRef.current = "";
    recognitionStateRef.current = { hasStarted: false, stopRequested: false, finished: false };

    recognition.onstart = () => {
      recognitionStateRef.current.hasStarted = true;
      // If the user already released the button before the engine finished
      // spinning up, honor that stop request now instead of dropping it.
      if (recognitionStateRef.current.stopRequested) {
        try {
          recognition.stop();
        } catch {
          finishTurn();
        }
      }
    };

    recognition.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) text += event.results[i][0].transcript;
      }
      if (text) finalTranscriptRef.current += (finalTranscriptRef.current ? " " : "") + text;
    };

    recognition.onerror = (event) => {
      // "no-speech" / "aborted" are expected when the user releases quickly — not real errors.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = finishTurn;

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setRecording(true);
      // Safety net: some browsers occasionally never fire onend if start()
      // and stop() race each other. Force the turn to finish rather than
      // leaving the button stuck in "recording" state forever.
      setTimeout(() => {
        if (recognitionRef.current === recognition && !recognitionStateRef.current.finished) {
          try {
            recognition.abort();
          } catch {
            /* ignore */
          }
          finishTurn();
        }
      }, 15000);
    } catch {
      setError("Couldn't start the microphone. Please try again.");
      recognitionRef.current = null;
    }
  }, [speechSupported, finishTurn]);

  const stopRecording = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    const state = recognitionStateRef.current;

    if (!state.hasStarted) {
      // Defer the stop until onstart fires; also guard against onstart
      // itself never firing (rare, but seen on some Chrome versions).
      state.stopRequested = true;
      setTimeout(() => {
        if (recognitionRef.current === recognition && !state.finished) {
          try {
            recognition.abort();
          } catch {
            /* ignore */
          }
          finishTurn();
        }
      }, 1500);
      return;
    }

    try {
      recognition.stop();
    } catch {
      finishTurn();
    }
  }, [finishTurn]);

  const endCall = useCallback(() => {
    window.speechSynthesis?.cancel();
    setReportLoading(true);
    wsRef.current?.send(JSON.stringify({ type: "end_call" }));
  }, []);

  return {
    connectionState,
    log,
    collected,
    callComplete,
    aiSpeaking,
    recording,
    processing,
    error,
    report,
    reportLoading,
    speechSupported,
    startRecording,
    stopRecording,
    endCall,
    retryConnection,
  };
}