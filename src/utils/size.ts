import { config } from "../config/env";

export const MAX_FILE_SIZE = config.maxFileSize || 2 * 1024 * 1024 * 1024;

export function exceedsLimit(size: number | null | undefined): boolean {
    if (size == null) return false;
    return size > MAX_FILE_SIZE;
}

export function humanSize(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let i = 0;

    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }

    return `${value.toFixed(2)} ${units[i]}`;
}
