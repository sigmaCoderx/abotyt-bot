

import fs from "fs";

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

import { config } from "./config/env";
import { connectMongo } from "./db/mongodb";

import { registerStartHandler } from "./handlers/start";
import { registerMessageHandler } from "./handlers/message";
import { registerCallbackHandler } from "./handlers/callback";
import { registerBotCommands } from "./services/botCommands";

const client = new TelegramClient(
    new StringSession(""),
    config.apiId,
    config.apiHash,
    {
        connectionRetries: 5,
    }
);

async function main() {
    console.log("Starting bot...");

    await connectMongo();

    await client.start({
        botAuthToken: config.botToken,
    });

    await registerBotCommands(client);
    await warmUpChannels();
    checkCookiesFile();

    registerStartHandler(client);
    registerMessageHandler(client);
    registerCallbackHandler(client);

    console.log("Bot is running...");
}

/**
 * Confirms YTDLP_COOKIES_FILE actually points at a readable file, right at
 * startup — a missing/misnamed cookies file otherwise fails silently and
 * only shows up later as a cryptic "Sign in to confirm you're not a bot"
 * error from yt-dlp on the first download attempt.
 */
function checkCookiesFile() {
    if (!config.ytdlpCookiesFile) {
        console.log("ℹ️  YTDLP_COOKIES_FILE not set — yt-dlp will run without cookies.");
        return;
    }

    if (fs.existsSync(config.ytdlpCookiesFile)) {
        console.log(`✅ yt-dlp cookies file found: ${config.ytdlpCookiesFile}`);
    } else {
        console.error(
            `⚠️  YTDLP_COOKIES_FILE is set to "${config.ytdlpCookiesFile}" but that file doesn't ` +
                `exist. Double-check the filename (cookies.txt, not cookies.tx) and that it's in ` +
                `the directory the bot is actually started from. yt-dlp will run without cookies ` +
                `until this is fixed, and YouTube may reject requests with ` +
                `"Sign in to confirm you're not a bot".`
        );
    }
}

async function warmUpChannels() {
    try {
        await client.getDialogs({ limit: 100 });
    } catch (err) {
        console.error("⚠️  Could not preload dialogs — channel entities may fail to resolve.", err);
    }

    try {
        await client.getEntity(config.cacheChannelId);
        console.log("✅ Cache channel resolved");
    } catch (err) {
        console.error(
            "⚠️  Could not resolve CACHE_CHANNEL_ID. Make sure the bot is an admin " +
                "in that channel and the ID uses the -100xxxxxxxxxx format.",
            err
        );
    }

    try {
        await client.getEntity(config.errorChannelId);
        console.log("✅ Error channel resolved");
    } catch (err) {
        console.error(
            "⚠️  Could not resolve ERROR_CHANNEL_ID. Make sure the bot is an admin " +
                "in that channel and the ID uses the -100xxxxxxxxxx format.",
            err
        );
    }
}

main().catch((err) => {
    console.error("Fatal startup error:", err);
    process.exit(1);
});