
import { TelegramClient } from "telegram";

import { config } from "../config/env";
import { sendStyled } from "../utils/premiumText";
import { addAdmin, isAdmin, listAdmins } from "./adminAuth";
import { countUsers, getBroadcastableUserIds, setBanned, toggleRestricted } from "./users";

const NOT_AUTHORIZED = "🚫 You're not authorized to use this command.";

/** Every command handled here is admin-only except /totalusers. */
const KNOWN_COMMANDS = new Set([
    "addadmin",
    "listadmins",
    "totalusers",
    "ban",
    "unban",
    "restrictuser",
    "broadcast",
    "sendto",
]);

export function isKnownAdminCommand(command: string): boolean {
    return KNOWN_COMMANDS.has(command);
}

/**
 * Handles one of the commands above. Returns true once handled (including
 * "not authorized" replies) so the caller knows not to fall through to an
 * "unknown command" message.
 */
export async function dispatchAdminCommand(
    client: TelegramClient,
    chatId: any,
    userId: string,
    username: string | undefined,
    command: string,
    args: string
): Promise<boolean> {
    switch (command) {
        case "totalusers":
            return handleTotalUsers(client, chatId);
        case "addadmin":
            return handleAddAdmin(client, chatId, userId, args);
        case "listadmins":
            return handleListAdmins(client, chatId, userId);
        case "ban":
            return handleSetBanned(client, chatId, userId, args, true);
        case "unban":
            return handleSetBanned(client, chatId, userId, args, false);
        case "restrictuser":
            return handleRestrictUser(client, chatId, userId, args);
        case "broadcast":
            return handleBroadcast(client, chatId, userId, args);
        case "sendto":
            return handleSendTo(client, chatId, userId, args);
        default:
            return false;
    }
}

function firstArg(args: string): string | undefined {
    return args.trim().split(/\s+/)[0] || undefined;
}

function isNumericId(value: string | undefined): value is string {
    return !!value && /^\d+$/.test(value);
}

async function requireAdmin(client: TelegramClient, chatId: any, userId: string): Promise<boolean> {
    if (await isAdmin(userId)) return true;
    await sendStyled(client, chatId, NOT_AUTHORIZED);
    return false;
}

// -- /totalusers (public) ---------------------------------------------------

async function handleTotalUsers(client: TelegramClient, chatId: any): Promise<boolean> {
    const total = await countUsers();
    await sendStyled(client, chatId, `👥 Total users: ${total}`);
    return true;
}

// -- /addadmin <user_id> -----------------------------------------------------

async function handleAddAdmin(client: TelegramClient, chatId: any, userId: string, args: string): Promise<boolean> {
    if (!(await requireAdmin(client, chatId, userId))) return true;

    const targetId = firstArg(args);
    if (!isNumericId(targetId)) {
        await sendStyled(client, chatId, "❌ Usage: /addadmin <user_id>");
        return true;
    }

    try {
        const added = await addAdmin(targetId, undefined, userId);
        await sendStyled(
            client,
            chatId,
            added ? `✅ User ${targetId} is now an admin.` : `ℹ️ User ${targetId} is already an admin.`
        );
    } catch (err) {
        console.error("addAdmin failed:", err);
        await sendStyled(client, chatId, "❌ Failed to add admin.");
    }

    return true;
}

// -- /listadmins --------------------------------------------------------------

async function handleListAdmins(client: TelegramClient, chatId: any, userId: string): Promise<boolean> {
    if (!(await requireAdmin(client, chatId, userId))) return true;

    const admins = await listAdmins();
    if (!admins.length) {
        const ownerNote = config.ownerId ? " (the OWNER_ID account is always an admin)." : ".";
        await sendStyled(client, chatId, `ℹ️ No admins in the database yet${ownerNote}`);
        return true;
    }

    const lines = admins.map((a: { userId: string; username?: string }) =>
        `• ${a.userId}${a.username ? ` (@${a.username})` : ""}`
    );
    await sendStyled(client, chatId, `👑 Admins:\n\n${lines.join("\n")}`);
    return true;
}

// -- /ban <user_id> and /unban <user_id> --------------------------------------

async function handleSetBanned(
    client: TelegramClient,
    chatId: any,
    userId: string,
    args: string,
    banned: boolean
): Promise<boolean> {
    if (!(await requireAdmin(client, chatId, userId))) return true;

    const targetId = firstArg(args);
    if (!isNumericId(targetId)) {
        await sendStyled(client, chatId, `❌ Usage: /${banned ? "ban" : "unban"} <user_id>`);
        return true;
    }

    const found = await setBanned(targetId, banned);
    await sendStyled(
        client,
        chatId,
        found
            ? `✅ User ${targetId} has been ${banned ? "banned 🚫" : "unbanned ✅"}.`
            : `⚠️ User ${targetId} was not found in the database.`
    );
    return true;
}

// -- /restrictuser <user_id> (toggles) ----------------------------------------

async function handleRestrictUser(
    client: TelegramClient,
    chatId: any,
    userId: string,
    args: string
): Promise<boolean> {
    if (!(await requireAdmin(client, chatId, userId))) return true;

    const targetId = firstArg(args);
    if (!isNumericId(targetId)) {
        await sendStyled(client, chatId, "❌ Usage: /restrictuser <user_id>");
        return true;
    }

    const result = await toggleRestricted(targetId);
    if (!result.found) {
        await sendStyled(client, chatId, `⚠️ User ${targetId} was not found in the database.`);
    } else {
        await sendStyled(
            client,
            chatId,
            `✅ User ${targetId} is now ${result.restricted ? "restricted 🚫 (can't download)" : "unrestricted ✅"}.`
        );
    }
    return true;
}

// -- /broadcast <message> ------------------------------------------------------

async function handleBroadcast(client: TelegramClient, chatId: any, userId: string, args: string): Promise<boolean> {
    if (!(await requireAdmin(client, chatId, userId))) return true;

    const text = args.trim();
    if (!text) {
        await sendStyled(client, chatId, "❌ Usage: /broadcast <message>");
        return true;
    }

    const userIds = await getBroadcastableUserIds();
    await sendStyled(client, chatId, `📣 Broadcasting to ${userIds.length} user(s)...`);

    let sent = 0;
    let failed = 0;

    for (const uid of userIds) {
        try {
            await sendStyled(client, uid, text);
            sent++;
        } catch (err) {
            failed++;
            console.error(`Broadcast to ${uid} failed:`, err);
        }

        // Gentle throttle so we stay well under Telegram's per-second rate limits.
        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await sendStyled(client, chatId, `✅ Broadcast complete: ${sent} sent, ${failed} failed.`);
    return true;
}

// -- /sendto <user_id> <message> ------------------------------------------------

async function handleSendTo(client: TelegramClient, chatId: any, userId: string, args: string): Promise<boolean> {
    if (!(await requireAdmin(client, chatId, userId))) return true;

    const match = args.match(/^(\d+)\s+([\s\S]+)$/);
    if (!match) {
        await sendStyled(client, chatId, "❌ Usage: /sendto <user_id> <message>");
        return true;
    }

    const [, targetId, message] = match;

    try {
        await sendStyled(client, targetId, message);
        await sendStyled(client, chatId, `✅ Message sent to ${targetId}.`);
    } catch (err) {
        console.error("sendto failed:", err);
        await sendStyled(client, chatId, `❌ Failed to send message to ${targetId}. They may have blocked the bot.`);
    }

    return true;
}