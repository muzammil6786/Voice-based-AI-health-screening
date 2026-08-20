# Screening Line — Voice Health Screening Call

A web app for a live, spoken health-screening call with an AI agent. You talk, it asks a handful of adaptive intake questions (name, main concern, duration, severity, related symptoms), and once the call ends it produces a structured report.

## What's used (100% free — no billing account needed anywhere)

* **Frontend:** React + Vite
* **Backend:** Node.js + Express + `ws` (WebSocket)
* **STT + TTS:** the browser's built-in **Web Speech API** (`SpeechRecognition` / `speechSynthesis`) — runs client-side, with no API key and no server round-trip for audio
* **LLM:** **Google Gemini** (`gemini-2.0-flash` by default) via `@google/generative-ai`, used for both driving the conversation turn-by-turn and generating the final report, via JSON-mode structured output. Gemini's free tier can be used without adding a billing account.

All of this is swappable — see "Swapping providers" below (e.g. OpenAI/Whisper/ElevenLabs if you have paid keys and want higher speech quality).

> **Browser requirement:** The Web Speech API is currently most reliable in **Chrome or Edge** (desktop or Android). Safari and Firefox may not support `SpeechRecognition`. Use Chrome to try this out.

## Architecture

```text
Browser (React)                          Node backend (Express + ws)
─────────────────                        ────────────────────────────
Hold-to-talk button                      WebSocket server at /call
→ Web Speech API's SpeechRecognition    One in-memory session per
  transcribes speech to text locally     connection:
                                         {history, collected}

→ transcript text sent over the          user_turn →
  WebSocket (`user_turn`)                  LLM (Gemini, JSON mode):
                                            given full history +
                                            current collected fields,
                                            decide the next reply
                                            AND updated structured state
                                            in one call

                                         ← ai_turn
                                            transcript
                                            reply text
                                            updated fields

speechSynthesis speaks the reply        end_call →
out loud in the browser. Transcript        LLM: synthesize full transcript +
+ "what we've learned so far"             collected state into a
panel update live each turn.              structured report JSON

                                         ← report
```

## Why push-to-talk over a WebSocket, not raw audio streaming?

The assessment explicitly calls this out as an acceptable pattern, and it makes turn-taking unambiguous — there is no risk of the AI transcribing its own TTS output or fighting over who's speaking.

Each turn is sent the moment the user releases the button, rather than being buffered until the call ends. The transcript is sent over a persistent, real-time WebSocket connection for the whole call instead of uploading one audio file at the end.

## Why STT/TTS moved into the browser?

Speech recognition and speech synthesis are handled client-side through the browser's Web Speech API.

The backend therefore receives transcript text rather than audio. This means:

* No audio needs to be base64-encoded and sent through the backend.
* Only the relatively small transcript is transmitted over WebSocket.
* No separate STT/TTS API keys are required.
* The application remains simple to run locally.

> **Privacy note:** Although the application does not send audio to your backend, browser implementations of `SpeechRecognition` may use a browser/vendor speech service behind the scenes. Therefore, this should not be described as guaranteed offline speech recognition.

## Conversation state

Conversation state lives server-side and is keyed by the WebSocket connection.

Each active session contains:

```js
{
  history: [],
  collected: {
    name: null,
    mainConcern: null,
    duration: null,
    severity: null,
    relatedSymptoms: [],
    flags: []
  },
  ended: false,
  processing: false,
  createdAt: Date.now()
}
```

Every turn, Gemini receives the conversation history and the current structured `collected` state.

Gemini returns:

```json
{
  "reply": "What is the main concern you'd like to discuss?",
  "collected": {
    "name": null,
    "mainConcern": null,
    "duration": null,
    "severity": null,
    "relatedSymptoms": [],
    "flags": []
  },
  "callComplete": false
}
```

This keeps the AI from repeatedly asking questions that have already been answered and allows the conversation to adapt based on the information collected so far.

The frontend mirrors the `collected` state live in a small information panel next to the transcript.

## Report generation

Report generation is a second, separate LLM call at `end_call` time.

The report receives:

* The complete conversation transcript
* The final structured `collected` state

It returns a structured JSON report containing:

* Patient name
* Main concern
* Symptoms
* Duration
* Severity
* Items flagged for follow-up
* Short summary
* Completeness rating

The model is explicitly instructed not to invent information.

If the call was ended after only one exchange or with no useful information, the report can be marked as:

```text
minimal
```

or:

```text
partial
```

with unavailable fields represented as `null` or empty arrays.

There is also a hard-coded fallback report. If the report-generation request fails or Gemini returns malformed JSON, the application can build a report directly from the structured state already collected during the call.

## Failure handling

### Silence / unclear audio

If `SpeechRecognition` reports no speech, or the user releases the button without saying anything, the backend records:

```text
(silence / unclear audio)
```

The LLM is instructed to ask the user to repeat themselves instead of inventing an answer.

### LLM failures

WebSocket message processing is wrapped in error handling.

A Gemini API failure returns an error message to the frontend instead of silently dropping the connection.

Report-generation failures use the local fallback report.

### Gemini quota errors

If Gemini returns a `429 Too Many Requests` response because the project's quota has been exhausted, the backend returns a user-friendly error instead of exposing the full API stack trace.

The application also prevents multiple Gemini requests from being processed concurrently for the same session.

### Malformed JSON from the LLM

Both LLM call sites attempt to:

1. Parse the returned JSON directly.
2. Extract a JSON object if additional text is returned.
3. Fall back to a safe response/report.

This prevents malformed model output from crashing the application.

### Unsupported browser

If `SpeechRecognition` is unavailable, the application disables the talk button and displays an explanation rather than failing silently.

## Light barge-in

Pressing **Hold to talk** while the AI's speech is still playing immediately cancels the current `speechSynthesis` playback and starts listening.

This allows the user to interrupt the AI without waiting for the complete response.

This is not full-duplex conversation — the AI does not continuously process speech while it is speaking — but it provides a lightweight barge-in experience while retaining the simplicity of push-to-talk.

## Setup

Requires:

* Node.js 18+
* A Google account
* A Gemini API key

### 1. Get a Gemini API key

1. Open Google AI Studio.
2. Sign in with a Google account.
3. Create an API key.
4. Copy the API key.

### 2. Backend

```bash
cd backend

cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key
LLM_MODEL=gemini-2.0-flash
PORT=8787
CORS_ORIGIN=http://localhost:5173
```

Install dependencies:

```bash
npm install
```

Start the backend:

```bash
npm run dev
```

The backend runs on:

```text
http://localhost:8787
```

The WebSocket endpoint is:

```text
ws://localhost:8787/call
```

### 3. Frontend

Open another terminal:

```bash
cd frontend

cp .env.example .env
```

The frontend WebSocket configuration should point to:

```env
VITE_WS_URL=ws://localhost:8787/call
```

Install dependencies:

```bash
npm install
```

Start the frontend:

```bash
npm run dev
```

The frontend will normally open at:

```text
http://localhost:5173
```

> **Use Chrome or Edge** and allow microphone access when prompted.

## Project structure

```text
health-screening-app/
│
├── backend/
│   ├── src/
│   │   ├── services/
│   │   │   └── llm.js
│   │   └── sessionStore.js
│   │
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   └── server.js
│
└── frontend/
    ├── src/
    │   ├── api/
    │   │   └── useCallSession.js
    │   ├── components/
    │   └── ...
    │
    ├── .env
    ├── .env.example
    ├── package.json
    └── vite.config.js
```

## Swapping providers

Each component is isolated so individual providers can be replaced independently.

### LLM

The main LLM integration lives in:

```text
backend/src/services/llm.js
```

Gemini can be replaced with another provider such as OpenAI or Anthropic.

The rest of the application depends primarily on the existing response contracts:

```text
reply
collected
callComplete
```

and the final report structure.

### STT / TTS

STT and TTS currently live in:

```text
frontend/src/api/useCallSession.js
```

using the Web Speech API.

For higher-quality speech recognition or synthesis, this can be replaced with services such as:

* Whisper
* Deepgram
* ElevenLabs
* Sarvam

A server-side speech provider would require sending audio data over the WebSocket instead of only sending transcript text.

## Current limitations

### Speech recognition quality

The Web Speech API is convenient and free, but recognition quality can vary depending on:

* Browser
* Microphone
* Background noise
* Accent
* Language

Chrome's implementation may use Google's speech recognition service rather than processing speech entirely offline.

### Hindi recognition

The current frontend recognition configuration uses:

```text
en-US
```

Therefore Hindi speech recognition may not be as accurate as English.

A future improvement would be a language selector or automatic language detection.

### No automatic voice activity detection

The application uses push-to-talk. The user manually decides when to start and stop speaking.

Automatic pause detection or voice-activity detection could make the experience feel more natural.

### In-memory sessions

Session data currently lives in server memory.

If the backend restarts, active sessions are lost.

A production deployment should use a persistent datastore and authentication.

### Gemini quota

The application depends on the quota available to the configured Gemini API project. During development, repeated testing can consume the available request quota.

The application handles quota errors gracefully, but a higher quota or paid API tier may be required for sustained usage.

### Automated tests

Automated tests around the conversation-state JSON contract would be a useful next step.

Examples include testing that:

* Previously collected fields are not accidentally removed.
* The model does not repeatedly ask answered questions.
* Malformed model output triggers the fallback.
* Empty speech does not create fabricated information.
* The report correctly handles incomplete calls.

## What I'd improve with more time

* **Better STT/TTS quality:** Replace browser speech APIs with higher-quality speech providers where appropriate.
* **True streaming STT/TTS:** Use streaming APIs for lower latency and more natural full-duplex interaction.
* **Automatic language detection:** Support English and Hindi dynamically.
* **Background noise handling:** Add voice-activity detection and silence detection.
* **Persistent sessions:** Store calls and reports in a database.
* **Authentication:** Add user authentication and authorization.
* **Call history:** Allow users to view previous screening reports.
* **Automated testing:** Add unit and integration tests around the conversation state and LLM response contract.
* **Observability:** Add structured logging and metrics for latency, failures, and API usage.
* **Production security:** Add rate limiting, input validation, secure WebSocket handling, and appropriate data-retention policies.
* **Medical safety review:** Validate prompts, escalation behavior, and user-facing messaging with appropriate clinical and legal review before using the application for real healthcare workflows.

## Medical safety notice

This application is a **health-screening demonstration**, not a medical diagnostic system.

The AI is instructed not to:

* Diagnose medical conditions.
* Prescribe medication.
* Recommend treatment.
* Replace a qualified healthcare professional.

Information collected by the application should not be treated as medical advice.

For a production healthcare application, appropriate clinical validation, privacy controls, security measures, regulatory review, and professional oversight would be required.

## Copyright

© 2026 Muzammil Raza Khan. All rights reserved.

This project was developed as part of a technical assignment and is intended for evaluation and demonstration purposes. Please do not redistribute or use the source code commercially without permission.
