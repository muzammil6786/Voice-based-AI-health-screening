import { emptyCollectedState } from "./services/llm.js";

/** @type {Map<string, {history: Array, collected: object, ended: boolean, createdAt: number}>} */
const sessions = new Map();

export function createSession(id) {
  const session = {
    history: [], // [{role, content}]
    collected: emptyCollectedState(),
    ended: false,
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id);
}

export function deleteSession(id) {
  sessions.delete(id);
}

// Basic janitor: drop sessions abandoned for > 1 hour so memory doesn't grow unbounded.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, s] of sessions.entries()) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
}, 10 * 60 * 1000).unref();
