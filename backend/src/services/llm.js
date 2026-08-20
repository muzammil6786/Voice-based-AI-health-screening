import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = process.env.LLM_MODEL || "Gemini 2 Flash";

function getModel(systemInstruction) {
  return genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.5,
    },
  });
}

// Gemini's chat history uses role "model" instead of "assistant", and only
// "user"/"model" are valid roles (no "system" turns inside history).
function toGeminiHistory(history) {
  return history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

const CONVERSATION_SYSTEM_PROMPT = `You are a calm, professional AI assistant conducting a brief voice-based
health SCREENING call — like a nurse's intake call before a doctor visit. You are NOT a doctor and must
NEVER give a diagnosis, treatment advice, or medication guidance. Your only job is to gather structured
information through a natural, adaptive spoken conversation.

Information to collect (ask ONE question at a time, skip anything already collected, and feel free to ask a
short natural follow-up if an answer is vague — this is what makes it feel like a real conversation, not a
fixed script):
1. name — what the person would like to be called
2. mainConcern — the main symptom or reason for the call
3. duration — how long it has been going on
4. severity — how severe/bothersome it is, in the person's own words (mild/moderate/severe, a 1-10 scale, etc.)
5. relatedSymptoms — any other symptoms that go along with the main one

Respond with a SINGLE JSON object and nothing else (no markdown fences, no commentary), with exactly these keys:
{
  "reply": string,            // ONE short spoken sentence (max ~2), asking exactly one question, or a brief closing line once callComplete is true. Reply in the same language the user is speaking (English or Hindi).
  "collected": {               // the FULL updated state — carry forward everything already known, only change what's new this turn
    "name": string|null,
    "mainConcern": string|null,
    "duration": string|null,
    "severity": string|null,
    "relatedSymptoms": string[],
    "flags": string[]          // anything concerning worth a doctor's attention, e.g. "reports chest pain"
  },
  "callComplete": boolean       // true once name, mainConcern, duration, severity are gathered and related symptoms have been asked about, OR the user clearly wants to end
}

Rules:
- Never diagnose or suggest treatment. If something sounds urgent (chest pain, trouble breathing, severe
  bleeding, stroke symptoms, suicidal ideation, etc.), add a clear flag AND gently tell them to seek
  immediate/emergency care in the "reply", but keep the tone calm.
- Keep "reply" short and conversational — this is spoken aloud via text-to-speech.
- Never repeat a question that's already answered in "collected".
- If the user's message is empty, garbled, or clearly not understood (e.g. STT returned nothing useful),
  politely ask them to repeat themselves rather than guessing — do not invent information.
- Output ONLY the JSON object.`;

const REPORT_SYSTEM_PROMPT = `You are generating a structured health-screening report from a call transcript
for a doctor to glance at before an appointment. You are NOT diagnosing anything — only summarizing what was
said. The call may be short, incomplete, or interrupted; handle that gracefully rather than inventing details.

Respond with a SINGLE JSON object and nothing else, with exactly these keys:
{
  "patientName": string|null,
  "mainConcern": string|null,
  "symptoms": string[],           // main + related symptoms mentioned, concise phrases
  "duration": string|null,
  "severity": string|null,
  "flaggedForFollowUp": string[], // anything worth a clinician's attention, urgent or otherwise; [] if none
  "summary": string,              // 2-4 sentence plain-language clinical-style summary
  "completeness": "complete" | "partial" | "minimal"  // how much information was actually gathered
}
Output ONLY the JSON object.`;

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

/**
 * Advance the conversation by one turn.
 * @param {Array<{role:'user'|'assistant', content:string}>} history
 * @param {object} collected current structured state
 * @param {string} userMessage the latest user utterance (already transcribed)
 */
export async function getNextTurn(history, collected, userMessage) {
  const systemInstruction = `${CONVERSATION_SYSTEM_PROMPT}\n\nCurrent collected state so far: ${JSON.stringify(
    collected
  )}`;

  const model = getModel(systemInstruction);
  const chat = model.startChat({ history: toGeminiHistory(history) });
  const result = await chat.sendMessage(userMessage || "[no speech detected]");

  const raw = result.response.text() || "{}";
  const parsed = safeParseJson(raw);

  if (!parsed) {
    // Fallback if the model ever returns malformed JSON — keep the call alive.
    return {
      reply: "Sorry, could you say that again?",
      collected,
      callComplete: false,
    };
  }

  return {
    reply: parsed.reply || "Could you tell me a bit more?",
    collected: { ...collected, ...parsed.collected },
    callComplete: Boolean(parsed.callComplete),
  };
}

/** Produce the opening greeting + first question. */
export async function getGreeting() {
  return getNextTurn([], emptyCollectedState(), "[call just started, no user message yet — greet them and ask your first question]");
}

export function emptyCollectedState() {
  return {
    name: null,
    mainConcern: null,
    duration: null,
    severity: null,
    relatedSymptoms: [],
    flags: [],
  };
}

/** Generate the final structured report from the full transcript. */
export async function generateReport(history, collected) {
  const transcriptText = history
    .map((m) => `${m.role === "user" ? "Patient" : "Assistant"}: ${m.content}`)
    .join("\n");

  const model = getModel(REPORT_SYSTEM_PROMPT);
  const result = await model.generateContent(
    `Structured state collected during the call: ${JSON.stringify(
      collected
    )}\n\nFull transcript:\n${transcriptText || "(no exchanges took place)"}`
  );

  const raw = result.response.text() || "{}";
  const parsed = safeParseJson(raw);

  if (!parsed) {
    // Fallback: build a minimal report directly from collected state so the UI never crashes.
    return {
      patientName: collected.name,
      mainConcern: collected.mainConcern,
      symptoms: collected.relatedSymptoms || [],
      duration: collected.duration,
      severity: collected.severity,
      flaggedForFollowUp: collected.flags || [],
      summary: "Limited information was collected during this call.",
      completeness: "minimal",
    };
  }

  return parsed;
}
