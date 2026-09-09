
import { NormalizedAudioFormat, NormalizedVideoFormat } from "../types";

export interface RawFormat {
    format_id: string;
    ext?: string;
    height?: number;
    width?: number;
    fps?: number;
    vcodec?: string;
    acodec?: string;
    abr?: number;
    tbr?: number;
    filesize?: number;
    filesize_approx?: number;
    format_note?: string;
}

export const VIDEO_LADDER: { label: string; height: number }[] = [
    { label: "140p", height: 144 },
    { label: "240p", height: 240 },
    { label: "360p", height: 360 },
    { label: "480p", height: 480 },
    { label: "720p", height: 720 },
    { label: "1080p", height: 1080 },
];

export const AUDIO_LADDER: number[] = [64, 96, 128, 160, 192, 256, 320];

const STANDARD_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160];

function snapHeight(height: number): number {
    let closest = STANDARD_HEIGHTS[0];
    let bestDiff = Infinity;
    for (const s of STANDARD_HEIGHTS) {
        const diff = Math.abs(s - height);
        if (diff < bestDiff) {
            bestDiff = diff;
            closest = s;
        }
    }
    return closest;
}

function snapAbr(abr: number): number {
    let closest = AUDIO_LADDER[0];
    let bestDiff = Infinity;
    for (const s of AUDIO_LADDER) {
        const diff = Math.abs(s - abr);
        if (diff < bestDiff) {
            bestDiff = diff;
            closest = s;
        }
    }
    return closest;
}

/**
 * Real filesize when yt-dlp gives it to us, otherwise a bitrate*duration
 * estimate (this is what fixes video qualities showing no size — DASH
 * video-only streams frequently lack filesize/filesize_approx, unlike audio).
 */
function estimateFilesize(f: RawFormat, durationSeconds?: number): number | null {
    if (f.filesize != null) return f.filesize;
    if (f.filesize_approx != null) return f.filesize_approx;

    const bitrateKbps = f.tbr ?? f.abr;
    if (bitrateKbps && durationSeconds) {
        return Math.round(((bitrateKbps * 1000) / 8) * durationSeconds);
    }

    return null;
}

function bestAudioOnly(formats: RawFormat[]): RawFormat | undefined {
    const audioOnly = formats.filter(
        (f) => (!f.vcodec || f.vcodec === "none") && f.acodec && f.acodec !== "none"
    );

    if (!audioOnly.length) return undefined;

    return audioOnly.sort((a, b) => {
        const abrA = a.abr ?? a.tbr ?? 0;
        const abrB = b.abr ?? b.tbr ?? 0;
        if (abrB !== abrA) return abrB - abrA;

        const extScore = (f: RawFormat) => (f.ext === "m4a" ? 2 : f.ext === "webm" ? 1 : 0);
        return extScore(b) - extScore(a);
    })[0];
}

export function buildVideoFormats(
    formats: RawFormat[],
    durationSeconds?: number
): NormalizedVideoFormat[] {
    const videoCandidates = formats.filter((f) => f.vcodec && f.vcodec !== "none" && f.height);
    if (!videoCandidates.length) return [];

    const bestAudio = bestAudioOnly(formats);
    const groups = new Map<number, RawFormat[]>();

    for (const f of videoCandidates) {
        const snapped = snapHeight(f.height!);
        if (!groups.has(snapped)) groups.set(snapped, []);
        groups.get(snapped)!.push(f);
    }

    const result: NormalizedVideoFormat[] = [];

    for (const step of VIDEO_LADDER) {
        const group = groups.get(step.height);
        if (!group || !group.length) continue;

        const best = [...group].sort((a, b) => {
            const extScore = (f: RawFormat) => (f.ext === "mp4" ? 1 : 0);
            const scoreDiff = extScore(b) - extScore(a);
            if (scoreDiff !== 0) return scoreDiff;
            return (b.tbr ?? 0) - (a.tbr ?? 0);
        })[0];

        const hasAudio = !!best.acodec && best.acodec !== "none";

        if (hasAudio) {
            result.push({
                quality: step.label,
                height: step.height,
                formatId: best.format_id,
                videoFormatId: best.format_id,
                isProgressive: true,
                ext: best.ext ?? "mp4",
                filesize: estimateFilesize(best, durationSeconds),
                fps: best.fps,
                width: best.width,
            });
        } else if (bestAudio) {
            const videoSize = estimateFilesize(best, durationSeconds);
            const audioSize = estimateFilesize(bestAudio, durationSeconds);
            const combinedSize =
                videoSize != null && audioSize != null ? videoSize + audioSize : null;

            result.push({
                quality: step.label,
                height: step.height,
                formatId: `${best.format_id}+${bestAudio.format_id}`,
                videoFormatId: best.format_id,
                audioFormatId: bestAudio.format_id,
                isProgressive: false,
                ext: "mp4",
                filesize: combinedSize,
                fps: best.fps,
                width: best.width,
            });
        }
    }

    return result;
}

export function buildAudioFormats(
    formats: RawFormat[],
    durationSeconds?: number
): NormalizedAudioFormat[] {
    const audioCandidates = formats.filter(
        (f) => (!f.vcodec || f.vcodec === "none") && f.acodec && f.acodec !== "none"
    );
    if (!audioCandidates.length) return [];

    const groups = new Map<number, RawFormat[]>();

    for (const f of audioCandidates) {
        const abr = f.abr ?? f.tbr;
        if (!abr) continue;
        const snapped = snapAbr(abr);
        if (!groups.has(snapped)) groups.set(snapped, []);
        groups.get(snapped)!.push(f);
    }

    const result: NormalizedAudioFormat[] = [];

    for (const bitrate of AUDIO_LADDER) {
        const group = groups.get(bitrate);
        if (!group || !group.length) continue;

        const best = [...group].sort((a, b) => {
            const extScore = (f: RawFormat) => (f.ext === "m4a" ? 1 : 0);
            const scoreDiff = extScore(b) - extScore(a);
            if (scoreDiff !== 0) return scoreDiff;
            return (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0);
        })[0];

        result.push({
            quality: `${bitrate}k`,
            abr: bitrate,
            formatId: best.format_id,
            ext: best.ext ?? "m4a",
            filesize: estimateFilesize(best, durationSeconds),
        });
    }

    return result;
}

export function selectVideoFormatWithFallback(
    formats: NormalizedVideoFormat[],
    requestedLabel: string
): { format: NormalizedVideoFormat | null; fellBack: boolean } {
    const order = VIDEO_LADDER.map((v) => v.label);
    const requestedIndex = order.indexOf(requestedLabel);
    if (requestedIndex === -1) return { format: null, fellBack: false };

    for (let i = requestedIndex; i >= 0; i--) {
        const found = formats.find((f) => f.quality === order[i]);
        if (found) return { format: found, fellBack: i !== requestedIndex };
    }

    return { format: null, fellBack: false };
}

export function selectAudioFormatWithFallback(
    formats: NormalizedAudioFormat[],
    requestedLabel: string
): { format: NormalizedAudioFormat | null; fellBack: boolean } {
    const order = AUDIO_LADDER.map((a) => `${a}k`);
    const requestedIndex = order.indexOf(requestedLabel);
    if (requestedIndex === -1) return { format: null, fellBack: false };

    for (let i = requestedIndex; i >= 0; i--) {
        const found = formats.find((f) => f.quality === order[i]);
        if (found) return { format: found, fellBack: i !== requestedIndex };
    }

    return { format: null, fellBack: false };
}