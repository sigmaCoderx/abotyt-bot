
import { RangeParseResult } from "../types";

// Matches a YouTube URL anywhere inside a larger message (not the whole
// message), and tolerates extra/reordered query params so real-world pasted
// links (with tracking params, captions, etc.) aren't rejected.
const YOUTUBE_URL_PATTERN =
    /(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?[^\s]*?v=[\w-]{6,}[^\s]*|shorts\/[\w-]{6,}[^\s]*|embed\/[\w-]{6,}[^\s]*|playlist\?[^\s]*?list=[\w-]+[^\s]*)|youtu\.be\/[\w-]{6,}[^\s]*)/i;

/** Pulls the actual YouTube URL out of a message, or null if none is found. */
export function extractYouTubeUrl(text: string): string | null {
    const match = text.match(YOUTUBE_URL_PATTERN);
    if (!match) return null;

    let url = match[0].trim().replace(/[),.;!?]+$/, ""); // drop trailing punctuation
    if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
    }

    return url;
}

export function isValidYouTubeUrl(text: string): boolean {
    return extractYouTubeUrl(text) !== null;
}

export function isPlaylistUrl(url: string): boolean {
    return /youtube\.com\/playlist\?/i.test(url) && /[?&]list=/i.test(url);
}

export function parsePlaylistRange(input: string, total: number): RangeParseResult {
    const trimmed = input.trim().toLowerCase();

    if (trimmed === "all") {
        return { ok: true, start: 1, end: total };
    }

    const match = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);

    if (!match) {
        return {
            ok: false,
            error: "Invalid range format. Send something like 2-5, 1-9, or 'all'.",
        };
    }

    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);

    if (start < 1) {
        return { ok: false, error: "Start must be at least 1." };
    }

    if (end < start) {
        return { ok: false, error: "End must be greater than or equal to start." };
    }

    if (end > total) {
        return { ok: false, error: `This playlist only has ${total} videos.` };
    }

    return { ok: true, start, end };
}

/** Restricts callback-data extras to a small safe character set. */
export function isSafeCallbackToken(value: string): boolean {
    return /^[\w-]{1,32}$/.test(value);
}