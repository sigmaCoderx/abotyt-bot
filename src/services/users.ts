
import { getUsersCollection } from "../db/mongodb";
import { BotUser } from "../types";

/** Upserts the user's last-seen timestamp/username. Called on every incoming message. */
export async function touchUser(userId: string, username?: string): Promise<void> {
    try {
        await getUsersCollection().updateOne(
            { userId },
            {
                $set: { username, lastSeenAt: new Date() },
                $setOnInsert: { userId, firstSeenAt: new Date(), isBanned: false, isRestricted: false },
            },
            { upsert: true }
        );
    } catch (err) {
        console.error("Failed to record user activity:", err);
    }
}

export async function getUser(userId: string): Promise<BotUser | null> {
    try {
        return await getUsersCollection().findOne({ userId });
    } catch (err) {
        console.error("User lookup failed:", err);
        return null;
    }
}

/** Returns true if a matching user document was found and updated. */
export async function setBanned(userId: string, banned: boolean): Promise<boolean> {
    const res = await getUsersCollection().updateOne({ userId }, { $set: { isBanned: banned } });
    return res.matchedCount > 0;
}

/** Flips the user's restricted flag (restricted users can browse but not download). */
export async function toggleRestricted(userId: string): Promise<{ found: boolean; restricted: boolean }> {
    const user = await getUsersCollection().findOne({ userId });
    if (!user) return { found: false, restricted: false };

    const next = !user.isRestricted;
    await getUsersCollection().updateOne({ userId }, { $set: { isRestricted: next } });
    return { found: true, restricted: next };
}

export async function countUsers(): Promise<number> {
    return getUsersCollection().countDocuments();
}

/** All non-banned user ids, for /broadcast. */
export async function getBroadcastableUserIds(): Promise<string[]> {
    const docs = await getUsersCollection()
        .find({ isBanned: { $ne: true } }, { projection: { userId: 1 } })
        .toArray();

    return docs.map((d: { userId: string }) => d.userId);
}