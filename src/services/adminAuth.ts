
import { config } from "../config/env";
import { getAdminsCollection } from "../db/mongodb";
import { AdminEntry } from "../types";

/** The account named by OWNER_ID is always an admin, even with an empty admins collection. */
export function isOwner(userId: string): boolean {
    return !!config.ownerId && userId === config.ownerId;
}

export async function isAdmin(userId: string): Promise<boolean> {
    if (isOwner(userId)) return true;

    try {
        const found = await getAdminsCollection().findOne({ userId });
        return !!found;
    } catch (err) {
        console.error("Admin lookup failed:", err);
        return false;
    }
}

/** Returns true if this call actually inserted a new admin (false if they already were one). */
export async function addAdmin(userId: string, username: string | undefined, addedBy: string): Promise<boolean> {
    const res = await getAdminsCollection().updateOne(
        { userId },
        { $setOnInsert: { userId, username, addedAt: new Date(), addedBy } },
        { upsert: true }
    );

    return (res.upsertedCount ?? 0) > 0;
}

export async function listAdmins(): Promise<AdminEntry[]> {
    return getAdminsCollection().find({}).sort({ addedAt: 1 }).toArray();
}