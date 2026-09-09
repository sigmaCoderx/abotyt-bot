

import fs from "fs/promises";
import path from "path";

import youtubedl from "youtube-dl-exec";

import { config } from "../config/env";
import { createWorkDir, cleanupWorkDir, findProducedFile, sanitizeFilename } from "../utils/files";

export interface DownloadResult {
    path: string;
    workDir: string;
}

export type ProgressHandler = (percent: number) => void;

/** Called once the real subprocess exists, with a function that kills it. */
export type KillableHandler = (kill: () => void) => void;

export class DownloadCancelledError extends Error {
    constructor() {
        super("Download cancelled by user");
        this.name = "DownloadCancelledError";
    }
}

const PROGRESS_PATTERN = /\[download\]\s+([\d.]+)%/;

/**
 * Listens to a yt-dlp subprocess' stdout and parses download percentage
 * lines like "[download]  45.2% of ~10.00MiB at 1.20MiB/s ETA 00:05".
 */
function attachProgress(subprocess: any, onProgress?: ProgressHandler): void {
    if (!onProgress || !subprocess?.stdout) return;

    let buffer = "";
    subprocess.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r|\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
            const match = line.match(PROGRESS_PATTERN);
            if (match) {
                const percent = parseFloat(match[1]);
                if (!Number.isNaN(percent)) onProgress(percent);
            }
        }
    });
}

/**
 * Runs yt-dlp with the given options. If the installed youtube-dl-exec
 * version exposes `.exec()` (raw subprocess access), we use it to stream
 * progress and to support cancellation; otherwise we fall back to the
 * plain promise call with no progress reporting/cancellation, so downloads
 * never break even if `.exec` is missing.
 *
 * The subprocess is spawned detached (its own process group) so that when
 * cancelled we can kill the whole group with `process.kill(-pid)` — yt-dlp
 * often spawns ffmpeg as a child of its own to merge video+audio, and
 * killing only the yt-dlp process would leave that ffmpeg process running.
 */
async function runDownload(
    url: string,
    options: Record<string, any>,
    onProgress?: ProgressHandler,
    onKillable?: KillableHandler
): Promise<void> {
    const execFn = (youtubedl as any).exec;

    if (typeof execFn === "function") {
        const subprocess = execFn(url, options, { detached: true });
        attachProgress(subprocess, onProgress);

        let cancelled = false;
        onKillable?.(() => {
            cancelled = true;
            try {
                if (subprocess.pid) {
                    // Negative pid == kill the whole process group (POSIX only).
                    process.kill(-subprocess.pid, "SIGKILL");
                } else {
                    subprocess.kill("SIGKILL");
                }
            } catch {
                try {
                    subprocess.kill("SIGKILL");
                } catch {
                    // process may have already exited — nothing left to do
                }
            }
        });

        try {
            await subprocess;
        } catch (err) {
            if (cancelled) throw new DownloadCancelledError();
            throw err;
        }
        return;
    }

    await youtubedl(url, options as any);
}

export async function downloadVideoFile(
    url: string,
    formatSpec: string,
    title: string,
    onProgress?: ProgressHandler,
    onKillable?: KillableHandler
): Promise<DownloadResult> {
    const workDir = await createWorkDir();
    const outputTemplate = path.join(workDir, "media.%(ext)s");

    try {
        await runDownload(
            url,
            {
                output: outputTemplate,
                format: formatSpec,
                mergeOutputFormat: "mp4",
                noPlaylist: true,
                noWarnings: true,
                noCheckCertificates: true,
                newline: true,
                ...(config.ytdlpCookiesFile ? { cookies: config.ytdlpCookiesFile } : {}),
            },
            onProgress,
            onKillable
        );
    } catch (err) {
        await cleanupWorkDir(workDir);
        throw err;
    }

    const produced = await findProducedFile(workDir, "mp4");
    const finalPath = path.join(workDir, `${sanitizeFilename(title)}.mp4`);
    if (produced !== finalPath) await fs.rename(produced, finalPath);

    return { path: finalPath, workDir };
}

export async function downloadAudioFile(
    url: string,
    formatId: string,
    abrTarget: number,
    title: string,
    onProgress?: ProgressHandler,
    onKillable?: KillableHandler
): Promise<DownloadResult> {
    const workDir = await createWorkDir();
    const outputTemplate = path.join(workDir, "media.%(ext)s");

    try {
        await runDownload(
            url,
            {
                output: outputTemplate,
                format: formatId,
                extractAudio: true,
                audioFormat: "mp3",
                audioQuality: `${abrTarget}K`,
                noPlaylist: true,
                noWarnings: true,
                noCheckCertificates: true,
                newline: true,
                ...(config.ytdlpCookiesFile ? { cookies: config.ytdlpCookiesFile } : {}),
            },
            onProgress,
            onKillable
        );
    } catch (err) {
        await cleanupWorkDir(workDir);
        throw err;
    }

    const produced = await findProducedFile(workDir, "mp3");
    const finalPath = path.join(workDir, `${sanitizeFilename(title)}.mp3`);
    if (produced !== finalPath) await fs.rename(produced, finalPath);

    return { path: finalPath, workDir };
}

export async function downloadThumbnailFile(
    thumbnailUrl: string,
    title: string
): Promise<DownloadResult> {
    const workDir = await createWorkDir();

    const res = await fetch(thumbnailUrl);
    if (!res.ok) {
        throw new Error(`Failed to fetch thumbnail (HTTP ${res.status})`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const ext = thumbnailUrl.toLowerCase().includes(".webp") ? "webp" : "jpg";
    const finalPath = path.join(workDir, `${sanitizeFilename(title)}.${ext}`);

    await fs.writeFile(finalPath, buf);
    return { path: finalPath, workDir };
}