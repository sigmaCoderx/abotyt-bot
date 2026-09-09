import { Api, TelegramClient } from "telegram";

import { config } from "../config/env";
import { getCacheCollection } from "../db/mongodb";
import { CacheEntry, MediaType } from "../types";

export async function findCachedMedia(
    videoId: string,
    type: MediaType,
    quality: string,
    formatId: string
): Promise<CacheEntry | null> {
    try {
        return await getCacheCollection().findOne({ videoId, type, quality, formatId });
    } catch (err) {
        console.error("Cache lookup failed:", err);
        return null;
    }
}

export async function saveCacheEntry(entry: CacheEntry): Promise<void> {
    try {
        await getCacheCollection().updateOne(
            { videoId: entry.videoId, type: entry.type, quality: entry.quality, formatId: entry.formatId },
            { $setOnInsert: entry },
            { upsert: true }
        );
    } catch (err) {
        console.error("Cache save failed:", err);
        throw err;
    }
}

/** Uploads a freshly downloaded file to the cache channel and returns the sent message. */
export async function uploadToCacheChannel(
    client: TelegramClient,
    filePath: string,
    caption?: string
): Promise<any> {
    const message = await client.sendFile(config.cacheChannelId, {
        file: filePath,
        caption,
    });

    return message;
}

/** Retrieves the cached message from the cache channel and re-sends it to the user. */
export async function sendCachedMediaToUser(
    client: TelegramClient,
    chatId: any,
    cache: CacheEntry,
    buttons?: Api.ReplyInlineMarkup
): Promise<void> {
    const messages = await client.getMessages(config.cacheChannelId, {
        ids: [cache.messageId],
    });

    const cachedMessage = messages?.[0];

    if (!cachedMessage || !cachedMessage.media) {
        throw new Error("Cached message not found or no longer has media attached.");
    }

    await client.sendFile(chatId, {
        file: cachedMessage.media,
        caption: cachedMessage.message || undefined,
        buttons,
    });
}
