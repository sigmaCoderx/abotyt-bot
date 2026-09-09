import { TelegramClient } from "telegram";
import { NewMessage } from "telegram/events";

import { requireMembership } from "../services/membership";
import { sendStyled } from "../utils/premiumText";

export function registerStartHandler(client: TelegramClient) {
    client.addEventHandler(
        async (event) => {
            const message = event.message;

            // Ignore anything that isn't a private DM (e.g. cache/error
            // channel posts) — see the same guard in message.ts.
            if (!message.isPrivate) {
                return;
            }

            const text = message.message?.trim();

            if (!text || !text.startsWith("/start")) {
                return;
            }

            const userId = String(message.senderId ?? message.chatId);
            const isMember = await requireMembership(client, userId, message.chatId!);
            if (!isMember) {
                return; // join prompt already sent
            }

            await sendStyled(
                client,
                message.chatId!,
                "🎶 Welcome!\n\n" +
                    "🎧 YouTube Audio & Video Downloader\n\n" +
                    "Send me a YouTube video or playlist URL."
            );
        },
        new NewMessage({ incoming: true })
    );
}
