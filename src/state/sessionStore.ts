import crypto from "crypto";

import { SessionData } from "../types";

const store = new Map<string, SessionData>();
const TTL_MS = 1000 * 60 * 60; // 1 hour

export function createSession(data: Omit<SessionData, "id" | "createdAt">): SessionData {
    const id = crypto.randomBytes(5).toString("hex");
    const session: SessionData = { id, createdAt: Date.now(), ...data };
    store.set(id, session);
    return session;
}

export function getSession(id: string): SessionData | undefined {
    const session = store.get(id);
    if (!session) return undefined;

    if (Date.now() - session.createdAt > TTL_MS) {
        store.delete(id);
        return undefined;
    }

    return session;
}

export function updateSession(id: string, patch: Partial<SessionData>): void {
    const session = store.get(id);
    if (!session) return;
    store.set(id, { ...session, ...patch });
}

export function deleteSession(id: string): void {
    store.delete(id);
}

// Periodic cleanup of stale sessions so memory doesn't grow unbounded.
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of store) {
        if (now - session.createdAt > TTL_MS) store.delete(id);
    }
}, 1000 * 60 * 10).unref();
