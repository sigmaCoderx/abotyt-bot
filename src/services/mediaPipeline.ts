

import crypto from "crypto";
import path from "path";

import { TelegramClient } from "telegram";

import { config } from "../config/env";
import { findCachedMedia, saveCacheEntry, sendCachedMediaToUser, uploadToCacheChannel } from "./cache";
import { DownloadCancelledError, downloadAudioFile, downloadVideoFile } from "./downloader";
import { cleanupWorkDir, getFileSize } from "../utils/files";
import { buildProgressBar, deleteOrFinish, editStyled } from "../utils/premiumText";
import { exceedsLimit } from "../utils/size";
import { downloadQueue } from "./queue";
import { reportError } from "./admin";
import { attachKill, isCancelled, registerJob, unregisterJob } from "../state/activeDownloads";
import { buildCancelKeyboard, buildChannelGroupKeyboard, clearKeyboard } from "../utils/keyboards";
import { MediaType, NormalizedAudioFormat, NormalizedVideoFormat } from "../types";

export interface MediaJobParams {
    client: TelegramClient;
    chatId: any;
    userId: string;
    username?: string;
    url: string;
    videoId: string;
    title: string;
    type: MediaType;
    quality: string;
    video?: NormalizedVideoFormat;
    audio?: NormalizedAudioFormat;
    statusMessageId?: number;
}

export interface MediaJobResult {
    success: boolean;
    skippedReason?: "too_large_estimated" | "too_large_actual" | "error" | "cancelled";
}

/**
 * Builds a throttled progress callback: edits the status message with a
 * progress bar and a "🚫 Cancel" button, but never more than once every
 * ~1.2s and only on a meaningful jump (>=5%) or right as it crosses 99%,
 * to stay well under Telegram's edit rate limits while still feeling
 * responsive.
 */
function createProgressReporter(
    client: TelegramClient,
    chatId: any,
    statusMessageId: number | undefined,
    label: string,
    barEmoji: string,
    jobId: string
) {
    let lastPercent = -1;
    let lastEditAt = 0;

    return (percent: number) => {
        const now = Date.now();
        const rounded = Math.min(100, Math.round(percent));
        const bigJump = rounded - lastPercent >= 5;
        const nearEnd = rounded >= 99 && lastPercent < 99;
        const throttleOk = now - lastEditAt >= 1200;

        if ((bigJump || nearEnd) && throttleOk) {
            lastPercent = rounded;
            lastEditAt = now;
            editStyled(client, chatId, statusMessageId, `${label}\n${buildProgressBar(rounded, barEmoji)}`, {
                buttons: buildCancelKeyboard(jobId),
            }).catch(() => {});
        }
    };
}

export async function processMediaJob(params: MediaJobParams): Promise<MediaJobResult> {
    const { client, chatId, url, videoId, title, type, quality, statusMessageId } = params;

    const formatId = type === "video" ? params.video!.formatId : params.audio!.formatId;
    const estFilesize = type === "video" ? params.video!.filesize : params.audio!.filesize;

    if (exceedsLimit(estFilesize)) {
        await editStyled(
            client,
            chatId,
            statusMessageId,
            "❌ This file is too large.\n\nPlease select a lower quality."
        );
        return { success: false, skippedReason: "too_large_estimated" };
    }

    await editStyled(client, chatId, statusMessageId, "🔮 Checking cache...");

    const cached = await findCachedMedia(videoId, type, quality, formatId);

    if (cached) {
        try {
            await editStyled(client, chatId, statusMessageId, "💞 Found in cache!");
            await sendCachedMediaToUser(client, chatId, cached, buildChannelGroupKeyboard());
            await deleteOrFinish(client, chatId, statusMessageId);
            return { success: true };
        } catch (err) {
            console.error("Cache retrieval failed, falling back to a fresh download:", err);
        }
    }

    // Each fresh download gets its own cancellation handle, so the
    // "🚫 Cancel" button attached to the status message can stop it —
    // whether it's still waiting in the queue or actively downloading.
    const jobId = crypto.randomBytes(5).toString("hex");
    registerJob(jobId);

    let downloadResult: { path: string; workDir: string } | undefined;

    try {
        await editStyled(client, chatId, statusMessageId, "⏳ Queued for download...", {
            buttons: buildCancelKeyboard(jobId),
        });

        return await downloadQueue.run(async () => {
            if (isCancelled(jobId)) throw new DownloadCancelledError();

            const label = type === "video" ? "🎬 Downloading video..." : "🎧 Downloading audio...";
            const barEmoji = type === "video" ? "🎶" : "🎵";

            await editStyled(client, chatId, statusMessageId, label, { buttons: buildCancelKeyboard(jobId) });

            const onProgress = createProgressReporter(client, chatId, statusMessageId, label, barEmoji, jobId);
            const onKillable = (kill: () => void) => attachKill(jobId, kill);

            downloadResult =
                type === "video"
                    ? await downloadVideoFile(url, formatId, title, onProgress, onKillable)
                    : await downloadAudioFile(url, formatId, params.audio!.abr, title, onProgress, onKillable);

            await editStyled(client, chatId, statusMessageId, "🎶 Processing...", { buttons: clearKeyboard() });

            const actualSize = await getFileSize(downloadResult.path);

            if (exceedsLimit(actualSize)) {
                await editStyled(
                    client,
                    chatId,
                    statusMessageId,
                    "❌ This file is too large.\n\nPlease select a lower quality."
                );
                return { success: false, skippedReason: "too_large_actual" as const };
            }

            await editStyled(client, chatId, statusMessageId, "🤩 Uploading...", { buttons: clearKeyboard() });

            // Upload to the cache channel ONCE, then hand the user that same
            // message's media BY REFERENCE (a fast, server-side Telegram
            // copy) instead of re-uploading the same file bytes from disk a
            // second time. That second local upload was the delay between
            // "sent to cache" and "sent to user" — now there's only one
            // upload total on a fresh download, same as a cache hit.
            let cacheMessage: any;
            try {
                cacheMessage = await uploadToCacheChannel(client, downloadResult.path, title);
                await saveCacheEntry({
                    videoId,
                    type,
                    quality,
                    formatId,
                    filename: path.basename(downloadResult.path),
                    channelId: String(config.cacheChannelId),
                    messageId: cacheMessage.id,
                    createdAt: new Date(),
                });
            } catch (err) {
                await reportError(client, {
                    userId: params.userId,
                    chatId,
                    username: params.username,
                    url,
                    action: type,
                    quality,
                    errorMessage: `Cache upload/save failed: ${String((err as Error)?.message ?? err)}`,
                });
            }

            if (cacheMessage?.media) {
                // Fast path: forward the already-uploaded media by reference.
                await client.sendFile(chatId, {
                    file: cacheMessage.media,
                    caption: title,
                    buttons: buildChannelGroupKeyboard(),
                });
            } else {
                // Cache upload failed — fall back to sending the local file directly.
                await client.sendFile(chatId, {
                    file: downloadResult.path,
                    caption: title,
                    buttons: buildChannelGroupKeyboard(),
                });
            }

            await deleteOrFinish(client, chatId, statusMessageId);

            return { success: true };
        });
    } catch (err) {
        if (err instanceof DownloadCancelledError) {
            await editStyled(client, chatId, statusMessageId, "🚫 Download cancelled.", {
                buttons: clearKeyboard(),
            });
            return { success: false, skippedReason: "cancelled" };
        }

        await editStyled(
            client,
            chatId,
            statusMessageId,
            "❌ Something went wrong while processing your request.\n\nPlease try again later. 💗",
            { buttons: clearKeyboard() }
        );

        await reportError(client, {
            userId: params.userId,
            chatId,
            username: params.username,
            url,
            action: type,
            quality,
            errorMessage: String((err as Error)?.message ?? err),
        });

        return { success: false, skippedReason: "error" };
    } finally {
        unregisterJob(jobId);
        await cleanupWorkDir(downloadResult?.workDir);
    }
}