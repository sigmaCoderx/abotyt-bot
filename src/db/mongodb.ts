

import { Collection, MongoClient } from "mongodb";

import { config } from "../config/env";
import { AdminEntry, BotUser, CacheEntry } from "../types";

let client: MongoClient | undefined;
let cacheCollection: Collection<CacheEntry> | undefined;
let usersCollection: Collection<BotUser> | undefined;
let adminsCollection: Collection<AdminEntry> | undefined;

/**
 * Wraps createIndex so one bad/pre-existing index (e.g. leftover documents
 * with a null/missing key from earlier testing) logs a warning and lets the
 * bot start instead of crashing the whole process on every restart.
 */
async function safeCreateIndex(
    collection: Collection<any>,
    spec: Record<string, 1 | -1>,
    options: Parameters<Collection<any>["createIndex"]>[1]
): Promise<void> {
    try {
        await collection.createIndex(spec, options);
    } catch (err) {
        console.error(
            `⚠️  Could not create index "${options?.name}" on "${collection.collectionName}" — ` +
                `the bot will still start, but duplicate/invalid data may exist in this collection:`,
            (err as Error)?.message ?? err
        );
    }
}

export async function connectMongo(): Promise<void> {
    client = new MongoClient(config.mongodbUri);
    await client.connect();

    const db = client.db(config.mongoDbName);
    cacheCollection = db.collection<CacheEntry>("media_cache");
    usersCollection = db.collection<BotUser>("users");
    adminsCollection = db.collection<AdminEntry>("admins");

    // Compound index so we never return a mismatched quality/format,
    // and never create duplicate cache rows for the same media.
    await safeCreateIndex(
        cacheCollection,
        { videoId: 1, type: 1, quality: 1, formatId: 1 },
        { unique: true, name: "cache_identity_idx" }
    );

    // partialFilterExpression restricts the unique constraint to documents
    // that actually have a string userId. Without it, Mongo treats every
    // document missing the field as userId: null, and a *second* such
    // document — leftover from earlier testing, a partial insert, etc. —
    // fails the whole index build with E11000 on every startup.
    await safeCreateIndex(
        usersCollection,
        { userId: 1 },
        {
            unique: true,
            name: "users_identity_idx",
            partialFilterExpression: { userId: { $type: "string" } },
        }
    );

    await safeCreateIndex(
        adminsCollection,
        { userId: 1 },
        {
            unique: true,
            name: "admins_identity_idx",
            partialFilterExpression: { userId: { $type: "string" } },
        }
    );

    console.log("✅ MongoDB connected");
}

export function getCacheCollection(): Collection<CacheEntry> {
    if (!cacheCollection) {
        throw new Error("MongoDB has not been connected yet. Call connectMongo() first.");
    }

    return cacheCollection;
}

export function getUsersCollection(): Collection<BotUser> {
    if (!usersCollection) {
        throw new Error("MongoDB has not been connected yet. Call connectMongo() first.");
    }

    return usersCollection;
}

export function getAdminsCollection(): Collection<AdminEntry> {
    if (!adminsCollection) {
        throw new Error("MongoDB has not been connected yet. Call connectMongo() first.");
    }

    return adminsCollection;
}

export async function disconnectMongo(): Promise<void> {
    await client?.close();
}