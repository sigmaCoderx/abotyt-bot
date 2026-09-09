

import { TelegramClient } from "telegram";
import { NewMessage, NewMessageEvent } from "telegram/events";

import { activeSessionByChat } from "../state/activeSession";
import { createSession, getSession, updateSession } from "../state/sessionStore";
import { reportError } from "../services/admin";
import { dispatchAdminCommand } from "../services/adminCommands";
import { requireMembership } from "../services/membership";
import { getUser, touchUser } from "../services/users";
import { cleanupWorkDir } from "../utils/files";
import { downloadThumbnailFile } from "../services/downloader";
import { fetchPlaylistMetadata } from "../services/playlist";
import { fetchVideoMetadata } from "../services/youtube";
import { buildMainMenuKeyboard, buildPlaylistRangeKeyboard, buildPlaylistTypeKeyboard } from "../utils/keyboards";
import { editStyled, sendStyled, sendStyledFile } from "../utils/premiumText";
import { extractYouTubeUrl, isPlaylistUrl, isValidYouTubeUrl, parsePlaylistRange } from "../utils/validation";
import { PlaylistMetadata, SessionData } from "../types";

const INVALID_URL_MESSAGE =
    "❌ That doesn't look like a valid YouTube URL.\n\n" +
    "🎶 Please send a valid YouTube video or playlist link.";

const HELP_MESSAGE =
    "🎶 How to use this bot\n\n" +
    "🔮 Send me any YouTube video, Shorts, or playlist link.\n" +
    "🎬 Pick 🎧 Audio, 🎬 Video, or 🖼 Thumbnail.\n" +
    "🎼 For playlists, choose a range like 2-5, or 'all'.\n\n" +
    "🎵 That's it — I'll handle the rest! 💗";

const UNKNOWN_COMMAND_MESSAGE =
    "❓ Unknown command.\n\n🎶 Send /help to see how I work, or just paste a YouTube link.";

// Matches "/command", "/command@BotName", and optional trailing text/args.
const COMMAND_PATTERN = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/;

export function registerMessageHandler(client: TelegramClient) {
    client.addEventHandler(async (event: NewMessageEvent) => {
        const message = event.message;

        // The bot also receives update events for messages posted into the
        // cache/error channels it manages (e.g. the caption when a fresh
        // download is uploaded to the cache channel). Those are never a
        // private chat with a user, so anything that isn't a 1:1 DM with
        // the bot is ignored here — this is what previously caused the
        // "❌ That doesn't look like a valid YouTube URL" reply to be
        // posted into the cache channel after every successful download.
        if (!message.isPrivate) {
            return;
        }

        const text = message.message?.trim();
        const chatId = String(message.chatId);
        const userId = String(message.senderId ?? message.chatId);

        // Best-effort — the sender entity is usually already cached from the
        // incoming update, so this doesn't cost an extra network round trip.
        const usernameGuess = (message as any).sender?.username as string | undefined;

        await touchUser(userId, usernameGuess);

        const user = await getUser(userId);
        if (user?.isBanned) {
            return; // banned users are fully ignored, no reply
        }

        // Force-join gate: nothing below this point runs until the user is
        // a member of the required channel. requireMembership() sends the
        // join prompt itself when the user isn't a member yet.
        const isMember = await requireMembership(client, userId, message.chatId!);
        if (!isMember) {
            return;
        }

        if (!text || text.startsWith("/start")) {
            return;
        }

        if (text.startsWith("/")) {
            const match = text.match(COMMAND_PATTERN);
            const command = match?.[1]?.toLowerCase();
            const args = match?.[2] ?? "";

            if (command === "help") {
                await sendStyled(client, message.chatId!, HELP_MESSAGE);
                return;
            }

            if (command) {
                const handled = await dispatchAdminCommand(client, message.chatId!, userId, usernameGuess, command, args);
                if (handled) return;
            }

            await sendStyled(client, message.chatId!, UNKNOWN_COMMAND_MESSAGE);
            return;
        }

        if (isValidYouTubeUrl(text)) {
            const url = extractYouTubeUrl(text)!;
            await handleNewUrl(client, event, url);
            return;
        }

        // Maybe this is a typed playlist range reply (e.g. "2-5", "all").
        const pendingId = activeSessionByChat.get(chatId);
        if (pendingId) {
            const session = getSession(pendingId);
            if (session && session.meta.isPlaylist && !session.playlistRange) {
                await handleRangeText(client, chatId, session, text);
                return;
            }
        }

        await sendStyled(client, message.chatId!, INVALID_URL_MESSAGE);
    }, new NewMessage({ incoming: true }));
}

async function handleNewUrl(client: TelegramClient, event: NewMessageEvent, url: string) {
    const message = event.message;
    const chatId = message.chatId!;
    const chatIdStr = String(chatId);
    const userId = String(message.senderId ?? chatId);

    let username: string | undefined;
    try {
        const sender: any = await message.getSender();
        username = sender?.username;
    } catch {
        // ignore — username is best-effort only
    }

    const status = await sendStyled(client, chatId, "🔮 Fetching video information...");

    try {
        if (isPlaylistUrl(url)) {
            const meta = await fetchPlaylistMetadata(url);

            if (!meta.entries.length) {
                throw new Error("Playlist has no videos, or it is private/unavailable.");
            }

            const session = createSession({ chatId: chatIdStr, userId, username, meta });
            activeSessionByChat.set(chatIdStr, session.id);

            await editStyled(
                client,
                chatId,
                status.id,
                `🎶 Playlist detected\n\n📀 ${meta.title}\n🎵 ${meta.entries.length} videos\n\nChoose range:`,
                { buttons: buildPlaylistRangeKeyboard(session.id, meta.entries.length) }
            );
        } else {
            const meta = await fetchVideoMetadata(url);
            const session = createSession({ chatId: chatIdStr, userId, username, meta });
            activeSessionByChat.set(chatIdStr, session.id);

            const caption = `🎶 ${meta.title}\n\nChoose:`;
            const buttons = buildMainMenuKeyboard(session.id);

            if (meta.thumbnail) {
                let thumb: { path: string; workDir: string } | undefined;
                try {
                    thumb = await downloadThumbnailFile(meta.thumbnail, meta.title);
                    await sendStyledFile(client, chatId, thumb.path, caption, { buttons });
                    await client.deleteMessages(chatId, [status.id], { revoke: true });
                } catch (thumbErr) {
                    console.error("Thumbnail menu failed, falling back to text menu:", thumbErr);
                    await editStyled(client, chatId, status.id, caption, { buttons });
                } finally {
                    await cleanupWorkDir(thumb?.workDir);
                }
            } else {
                await editStyled(client, chatId, status.id, caption, { buttons });
            }
        }
    } catch (err) {
        await editStyled(
            client,
            chatId,
            status.id,
            "❌ Something went wrong while processing your request.\n\nPlease try again later. 💗"
        );

        await reportError(client, {
            userId,
            chatId: chatIdStr,
            username,
            url,
            action: "fetch_metadata",
            errorMessage: String((err as Error)?.message ?? err),
        });
    }
}

async function handleRangeText(
    client: TelegramClient,
    chatId: string,
    session: SessionData,
    text: string
) {
    const meta = session.meta as PlaylistMetadata;
    const result = parsePlaylistRange(text, meta.entries.length);

    if (!result.ok) {
        await sendStyled(client, chatId, `❌ ${result.error}`);
        return;
    }

    updateSession(session.id, { playlistRange: { start: result.start, end: result.end } });

    await sendStyled(client, chatId, `✅ Range set: ${result.start}-${result.end}\n\n🎶 What do you want?`, {
        buttons: buildPlaylistTypeKeyboard(session.id),
    });
}