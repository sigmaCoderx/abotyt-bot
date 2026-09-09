import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export const DOWNLOAD_DIR = path.resolve("downloads");

export async function ensureDownloadDir(): Promise<void> {
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
}

/** Removes characters illegal on common filesystems and trims length. */
export function sanitizeFilename(name: string): string {
    const cleaned = name
        .replace(/[\/\\?%*:|"<>\u0000-\u001f]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    return cleaned.length ? cleaned.slice(0, 150) : "media";
}

export async function createWorkDir(): Promise<string> {
    await ensureDownloadDir();
    const dir = path.join(DOWNLOAD_DIR, crypto.randomBytes(8).toString("hex"));
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

export async function cleanupWorkDir(workDir?: string): Promise<void> {
    if (!workDir) return;

    try {
        await fs.rm(workDir, { recursive: true, force: true });
    } catch (err) {
        console.error(`Failed to clean up temp dir ${workDir}:`, err);
    }
}

export async function getFileSize(filePath: string): Promise<number> {
    const stat = await fs.stat(filePath);
    return stat.size;
}

/** Finds the media file produced by yt-dlp inside a work dir, ignoring partials. */
export async function findProducedFile(dir: string, extHint?: string): Promise<string> {
    const files = await fs.readdir(dir);
    const candidates = files.filter((f) => !f.endsWith(".part") && !f.endsWith(".ytdl"));

    const chosen = extHint
        ? candidates.find((f) => f.toLowerCase().endsWith(`.${extHint}`)) ?? candidates[0]
        : candidates[0];

    if (!chosen) {
        throw new Error("Expected output file was not found after download.");
    }

    return path.join(dir, chosen);
}
