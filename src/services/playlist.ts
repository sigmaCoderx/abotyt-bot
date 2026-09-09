import youtubedl from "youtube-dl-exec";

import { config } from "../config/env";
import { PlaylistEntryMeta, PlaylistMetadata } from "../types";

/**
 * Inspects playlist metadata WITHOUT downloading anything and without
 * fetching full per-video format info (fast, flat listing only).
 * Full format info for each selected video is fetched lazily at download time.
 */
export async function fetchPlaylistMetadata(url: string): Promise<PlaylistMetadata> {
    const info: any = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        flatPlaylist: true,
        skipDownload: true,
        ...(config.ytdlpCookiesFile ? { cookies: config.ytdlpCookiesFile } : {}),
    });

    const entriesRaw: any[] = Array.isArray(info.entries) ? info.entries : [];

    const entries: PlaylistEntryMeta[] = entriesRaw
        .filter((e) => e && (e.id || e.url))
        .map((e, idx) => ({
            id: e.id,
            title: e.title ?? `Video ${idx + 1}`,
            url: typeof e.url === "string" && e.url.startsWith("http")
                ? e.url
                : `https://www.youtube.com/watch?v=${e.id}`,
            index: idx + 1,
        }));

    return {
        isPlaylist: true,
        id: info.id ?? "playlist",
        title: info.title ?? "Playlist",
        entries,
    };
}
