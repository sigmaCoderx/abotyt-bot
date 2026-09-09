import { TelegramClient } from "telegram";

import { config } from "../config/env";

export interface ErrorContext {
    userId?: string;
    chatId?: any;
    username?: string;
    url?: string;
    action?: string;
    quality?: string;
    playlist?: string;
    errorCode?: string;
    errorMessage: string;
}

/**
 * Reports a failure to the admin channel with full detail.
 * Never expose this level of detail to the end user directly.
 */
export async function reportError(client: TelegramClient, ctx: ErrorContext): Promise<void> {
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);

    const lines = [
        "🚨 BOT ERROR",
        "",
        `👤 User: ${ctx.userId ?? "-"}`,
        `💬 Chat: ${ctx.chatId ?? "-"}`,
        ctx.username ? `🏷 Username: @${ctx.username}` : undefined,
        "",
        ctx.url ? `🔗 URL:\n${ctx.url}` : undefined,
        ctx.action ? `🎬 Action: ${ctx.action}` : undefined,
        ctx.quality ? `📺 Quality: ${ctx.quality}` : undefined,
        ctx.playlist ? `📀 Playlist: ${ctx.playlist}` : undefined,
        "",
        `❌ Error${ctx.errorCode ? ` [${ctx.errorCode}]` : ""}:\n${ctx.errorMessage}`,
        "",
        `🕒 ${timestamp}`,
    ].filter((line): line is string => line !== undefined);

    try {
        await client.sendMessage(config.errorChannelId, { message: lines.join("\n") });
    } catch (err) {
        console.error("Failed to report error to admin channel:", err);
    }
}
