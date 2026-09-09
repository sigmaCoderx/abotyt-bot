
import { Api, TelegramClient } from "telegram";

const COMMANDS: { command: string; description: string }[] = [
    { command: "start", description: "Show the welcome message" },
    { command: "help", description: "How to use this bot" },
    { command: "totalusers", description: "Show the total number of users" },
    { command: "addadmin", description: "Admin: grant a user admin access" },
    { command: "listadmins", description: "Admin: list all admins" },
    { command: "ban", description: "Admin: ban a user" },
    { command: "unban", description: "Admin: unban a user" },
    { command: "restrictuser", description: "Admin: toggle download restriction for a user" },
    { command: "broadcast", description: "Admin: message every bot user" },
    { command: "sendto", description: "Admin: message one specific user" },
];

export async function registerBotCommands(client: TelegramClient): Promise<void> {
    try {
        await client.invoke(
            new Api.bots.SetBotCommands({
                scope: new Api.BotCommandScopeDefault(),
                langCode: "",
                commands: COMMANDS.map(
                    (c) => new Api.BotCommand({ command: c.command, description: c.description })
                ),
            })
        );
        console.log("✅ Bot commands registered");
    } catch (err) {
        console.error("⚠️  Failed to register bot commands:", err);
    }
}