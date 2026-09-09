

import { TelegramClient } from "telegram";
import { CallbackQuery } from "telegram/events/CallbackQuery";

import { reportError } from "../services/admin";
import { handleCheckJoin, requireMembership } from "../services/membership";
import { cancelJob } from "../state/activeDownloads";
import { downloadThumbnailFile } from "../services/downloader";
import { processMediaJob } from "../services/mediaPipeline";
import { cleanupWorkDir } from "../utils/files";
import { fetchVideoMetadata } from "../services/youtube";
import { editStyled, sendStyled } from "../utils/premiumText";
import { getSession, updateSession } from "../state/sessionStore";
import { getUser } from "../services/users";
import {
    buildAudioQualityKeyboard,
    buildChannelGroupKeyboard,
    buildMainMenuKeyboard,
    buildPlaylistAudioQualityKeyboard,
    buildPlaylistRangeKeyboard,
    buildPlaylistTypeKeyboard,
    buildPlaylistVideoQualityKeyboard,
    buildVideoQualityKeyboard,
    clearKeyboard,
} from "../utils/keyboards";
import { selectAudioFormatWithFallback, selectVideoFormatWithFallback } from "../utils/format";
import { isSafeCallbackToken } from "../utils/validation";
import { MediaType, PlaylistMetadata, SessionData, VideoMetadata } from "../types";

const RESTRICTED_MESSAGE = "🚫 You're restricted from downloading media. Contact the admin for help.";

const GENERIC_ERROR_MESSAGE =
    "❌ Something went wrong while processing your request.\n\nPlease try again later. 💗";

export function registerCallbackHandler(client: TelegramClient) {
    client.addEventHandler(async (event) => {
        const data = event.data?.toString();
        if (!data) return;

        const parts = data.split("|");
        const [action, sid, extra] = parts;
        const chatId = event.chatId!;

        const callerId = String(event.senderId ?? chatId);
        const caller = await getUser(callerId);
        if (caller?.isBanned) {
            await event.answer({});
            return; // banned users are fully ignored, even on stale keyboards
        }

        // "✅ I've Joined" button — no session id, and it answers the query
        // itself (with a tailored alert/toast), so it's handled before the
        // generic blanket answer below and before any sid checks.
        if (action === "checkjoin") {
            const message = await event.getMessage();
            await handleCheckJoin(client, callerId, chatId, message?.id, (opts) => event.answer(opts));
            return;
        }

        await event.answer({});

        // Re-verify membership before any menu/download action — a user could
        // have left the channel after their session/menu was already created.
        const isMember = await requireMembership(client, callerId, chatId);
        if (!isMember) return;

        if (!sid || !isSafeCallbackToken(sid)) return;

        // The "🚫 Cancel" button uses `sid` as a job id, not a session id —
        // it doesn't need (and won't have) a session to look up.
        if (action === "cancel") {
            const message = await event.getMessage();
            const cancelled = cancelJob(sid);
            if (cancelled) {
                await editStyled(client, chatId, message?.id, "🚫 Download cancelled.", {
                    buttons: clearKeyboard(),
                });
            }
            return;
        }

        const session = getSession(sid);

        if (!session) {
            await event.answer({
                message: "This request expired. Please send the link again.",
                alert: true,
            });
            return;
        }

        const message = await event.getMessage();
        const statusMessageId = message?.id;

        try {
            switch (action) {
                case "menu":
                    await handleMenu(client, chatId, statusMessageId, sid, session, extra);
                    break;
                case "back":
                    await handleBack(client, chatId, statusMessageId, sid, session, extra);
                    break;
                case "vq":
                    await handleVideoQuality(client, chatId, statusMessageId, session, extra);
                    break;
                case "aq":
                    await handleAudioQuality(client, chatId, statusMessageId, session, extra);
                    break;
                case "plr":
                    await handlePlaylistRange(client, chatId, statusMessageId, sid, session, extra);
                    break;
                case "plt":
                    await handlePlaylistType(client, chatId, statusMessageId, sid, extra);
                    break;
                case "plq":
                    await handlePlaylistQuality(client, chatId, statusMessageId, sid, session, extra);
                    break;
                default:
                    break;
            }
        } catch (err) {
            console.error("Callback error:", err);

            await reportError(client, {
                userId: session.userId,
                chatId: session.chatId,
                username: session.username,
                url: session.meta.isPlaylist ? undefined : (session.meta as VideoMetadata).url,
                action,
                errorMessage: String((err as Error)?.message ?? err),
            });

            await sendStyled(client, chatId, GENERIC_ERROR_MESSAGE);
        }
    }, new CallbackQuery({}));
}

async function handleMenu(
    client: TelegramClient,
    chatId: any,
    statusMessageId: number | undefined,
    sid: string,
    session: SessionData,
    extra: string
) {
    if (session.meta.isPlaylist) return;
    const meta = session.meta as VideoMetadata;

    if (extra === "audio") {
        await editStyled(client, chatId, statusMessageId, "🎧 Select audio quality:", {
            buttons: buildAudioQualityKeyboard(sid, meta.audioFormats),
        });
    } else if (extra === "video") {
        await editStyled(client, chatId, statusMessageId, "🎬 Select video quality:", {
            buttons: buildVideoQualityKeyboard(sid, meta.videoFormats),
        });
    } else if (extra === "thumb") {
        await handleThumbnail(client, chatId, meta);
    }
}

async function handleBack(
    client: TelegramClient,
    chatId: any,
    statusMessageId: number | undefined,
    sid: string,
    session: SessionData,
    extra: string
) {
    if (extra === "menu" && !session.meta.isPlaylist) {
        const meta = session.meta as VideoMetadata;
        await editStyled(client, chatId, statusMessageId, `🎶 ${meta.title}\n\nChoose:`, {
            buttons: buildMainMenuKeyboard(sid),
        });
    } else if (extra === "plrange" && session.meta.isPlaylist) {
        const meta = session.meta as PlaylistMetadata;
        updateSession(sid, { playlistRange: undefined });
        await editStyled(
            client,
            chatId,
            statusMessageId,
            `🎶 Playlist detected\n\n📀 ${meta.title}\n🎵 ${meta.entries.length} videos\n\nChoose range:`,
            { buttons: buildPlaylistRangeKeyboard(sid, meta.entries.length) }
        );
    } else if (extra === "plmenu") {
        await editStyled(client, chatId, statusMessageId, "🎶 What do you want?", {
            buttons: buildPlaylistTypeKeyboard(sid),
        });
    }
}

async function handleVideoQuality(
    client: TelegramClient,
    chatId: any,
    statusMessageId: number | undefined,
    session: SessionData,
    extra: string
) {
    if (session.meta.isPlaylist) return;

    if (await isRestricted(session.userId)) {
        await sendStyled(client, chatId, RESTRICTED_MESSAGE);
        return;
    }

    const meta = session.meta as VideoMetadata;
    const format = meta.videoFormats.find((f) => f.quality === extra);

    if (!format) {
        await sendStyled(client, chatId, "❌ That quality is no longer available.");
        return;
    }

    await processMediaJob({
        client,
        chatId,
        userId: session.userId,
        username: session.username,
        url: meta.url,
        videoId: meta.id,
        title: meta.title,
        type: "video",
        quality: extra,
        video: format,
        statusMessageId,
    });
}

async function handleAudioQuality(
    client: TelegramClient,
    chatId: any,
    statusMessageId: number | undefined,
    session: SessionData,
    extra: string
) {
    if (session.meta.isPlaylist) return;

    if (await isRestricted(session.userId)) {
        await sendStyled(client, chatId, RESTRICTED_MESSAGE);
        return;
    }

    const meta = session.meta as VideoMetadata;
    const format = meta.audioFormats.find((f) => f.quality === extra);

    if (!format) {
        await sendStyled(client, chatId, "❌ That quality is no longer available.");
        return;
    }

    await processMediaJob({
        client,
        chatId,
        userId: session.userId,
        username: session.username,
        url: meta.url,
        videoId: meta.id,
        title: meta.title,
        type: "audio",
        quality: extra,
        audio: format,
        statusMessageId,
    });
}

async function isRestricted(userId: string): Promise<boolean> {
    const user = await getUser(userId);
    return user?.isRestricted ?? false;
}

async function handleThumbnail(client: TelegramClient, chatId: any, meta: VideoMetadata) {
    if (!meta.thumbnail) {
        await sendStyled(client, chatId, "❌ No thumbnail available for this video.");
        return;
    }

    let result: { path: string; workDir: string } | undefined;
    try {
        result = await downloadThumbnailFile(meta.thumbnail, meta.title);
        await client.sendFile(chatId, {
            file: result.path,
            caption: `🖼 ${meta.title}`,
            buttons: buildChannelGroupKeyboard(),
        });
    } finally {
        await cleanupWorkDir(result?.workDir);
    }
}

async function handlePlaylistRange(
    client: TelegramClient,
    chatId: any,
    statusMessageId: number | undefined,
    sid: string,
    session: SessionData,
    extra: string
) {
    if (!session.meta.isPlaylist) return;
    const meta = session.meta as PlaylistMetadata;
    const total = meta.entries.length;

    let range: { start: number; end: number };

    if (extra === "all") {
        range = { start: 1, end: total };
    } else {
        const [s, e] = extra.split("-").map(Number);
        if (!Number.isFinite(s) || !Number.isFinite(e) || s < 1 || e < s || e > total) {
            await sendStyled(client, chatId, "❌ Invalid range selected.");
            return;
        }
        range = { start: s, end: e };
    }

    updateSession(sid, { playlistRange: range });

    await editStyled(
        client,
        chatId,
        statusMessageId,
        `✅ Range set: ${range.start}-${range.end}\n\n🎶 What do you want?`,
        { buttons: buildPlaylistTypeKeyboard(sid) }
    );
}

async function handlePlaylistType(
    client: TelegramClient,
    chatId: any,
    statusMessageId: number | undefined,
    sid: string,
    extra: string
) {
    if (extra !== "audio" && extra !== "video") return;
    updateSession(sid, { playlistMediaType: extra as MediaType });

    if (extra === "video") {
        await editStyled(client, chatId, statusMessageId, "🎬 Select video quality:", {
            buttons: buildPlaylistVideoQualityKeyboard(sid),
        });
    } else {
        await editStyled(client, chatId, statusMessageId, "🎧 Select audio quality:", {
            buttons: buildPlaylistAudioQualityKeyboard(sid),
        });
    }
}

async function handlePlaylistQuality(
    client: TelegramClient,
    chatId: any,
    statusMessageId: number | undefined,
    sid: string,
    session: SessionData,
    extra: string
) {
    if (!session.meta.isPlaylist || !session.playlistRange || !session.playlistMediaType) return;

    if (await isRestricted(session.userId)) {
        await sendStyled(client, chatId, RESTRICTED_MESSAGE);
        return;
    }

    updateSession(sid, { playlistQuality: extra });

    await editStyled(client, chatId, statusMessageId, "🔮 Preparing your playlist download...");

    const refreshed = getSession(sid);
    if (refreshed) {
        await runPlaylistJob(client, chatId, refreshed);
    }
}

/**
 * Each playlist item now gets its OWN status message (instead of sharing
 * one), because processMediaJob deletes the status message when a job
 * finishes successfully — a shared message can't be reused for item N+1
 * after item N deleted it.
 */
async function runPlaylistJob(client: TelegramClient, chatId: any, session: SessionData) {
    const meta = session.meta as PlaylistMetadata;
    const range = session.playlistRange!;
    const type = session.playlistMediaType!;
    const targetQuality = session.playlistQuality!;

    const entries = meta.entries.filter((e) => e.index >= range.start && e.index <= range.end);

    await sendStyled(client, chatId, `🎶 Processing ${entries.length} videos...`);

    for (const entry of entries) {
        const itemStatus = await sendStyled(client, chatId, `🔮 Fetching info for video ${entry.index}...`);

        try {
            const itemMeta = await fetchVideoMetadata(entry.url);

            if (type === "video") {
                const { format, fellBack } = selectVideoFormatWithFallback(
                    itemMeta.videoFormats,
                    targetQuality
                );

                if (!format) {
                    await editStyled(
                        client,
                        chatId,
                        itemStatus.id,
                        `❌ Video ${entry.index} has no suitable quality and was skipped.`
                    );
                    continue;
                }

                if (fellBack) {
                    await sendStyled(
                        client,
                        chatId,
                        `⚠️ Video ${entry.index} doesn't have ${targetQuality}.\nUsing ${format.quality} instead.`
                    );
                }

                const result = await processMediaJob({
                    client,
                    chatId,
                    userId: session.userId,
                    username: session.username,
                    url: itemMeta.url,
                    videoId: itemMeta.id,
                    title: itemMeta.title,
                    type: "video",
                    quality: format.quality,
                    video: format,
                    statusMessageId: itemStatus.id,
                });

                if (!result.success && result.skippedReason?.startsWith("too_large")) {
                    await sendStyled(
                        client,
                        chatId,
                        `❌ Video ${entry.index} is larger than 2GB and was skipped.`
                    );
                }
            } else {
                const { format, fellBack } = selectAudioFormatWithFallback(
                    itemMeta.audioFormats,
                    targetQuality
                );

                if (!format) {
                    await editStyled(
                        client,
                        chatId,
                        itemStatus.id,
                        `❌ Video ${entry.index} has no suitable audio quality and was skipped.`
                    );
                    continue;
                }

                if (fellBack) {
                    await sendStyled(
                        client,
                        chatId,
                        `⚠️ Video ${entry.index} doesn't have ${targetQuality}.\nUsing ${format.quality} instead.`
                    );
                }

                const result = await processMediaJob({
                    client,
                    chatId,
                    userId: session.userId,
                    username: session.username,
                    url: itemMeta.url,
                    videoId: itemMeta.id,
                    title: itemMeta.title,
                    type: "audio",
                    quality: format.quality,
                    audio: format,
                    statusMessageId: itemStatus.id,
                });

                if (!result.success && result.skippedReason?.startsWith("too_large")) {
                    await sendStyled(
                        client,
                        chatId,
                        `❌ Video ${entry.index} is larger than 2GB and was skipped.`
                    );
                }
            }
        } catch (err) {
            await editStyled(client, chatId, itemStatus.id, `❌ Video ${entry.index} failed and was skipped.`);

            await reportError(client, {
                userId: session.userId,
                chatId: session.chatId,
                username: session.username,
                url: entry.url,
                action: type,
                quality: targetQuality,
                playlist: meta.title,
                errorMessage: String((err as Error)?.message ?? err),
            });
        }
    }

    await sendStyled(client, chatId, "❤️ Playlist processing complete!");
}