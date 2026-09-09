
import { Api } from "telegram";

import { config } from "../config/env";
import { AUDIO_LADDER, VIDEO_LADDER } from "./format";
import { humanSize } from "./size";
import { NormalizedAudioFormat, NormalizedVideoFormat } from "../types";

const AUDIO_EMOJIS = ["🔈", "🔈", "🎵", "🎵", "🎶", "🎼", "🎸"];

function btn(text: string, data: string): Api.KeyboardButtonCallback {
    return new Api.KeyboardButtonCallback({ text, data: Buffer.from(data) });
}

function urlBtn(text: string, url: string): Api.KeyboardButtonUrl {
    return new Api.KeyboardButtonUrl({ text, url });
}

function row(...buttons: Api.TypeKeyboardButton[]): Api.KeyboardButtonRow {
    return new Api.KeyboardButtonRow({ buttons });
}

function markup(rows: Api.KeyboardButtonRow[]): Api.ReplyInlineMarkup {
    return new Api.ReplyInlineMarkup({ rows });
}

function chunk<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        result.push(items.slice(i, i + size));
    }
    return result;
}

/** " (287.4 MB)" or "" when the size isn't known from metadata. */
function sizeSuffix(bytes: number | null): string {
    return bytes != null ? ` (${humanSize(bytes)})` : "";
}

/** Attached to the status message while a download is queued/in progress. */
export function buildCancelKeyboard(jobId: string): Api.ReplyInlineMarkup {
    return markup([row(btn("🚫 Cancel", `cancel|${jobId}`))]);
}

/** Removes any inline keyboard from a status message (e.g. once a download finishes). */
export function clearKeyboard(): undefined {
    return undefined;
}

/**
 * Attached to every media file delivered to the user (audio, video,
 * thumbnail, cache hits) — links to the channel and group, both displayed.
 */
export function buildChannelGroupKeyboard(): Api.ReplyInlineMarkup {
    return markup([
        row(
            urlBtn("📢 Channel", `https://t.me/${config.channelUsername}`),
            urlBtn("👥 Group", `https://t.me/${config.groupUsername}`)
        ),
    ]);
}

export function buildMainMenuKeyboard(sid: string): Api.ReplyInlineMarkup {
    return markup([
        row(btn("🎧 Audio", `menu|${sid}|audio`), btn("🎬 Video", `menu|${sid}|video`)),
        row(btn("🖼 Thumbnail", `menu|${sid}|thumb`)),
    ]);
}

/**
 * Buttons are built directly from the normalized formats (already filtered
 * to only qualities that actually exist, already in ascending order), so
 * each button can show its own real estimated file size next to it.
 * One quality per row for readability.
 */
export function buildVideoQualityKeyboard(
    sid: string,
    formats: NormalizedVideoFormat[]
): Api.ReplyInlineMarkup {
    const rows = chunk(formats, 1).map((pair) =>
        row(
            ...pair.map((f) =>
                btn(`📺 ${f.quality}${sizeSuffix(f.filesize)}`, `vq|${sid}|${f.quality}`)
            )
        )
    );

    rows.push(row(btn("⬅️ Back", `back|${sid}|menu`)));
    return markup(rows);
}

export function buildAudioQualityKeyboard(
    sid: string,
    formats: NormalizedAudioFormat[]
): Api.ReplyInlineMarkup {
    const rows = chunk(formats, 1).map((pair) =>
        row(
            ...pair.map((f) => {
                const idx = AUDIO_LADDER.indexOf(f.abr);
                return btn(
                    `${AUDIO_EMOJIS[idx] ?? "🎵"} ${f.quality}${sizeSuffix(f.filesize)}`,
                    `aq|${sid}|${f.quality}`
                );
            })
        )
    );

    rows.push(row(btn("⬅️ Back", `back|${sid}|menu`)));
    return markup(rows);
}

export function buildPlaylistRangeKeyboard(sid: string, total: number): Api.ReplyInlineMarkup {
    const chunkSize = 5;
    const rangeLabels: string[] = [];

    for (let start = 1; start <= total; start += chunkSize) {
        const end = Math.min(start + chunkSize - 1, total);
        rangeLabels.push(`${start}-${end}`);
    }

    const rows = chunk(rangeLabels, 2).map((pair) =>
        row(...pair.map((label) => btn(label, `plr|${sid}|${label}`)))
    );

    rows.push(row(btn("All", `plr|${sid}|all`)));
    return markup(rows);
}

export function buildPlaylistTypeKeyboard(sid: string): Api.ReplyInlineMarkup {
    return markup([
        row(btn("🎧 Audio", `plt|${sid}|audio`), btn("🎬 Video", `plt|${sid}|video`)),
        row(btn("⬅️ Back", `back|${sid}|plrange`)),
    ]);
}

// Playlist quality buttons can't show a size: each video's actual formats
// (and therefore sizes) aren't known until that item is fetched at download
// time, and the same quality is applied across many different videos.
// One quality per row for readability.
export function buildPlaylistVideoQualityKeyboard(sid: string): Api.ReplyInlineMarkup {
    const labels = VIDEO_LADDER.map((v) => v.label);
    const rows = chunk(labels, 1).map((pair) =>
        row(...pair.map((l) => btn(`📺 ${l}`, `plq|${sid}|${l}`)))
    );

    rows.push(row(btn("⬅️ Back", `back|${sid}|plmenu`)));
    return markup(rows);
}

export function buildPlaylistAudioQualityKeyboard(sid: string): Api.ReplyInlineMarkup {
    const labels = AUDIO_LADDER.map((a) => `${a}k`);
    const rows = chunk(labels, 1).map((pair, rowIdx) =>
        row(
            ...pair.map((l, colIdx) => {
                const idx = rowIdx + colIdx;
                return btn(`${AUDIO_EMOJIS[idx] ?? "🎵"} ${l}`, `plq|${sid}|${l}`);
            })
        )
    );

    rows.push(row(btn("⬅️ Back", `back|${sid}|plmenu`)));
    return markup(rows);
}