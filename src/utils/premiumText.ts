
import bigInt from "big-integer";
import { Api, TelegramClient } from "telegram";

/**
 * Maps each Unicode emoji character used in the bot's text to a Telegram
 * Premium custom emoji document id. Built from the user-supplied capture —
 * where a character had multiple IDs listed, the first one is used here.
 */
export const PREMIUM_EMOJI_MAP: Record<string, string> = {
    "🎶": "5316520147752598207",
    "🎧": "6289330592483903817",
    "🎵": "5221948730286059987",
    "💗": "5181532022878765862",
    "🔈": "4967689020004893467",
    "🔮": "5008340344295654346",
    "🤩": "5256139985676943206",
    "❤️": "4909209866289021930",
    "🥛": "5348422194164669984",
    "🎸": "5289795349408399439",
    "🎼": "5472352350209336410",
    "💕": "5289787352179288266",
    "💞": "5805237106200547580",
};

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EMOJI_KEYS = Object.keys(PREMIUM_EMOJI_MAP).sort((a, b) => b.length - a.length);
const EMOJI_PATTERN = new RegExp(EMOJI_KEYS.map(escapeRegExp).join("|"), "g");

export function buildPremiumEntities(text: string): Api.TypeMessageEntity[] {
    const entities: Api.TypeMessageEntity[] = [];
    EMOJI_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = EMOJI_PATTERN.exec(text)) !== null) {
        const char = match[0];
        entities.push(
            new Api.MessageEntityCustomEmoji({
                offset: match.index,
                length: char.length,
                documentId: bigInt(PREMIUM_EMOJI_MAP[char]),
            })
        );
    }

    return entities;
}

/** Builds a text progress bar using a premium emoji as the "filled" block. */
export function buildProgressBar(percent: number, filledEmoji = "🎶", segments = 10): string {
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * segments);
    const bar = filledEmoji.repeat(filled) + "▫️".repeat(Math.max(0, segments - filled));
    return `${bar} ${clamped.toFixed(0)}%`;
}

export async function sendStyled(
    client: TelegramClient,
    chatId: any,
    text: string,
    extra: Record<string, any> = {}
): Promise<any> {
    return client.sendMessage(chatId, {
        message: text,
        formattingEntities: buildPremiumEntities(text),
        ...extra,
    });
}

export async function editStyled(
    client: TelegramClient,
    chatId: any,
    messageId: number | undefined,
    text: string,
    extra: Record<string, any> = {}
): Promise<any> {
    if (messageId) {
        try {
            return await client.editMessage(chatId, {
                message: messageId,
                text,
                formattingEntities: buildPremiumEntities(text),
                ...extra,
            });
        } catch {
            // message may have been deleted / isn't editable — fall through
        }
    }

    return sendStyled(client, chatId, text, extra);
}

/** Sends a local file with a premium-styled caption (e.g. thumbnail + menu). */
export async function sendStyledFile(
    client: TelegramClient,
    chatId: any,
    filePath: string,
    caption: string,
    extra: Record<string, any> = {}
): Promise<any> {
    return client.sendFile(chatId, {
        file: filePath,
        caption,
        formattingEntities: buildPremiumEntities(caption),
        ...extra,
    });
}

/**
 * Deletes the status/progress message once a job finishes successfully.
 * Falls back to editing it to "❤️ Done!" if the delete fails for any reason
 * (older message, missing rights, etc.) so the user still sees a completion
 * signal either way.
 */
export async function deleteOrFinish(
    client: TelegramClient,
    chatId: any,
    messageId?: number,
    fallbackText = "❤️ Done!"
): Promise<void> {
    if (!messageId) return;

    try {
        await client.deleteMessages(chatId, [messageId], { revoke: true });
    } catch {
        await editStyled(client, chatId, messageId, fallbackText);
    }
}