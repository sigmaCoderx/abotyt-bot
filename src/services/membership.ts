import { Api, TelegramClient } from "telegram";

import { config } from "../config/env";
import { isAdmin } from "./adminAuth";
import { editStyled, sendStyled } from "../utils/premiumText";

export const JOIN_REQUIRED_MESSAGE =
    `🔒 Join our channel to use this bot!\n\n` +
    `📢 Please join ${config.forceJoinChannelTitle} first, then tap "✅ I've Joined" below.`;

const NOT_JOINED_YET_ALERT = "❌ You haven't joined the channel yet. Please join first.";
const JOIN_CONFIRMED_MESSAGE = "✅ Thanks for joining! You can now send me a YouTube link. 🎶";

/** Builds the inline keyboard attached to the "please join" prompt. */
export function buildJoinKeyboard(): Api.ReplyInlineMarkup {
    return new Api.ReplyInlineMarkup({
        rows: [
            new Api.KeyboardButtonRow({
                buttons: [
                    new Api.KeyboardButtonUrl({
                        text: "📢 Join Channel",
                        url: `https://t.me/${config.channelUsername}`,
                    }),
                ],
            }),
            new Api.KeyboardButtonRow({
                buttons: [
                    new Api.KeyboardButtonCallback({
                        text: "✅ I've Joined",
                        data: Buffer.from("checkjoin"),
                    }),
                ],
            }),
        ],
    });
}

/**
 * Checks whether `userId` is currently a member (or admin/creator) of the
 * force-join channel. Returns false for users who left/were kicked, and
 * false (fail-closed) if membership can't be determined.
 */
export async function isChannelMember(client: TelegramClient, userId: string): Promise<boolean> {
    try {
        const result = await client.invoke(
            new Api.channels.GetParticipant({
                channel: config.forceJoinChannelId,
                participant: userId,
            })
        );

        const participant = result.participant;

        // Someone who left or was banned still resolves here — exclude both.
        if (
            participant instanceof Api.ChannelParticipantLeft ||
            participant instanceof Api.ChannelParticipantBanned
        ) {
            return false;
        }

        return true;
    } catch (err) {
        const message = String((err as Error)?.message ?? err);

        if (message.includes("USER_NOT_PARTICIPANT")) {
            return false;
        }

        // Entity not resolved, channel privacy issue, etc. — log and fail
        // closed so the force-join requirement can't silently be bypassed,
        // but this is where to look first if everyone gets locked out.
        console.error("Membership check failed unexpectedly:", message);
        return false;
    }
}

/**
 * Gate to call at the top of any user-facing action. Sends the join prompt
 * and returns false if the user isn't a member yet. Admins/owner always
 * pass, so the bot can still be tested/managed if the channel is misconfigured.
 */
export async function requireMembership(
    client: TelegramClient,
    userId: string,
    chatId: any
): Promise<boolean> {
    if (await isAdmin(userId)) return true;

    const member = await isChannelMember(client, userId);
    if (member) return true;

    await sendStyled(client, chatId, JOIN_REQUIRED_MESSAGE, { buttons: buildJoinKeyboard() });
    return false;
}

/** Handles the "✅ I've Joined" button tap. */
export async function handleCheckJoin(
    client: TelegramClient,
    userId: string,
    chatId: any,
    messageId: number | undefined,
    answer: (opts: { message?: string; alert?: boolean }) => Promise<void>
): Promise<void> {
    const member = (await isAdmin(userId)) || (await isChannelMember(client, userId));

    if (!member) {
        await answer({ message: NOT_JOINED_YET_ALERT, alert: true });
        return;
    }

    await answer({ message: "✅ Verified!" });
    await editStyled(client, chatId, messageId, JOIN_CONFIRMED_MESSAGE);
}
