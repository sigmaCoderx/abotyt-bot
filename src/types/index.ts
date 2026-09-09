export type MediaType = "video" | "audio";

export interface NormalizedVideoFormat {
    /** Normalized label, e.g. "720p" */
    quality: string;
    height: number;
    /** Format expression to pass to yt-dlp, e.g. "22" or "137+140" */
    formatId: string;
    videoFormatId: string;
    /** Present only for DASH (video-only) streams that need pairing with audio */
    audioFormatId?: string;
    isProgressive: boolean;
    ext: string;
    /** Best available size estimate in bytes, or null if unknown */
    filesize: number | null;
    fps?: number;
    width?: number;
}

export interface NormalizedAudioFormat {
    /** Normalized label, e.g. "128k" */
    quality: string;
    abr: number;
    formatId: string;
    ext: string;
    filesize: number | null;
}

export interface VideoMetadata {
    isPlaylist: false;
    id: string;
    title: string;
    uploader?: string;
    duration?: number;
    thumbnail?: string;
    url: string;
    videoFormats: NormalizedVideoFormat[];
    audioFormats: NormalizedAudioFormat[];
}

export interface PlaylistEntryMeta {
    id: string;
    title: string;
    url: string;
    /** 1-based position within the playlist */
    index: number;
}

export interface PlaylistMetadata {
    isPlaylist: true;
    id: string;
    title: string;
    entries: PlaylistEntryMeta[];
}

export interface CacheEntry {
    videoId: string;
    type: MediaType;
    quality: string;
    formatId: string;
    filename: string;
    channelId: string;
    messageId: number;
    createdAt: Date;
}

export interface SessionData {
    id: string;
    chatId: string;
    userId: string;
    username?: string;
    createdAt: number;
    meta: VideoMetadata | PlaylistMetadata;
    playlistRange?: { start: number; end: number };
    playlistMediaType?: MediaType;
    playlistQuality?: string;
}

export type RangeParseResult =
    | { ok: true; start: number; end: number }
    | { ok: false; error: string };



export interface BotUser {
    userId: string;
    username?: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
    isBanned: boolean;
    isRestricted: boolean;
}

export interface AdminEntry {
    userId: string;
    username?: string;
    addedAt: Date;
    addedBy: string;
}