# Screening Line — Voice Health Screening Call


A web app for a live, spoken health-screening call with an AI agent. You talk, it asks a handful
of adaptive intake questions (name, main concern, duration, severity, related symptoms), and once
the call ends it produces a structured report.


## What's used (100% free — no billing account needed anywhere)


- **Frontend:** React + Vite
- **Backend:** Node.js + Express + `ws` (WebSocket)
- **STT + TTS:** the browser's built-in **Web Speech API** (`SpeechRecognition` /
 `speechSynthesis`) — runs client-side, no API key, no server round-trip for audio at all
- **LLM:** **Google Gemini** (`gemini-2.0-flash` by default) via `@google/generative-ai`, used for
 both driving the conversation turn-by-turn and generating the final report, via JSON-mode
 structured output. Gemini's free tier needs no card on file — just a Google account.


All of this is swappable — see "Swapping providers" below (e.g. back to OpenAI/Whisper/ElevenLabs
if you have paid keys and want higher speech quality).


> **Browser requirement:** the Web Speech API is currently only reliable in **Chrome or Edge**
> (desktop or Android). Safari and Firefox don't support `SpeechRecognition`. Use Chrome to try
> this out.


## Architecture


```
Browser (React)                          Node backend (Express + ws)
─────────────────                        ────────────────────────────
Hold-to-talk button                      WebSocket server at /call
→ Web Speech API's SpeechRecognition    One in-memory session per
  transcribes speech to text locally     connection: {history, collected}
  in the browser (no audio sent
  anywhere)                             user_turn →
→ transcript text sent over the           LLM (Gemini, JSON mode): given
  WebSocket (`user_turn`)                  full history + current collected
                                            fields, decide the next reply
                                            AND the updated structured
                                            state in one call
                                         ← ai_turn (transcript, reply text,
                                           updated fields)


speechSynthesis speaks the reply         end_call →
out loud in the browser. Transcript        LLM: synthesize full transcript +
+ "what we've learned so far" panel        collected state into a
update live each turn.                     structured report JSON
                                         ← report
```


**Why push-to-talk over a WebSocket, not raw audio streaming:** the assessment explicitly calls
this out as an acceptable pattern, and it makes turn-taking unambiguous — no risk of the AI
transcribing its own TTS output or fighting over who's speaking. Each turn is sent the moment the
user releases the button (not buffered until the call ends), over a persistent, real-time
WebSocket connection for the whole call — not "upload one file at the end."


**Why STT/TTS moved into the browser:** doing speech recognition and speech synthesis client-side
means the only paid-API-shaped dependency left in the whole app is the LLM call, and Gemini's free
tier covers that with no billing setup. It also means audio never has to be base64-encoded and
shipped over the wire — only the (much smaller) transcript text does, which keeps each turn fast.


**Conversation state** lives server-side, keyed by WebSocket connection, as `{ history: [...],
collected: {...} }`. Every turn, Gemini receives the *entire* history plus the current structured
`collected` object and returns a JSON object with three keys: `reply` (what to say next),
`collected` (the full, updated structured state), and `callComplete` (whether enough has been
gathered). This is what keeps the AI from repeating questions or losing the thread — it's always
reasoning over the full state, not just the last message. The frontend mirrors `collected` live in
a small "chart" panel next to the transcript, so you can watch the state update turn by turn.


**Report generation** is a second, separate LLM call at `end_call` time, given the full transcript
and the final `collected` state, prompted to return a structured JSON report (main concern,
symptoms, duration, severity, flags, a short summary, and a `completeness` rating). If the call
was ended after one exchange or zero exchanges, the prompt explicitly instructs the model not to
invent details — `completeness` will read `"minimal"` or `"partial"` and fields will be `null`/
empty rather than fabricated. There's also a hard-coded fallback report (built directly from
`collected`, no LLM) if the report call itself fails or returns malformed JSON, so the UI never
crashes on a short/empty call.


## Failure handling


- **Silence / unclear audio:** if `SpeechRecognition` reports no speech (or the user releases the
 button without saying anything), the backend logs "(silence / unclear audio)" in the transcript
 and the LLM is instructed to ask the user to repeat themselves rather than inventing an answer.
- **LLM failures:** every WebSocket message handler is wrapped in try/catch — a Gemini API failure
 on a turn sends an `error` message back over the socket instead of dropping the connection, so
 the call doesn't die mid-conversation. A failure on the *report* call falls back to a report
 built directly from the structured state collected during the call, with no LLM involved.
- **Malformed JSON from the LLM:** both LLM call sites attempt `JSON.parse`, then a regex-extracted
 fallback, then a safe default — the app never crashes because the model added a stray sentence
 outside the JSON object.
- **Unsupported browser:** if `SpeechRecognition` isn't available (Safari/Firefox), the app
 disables the talk button and shows an explanation rather than failing silently.


## Light barge-in


Pressing "hold to talk" while the AI's speech is still playing immediately cancels it
(`speechSynthesis.cancel()`) and starts listening, so you can cut in without waiting for it to
finish. This isn't full-duplex (the AI can't react to you talking *while* it's mid-sentence beyond
stopping), but it avoids the awkward "wait for me to finish" problem in a push-to-talk flow.


## Setup


Requires Node 18+ and a free Google account for a Gemini API key.


### 1. Get a free Gemini API key


1. Go to **https://aistudio.google.com/apikey**
2. Sign in with a Google account
3. Click "Create API key" — no credit card required
4. Copy the key (starts with `AIza...`)


### 2. Backend


```bash
cd backend
cp .env.example .env
# edit .env and set GEMINI_API_KEY=AIza...
npm install
npm start
```


Runs on `http://localhost:8787`, WebSocket at `ws://localhost:8787/call`.


### 3. Frontend


```bash
cd frontend
cp .env.example .env   # defaults to ws://localhost:8787/call, edit if needed
npm install
npm run dev
```


Opens on `http://localhost:5173`. **Use Chrome or Edge** and allow microphone access when
prompted.


## Swapping providers


Each piece is isolated so any leg can be swapped independently:


- `backend/src/services/llm.js` — swap Gemini for OpenAI/Anthropic by changing this file only; the
 JSON contract (`reply` / `collected` / `callComplete`, and the report shape) is all the rest of
 the app depends on
- STT/TTS — currently in `frontend/src/api/useCallSession.js` via the Web Speech API. To swap back
 to a server-side provider (Whisper, Deepgram, ElevenLabs, Sarvam) for better accuracy/voice
 quality, send audio blobs over the WebSocket instead of transcript text and add the
 provider calls back on the backend (this is exactly how an earlier version of this app worked —
 audio in, audio out, over the same `ai_turn`/`user_turn` message shape).


## What I'd improve with more time


- **Better STT/TTS quality.** The Web Speech API is free but noticeably lower quality than
 Whisper/ElevenLabs-tier services, especially on accents and background noise, and Chrome's
 `SpeechRecognition` actually calls out to Google's servers under the hood rather than running
 fully offline — so it's not literally zero-infrastructure, just zero-key. A paid STT/TTS swap
 (see above) would be the first upgrade with a real budget.
- **True streaming STT/TTS** (e.g. Deepgram's streaming API) instead of per-turn request/response,
 for lower latency and real full-duplex barge-in.
- **Auto language detection + mid-call switching.** The LLM prompt asks Gemini to reply in
 whatever language the user just used, but `SpeechRecognition.lang` is currently hardcoded to
 `en-US` on the frontend, which caps recognition accuracy for Hindi speech — a language toggle
 (or attempting recognition in both languages) would fix this the fastest.
- **Background noise / VAD:** no voice-activity detection — the user has to manually judge when to
 stop talking. An auto-stop on a pause in speech would feel less "walkie-talkie."
- **Persistence.** Session state is in-memory and lost on server restart; a real deployment would
 want a datastore and auth so a report can be retrieved after the fact.
- **Automated tests** around the conversation-state JSON contract (e.g. does the LLM ever regress
 a previously-collected field) — validated manually but didn't have time to build a regression
 harness with recorded/mocked LLM responses.