/**
 * Maps chatId -> sessionId for the most recently created request in that chat.
 * Used only to route a plain-text follow-up (e.g. a typed playlist range like
 * "2-5" or "all") to the right pending session.
 */
export const activeSessionByChat = new Map<string, string>();
