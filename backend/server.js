import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "node:http";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

import {
  getGreeting,
  getNextTurn,
  generateReport,
} from "./src/services/llm.js";

import {
  createSession,
  getSession,
  deleteSession,
} from "./src/sessionStore.js";

const PORT = process.env.PORT || 8787;

const CORS_ORIGIN = (
  process.env.CORS_ORIGIN || "http://localhost:5173"
).split(",");

if (!process.env.GEMINI_API_KEY) {
  console.warn(
    "\n⚠️ GEMINI_API_KEY is not set. Copy backend/.env.example to backend/.env and add your free key from https://aistudio.google.com/apikey\n"
  );
}

const app = express();

app.use(
  cors({
    origin: CORS_ORIGIN,
  })
);

app.use(
  express.json({
    limit: "2mb",
  })
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
  });
});

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  path: "/call",
});

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on("connection", (ws) => {
  const sessionId = randomUUID();

  createSession(sessionId);

  console.log(`[ws] connected: ${sessionId}`);

  ws.on("message", async (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, {
        type: "error",
        message: "Malformed message.",
      });
    }

    // IMPORTANT:
    // Always retrieve the existing session.
    // Do NOT create a new session for every message.
    const session = getSession(sessionId);

    if (!session) {
      return send(ws, {
        type: "error",
        message: "Session expired, please restart the call.",
      });
    }

    try {
      /*
       * START CALL
       */
      if (msg.type === "start_call") {
        if (session.processing) {
          return send(ws, {
            type: "error",
            message: "Call is already starting.",
          });
        }

        if (session.history.length > 0) {
          return send(ws, {
            type: "error",
            message: "Call has already started.",
          });
        }

        if (session.ended) {
          return send(ws, {
            type: "error",
            message: "This call has already ended.",
          });
        }

        session.processing = true;

        try {
          console.log(`[ws] generating greeting: ${sessionId}`);

          const { reply, collected } = await getGreeting();

          session.history.push({
            role: "assistant",
            content: reply,
          });

          session.collected = collected;

          send(ws, {
            type: "ai_turn",
            transcript: null,
            reply,
            collected: session.collected,
            callComplete: false,
          });
        } finally {
          session.processing = false;
        }

        return;
      }

      /*
       * USER TURN
       */
      if (msg.type === "user_turn") {
        if (session.ended) {
          return send(ws, {
            type: "error",
            message: "This call has already ended.",
          });
        }

        /*
         * Prevent duplicate/concurrent Gemini requests.
         */
        if (session.processing) {
          console.log(
            `[ws] ignoring user_turn because session is processing: ${sessionId}`
          );

          return send(ws, {
            type: "error",
            message: "Please wait for the current response.",
          });
        }

        session.processing = true;

        try {
          const transcript = (msg.text || "").trim();

          console.log(
            `[ws] user_turn ${sessionId}:`,
            transcript || "(silence / unclear audio)"
          );

          const userMessageForLLM =
            transcript ||
            "[no speech detected — audio was silent or unclear]";

          /*
           * Add user message to existing conversation history.
           */
          session.history.push({
            role: "user",
            content:
              transcript || "(silence / unclear audio)",
          });

          /*
           * ONE Gemini request for this user turn.
           */
          const {
            reply,
            collected,
            callComplete,
          } = await getNextTurn(
            session.history,
            session.collected,
            userMessageForLLM
          );

          /*
           * Save AI response.
           */
          session.history.push({
            role: "assistant",
            content: reply,
          });

          /*
           * Save updated structured information.
           */
          session.collected = collected;

          console.log(
            `[ws] AI response generated: ${sessionId}`
          );

          send(ws, {
            type: "ai_turn",
            transcript,
            reply,
            collected: session.collected,
            callComplete,
          });
        } finally {
          session.processing = false;
        }

        return;
      }

      /*
       * END CALL
       */
      if (msg.type === "end_call") {
        if (session.ended) {
          return send(ws, {
            type: "error",
            message: "This call has already ended.",
          });
        }

        /*
         * Don't generate the report while another Gemini
         * request is still running.
         */
        if (session.processing) {
          return send(ws, {
            type: "error",
            message:
              "Please wait for the current response to finish.",
          });
        }

        session.processing = true;
        session.ended = true;

        try {
          console.log(
            `[ws] generating final report: ${sessionId}`
          );

          /*
           * This is the final Gemini request.
           */
          const report = await generateReport(
            session.history,
            session.collected
          );

          send(ws, {
            type: "report",
            report,
          });

          console.log(
            `[ws] report generated: ${sessionId}`
          );
        } finally {
          session.processing = false;
        }

        deleteSession(sessionId);

        return;
      }

      /*
       * UNKNOWN MESSAGE
       */
      send(ws, {
        type: "error",
        message: `Unknown message type: ${msg.type}`,
      });
    } catch (err) {
      console.error(
        "[ws] error handling message:",
        err
      );

      /*
       * Handle Gemini quota errors specifically.
       */
      if (err?.status === 429) {
        return send(ws, {
          type: "error",
          message:
            "The AI service has reached its current usage limit. Please try again later.",
        });
      }

      send(ws, {
        type: "error",
        message:
          "Something went wrong processing that turn — please try again.",
      });
    }
  });

  ws.on("close", () => {
    console.log(
      `[ws] disconnected: ${sessionId}`
    );

    deleteSession(sessionId);
  });
});

server.listen(PORT, () => {
  console.log(
    `Backend listening on http://localhost:${PORT} (WebSocket path: /call)`
  );
});