

import path from "path";

import "dotenv/config";

function required(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`${name} is missing in environment variables`);
    }

    return value;
}

function requiredChannelId(name: string): number {
    const raw = required(name);
    const parsed = Number(raw);

    if (!Number.isFinite(parsed)) {
        throw new Error(
            `${name} must be a numeric Telegram channel id (e.g. -1001234567890), got "${raw}"`
        );
    }

    return parsed;
}

export const config = {
    apiId: Number(required("API_ID")),
    apiHash: required("API_HASH"),
    botToken: required("BOT_TOKEN"),
    ownerId: process.env.OWNER_ID || undefined,

    mongodbUri: required("MONGODB_URI"),
    // Falls back to "abotyt" if MONGO_DB_NAME isn't set — needed because a
    // MongoDB Atlas SRV URI (mongodb+srv://.../?appName=...) has no database
    // name in the path, and client.db() with no args throws without one.
    mongoDbName: process.env.MONGO_DB_NAME || "abotyt",

    cacheChannelId: requiredChannelId("CACHE_CHANNEL_ID"),
    errorChannelId: requiredChannelId("ERROR_CHANNEL_ID"),

    maxFileSize: Number(process.env.MAX_FILE_SIZE || 2 * 1024 * 1024 * 1024),
    maxConcurrentDownloads: Number(process.env.MAX_CONCURRENT_DOWNLOADS || 2),

    // Force-join: the user must be a member of this channel to use the bot.
    forceJoinChannelId: Number(process.env.FORCE_JOIN_CHANNEL_ID || -1001776406696),
    forceJoinChannelUsername: process.env.FORCE_JOIN_CHANNEL_USERNAME || "Neuralp",
    forceJoinChannelTitle: process.env.FORCE_JOIN_CHANNEL_TITLE || "Neural Programmers",

    // Shown as buttons under every sent media file (and on the join prompt).
    channelUsername: process.env.CHANNEL_USERNAME || "Neuralp",
    groupUsername: process.env.GROUP_USERNAME || "neuralg",

    // Path to a Netscape-format cookies.txt used by yt-dlp to authenticate
    // as a logged-in browser session (helps avoid YouTube's "confirm you're
    // not a bot" throttling). Optional — omit to run yt-dlp without cookies.
    // Resolved to an absolute path (relative to the process's cwd) up front
    // so it doesn't silently break if the bot is ever launched from a
    // different working directory (e.g. a process manager or systemd unit).
    ytdlpCookiesFile: process.env.YTDLP_COOKIES_FILE
        ? path.resolve(process.cwd(), process.env.YTDLP_COOKIES_FILE)
        : undefined,
};