
/**
 * Tracks in-flight downloads so a user can cancel one via the "🚫 Cancel"
 * button attached to its status message.
 *
 * A job is registered the moment it's queued (before the subprocess even
 * exists), with a stub `kill()` that just flips `cancelled`. Once the
 * actual yt-dlp subprocess starts, `attachKill()` upgrades that stub to one
 * that also kills the process. This means cancel works whether the job is
 * still waiting in the download queue or already downloading.
 */

export interface DownloadHandle {
    cancelled: boolean;
    kill: () => void;
}

const registry = new Map<string, DownloadHandle>();

export function registerJob(jobId: string): DownloadHandle {
    const handle: DownloadHandle = {
        cancelled: false,
        kill: () => {
            handle.cancelled = true;
        },
    };
    registry.set(jobId, handle);
    return handle;
}

/** Upgrades the stub kill() to one that also terminates the real subprocess. */
export function attachKill(jobId: string, kill: () => void): void {
    const handle = registry.get(jobId);
    if (!handle) return;

    handle.kill = () => {
        handle.cancelled = true;
        kill();
    };
}

export function isCancelled(jobId: string): boolean {
    return registry.get(jobId)?.cancelled ?? false;
}

/** Returns true if a matching job was found and told to stop. */
export function cancelJob(jobId: string): boolean {
    const handle = registry.get(jobId);
    if (!handle) return false;

    handle.kill();
    return true;
}

export function unregisterJob(jobId: string): void {
    registry.delete(jobId);
}