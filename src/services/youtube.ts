

import youtubedl from "youtube-dl-exec";

import { config } from "../config/env";
import { buildAudioFormats, buildVideoFormats } from "../utils/format";
import { VideoMetadata } from "../types";

export async function fetchVideoMetadata(url: string): Promise<VideoMetadata> {
    const info: any = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        noPlaylist: true,
        skipDownload: true,
        ...(config.ytdlpCookiesFile ? { cookies: config.ytdlpCookiesFile } : {}),
    });

    const formats = Array.isArray(info.formats) ? info.formats : [];
    const duration: number | undefined = info.duration ?? undefined;

    return {
        isPlaylist: false,
        id: info.id,
        title: info.title ?? "video",
        uploader: info.uploader ?? info.channel ?? undefined,
        duration,
        thumbnail: info.thumbnail ?? undefined,
        url,
        videoFormats: buildVideoFormats(formats, duration),
        audioFormats: buildAudioFormats(formats, duration),
    };
}