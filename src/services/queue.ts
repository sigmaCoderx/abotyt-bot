import { config } from "../config/env";

class DownloadQueue {
    private active = 0;
    private waiting: Array<() => void> = [];

    async run<T>(task: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await task();
        } finally {
            this.release();
        }
    }

    private acquire(): Promise<void> {
        if (this.active < config.maxConcurrentDownloads) {
            this.active++;
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            this.waiting.push(() => {
                this.active++;
                resolve();
            });
        });
    }

    private release(): void {
        this.active--;
        const next = this.waiting.shift();
        if (next) next();
    }
}

export const downloadQueue = new DownloadQueue();
