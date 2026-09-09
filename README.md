# AbotYT — YouTube Downloader Telegram Bot

Node.js + TypeScript. GramJS (MTProto) for Telegram, `youtube-dl-exec` (yt-dlp) for
YouTube, MongoDB for a Telegram-channel-backed media cache. No Python anywhere.

## 1. System dependencies

`youtube-dl-exec` bundles the `yt-dlp` binary itself (installed automatically as an
npm postinstall step), so you normally don't need to install `yt-dlp` separately.

You **do** need `ffmpeg` on the machine running the bot — it's required for:
- merging separate video+audio DASH streams into one MP4,
## 2. Install dependencies

```bash
npm install
```

This installs: `dotenv`, `mongodb`, `telegram` (GramJS), `youtube-dl-exec`, plus
`typescript`/`tsx`/`@types/node` as dev dependencies.

## 3. Configure environment

Copy `.env.example` to `.env` and fill it in:

```bash
cp .env.example .env
```

```env
API_ID=              # from https://my.telegram.org
API_HASH=
BOT_TOKEN=            # from @BotFather
OWNER_ID=             # your numeric Telegram user id — always bypasses force-join

MONGODB_URI=mongodb://localhost:27017/abotyt
MONGO_DB_NAME=abotyt  # required if MONGODB_URI has no db name in it (e.g. Atlas SRV URIs)

CACHE_CHANNEL_ID=     # -100xxxxxxxxxx
ERROR_CHANNEL_ID=     # -100xxxxxxxxxx

MAX_FILE_SIZE=2147483648
MAX_CONCURRENT_DOWNLOADS=2

# Optional: path to a Netscape-format cookies.txt yt-dlp uses to authenticate
# as a logged-in browser session. Helps avoid YouTube's bot-detection
# throttling. Leave unset to run without cookies.
YTDLP_COOKIES_FILE=./cookies.txt

# Force-join: users must be a member of this channel to use the bot.
FORCE_JOIN_CHANNEL_ID=-1001776406696
FORCE_JOIN_CHANNEL_USERNAME=Neuralp
FORCE_JOIN_CHANNEL_TITLE=Neural Programmers

# Shown as "📢 Channel" / "👥 Group" buttons under every media file sent.
CHANNEL_USERNAME=Neuralp
GROUP_USERNAME=neuralg
```

All six force-join/channel/group variables above have the values shown as
defaults baked into `config/env.ts`, so `.env` doesn't strictly need them —
override them there only if the channel/group/username ever changes.

### Force-join requirement

The bot requires every user to be a member of `FORCE_JOIN_CHANNEL_USERNAME`
before it will respond to anything (commands, links, or download buttons).
For this to work:

1. The bot account must be an **admin** of that channel (GramJS needs admin
   rights to call `channels.GetParticipant` and resolve the entity reliably).
2. `FORCE_JOIN_CHANNEL_ID` must be the numeric `-100...` id of the same
   channel `FORCE_JOIN_CHANNEL_USERNAME` points to.
3. The bot owner (`OWNER_ID`) and any user in the `admins` collection always
   bypass this check, so the bot stays usable/testable even if the channel
   is temporarily misconfigured.

### How to get the two channel IDs

1. Create two Telegram channels (they can be private).
2. Add your bot as an **admin** to both (needs permission to post messages/media).
3. Get each channel's numeric ID. Easiest way: forward any message from the channel
   to `@userinfobot` or `@RawDataBot`, or add the bot and check logs — GramJS/Bot API
   channel IDs look like `-100XXXXXXXXXX`. Put the **cache** channel in
   `CACHE_CHANNEL_ID` and the **error/admin** channel in `ERROR_CHANNEL_ID`.
4. On startup the bot calls `client.getEntity()` on both IDs and logs a warning if
   either can't be resolved — check the console output the first time you run it.

**Never commit `.env`.**

## 4. Run

```bash
# development (ts-node style, via tsx)
npm run dev

# production
npm run build
npm start
```

## 5. Project structure

```
src/
├── index.ts                 # bootstraps GramJS client, Mongo, handlers
├── config/env.ts             # env var loading/validation
├── db/mongodb.ts             # Mongo connection + cache collection/index
├── types/index.ts            # shared TS interfaces
├── state/
│   ├── sessionStore.ts       # in-memory per-request session (url, formats, etc.)
│   └── activeSession.ts      # chatId -> last session id (for typed playlist ranges)
├── utils/
│   ├── validation.ts         # URL validation, playlist range parsing
│   ├── files.ts              # sanitizing filenames, temp dirs, cleanup
│   ├── format.ts             # yt-dlp formats -> quality ladders + fallback logic
│   ├── size.ts                # MAX_FILE_SIZE + helpers
│   └── keyboards.ts          # all inline keyboard builders
├── services/
│   ├── youtube.ts            # single-video metadata (yt-dlp dumpSingleJson)
│   ├── playlist.ts           # playlist metadata (yt-dlp flatPlaylist)
│   ├── downloader.ts         # actual yt-dlp download + ffmpeg conversion calls
│   ├── mediaPipeline.ts      # cache check -> download -> cache upload -> send -> cleanup
│   ├── cache.ts              # Mongo cache lookup/save + resend cached Telegram media
│   ├── admin.ts              # error reporting to the admin channel
│   └── queue.ts              # MAX_CONCURRENT_DOWNLOADS semaphore
└── handlers/
    ├── start.ts              # /start
    ├── message.ts            # URL validation + metadata fetch + typed playlist ranges
    └── callback.ts           # all inline-button interactions + playlist job runner
```

## 6. How the format logic works (no hardcoded itags)

`utils/format.ts` reads the **actual** `formats` array from yt-dlp's JSON dump for a
video. For video, it groups streams by height (snapped to the nearest of
144/240/360/480/720/1080/1440/2160), and for each of the six displayed qualities:
- if a progressive stream (has both video+audio) exists at that height, uses it directly;
- otherwise pairs the best video-only (DASH) stream with the best available
  audio-only stream, producing a format string like `"137+140"`;
- if neither exists at that height, the quality button simply isn't shown.

For audio, streams are grouped by bitrate snapped to the nearest of
64/96/128/160/192/256/320 kbps, keeping the best candidate per bucket.

`selectVideoFormatWithFallback` / `selectAudioFormatWithFallback` are used only for
**playlists**, where the exact requested quality may not exist for every video —
they search downward from the requested quality to the closest one that does exist,
and report whether a fallback happened, exactly as specified.

## 7. Cache identity

Every cached file is keyed by `(videoId, type, quality, formatId)` with a unique
compound Mongo index, so `video@720p` and `video@1080p` (or `audio@128k` vs
`audio@320k`) are always distinct cache entries — a request for 720p can never
return a cached 480p file.

## 8. 2GB limit

`utils/size.ts` exports `MAX_FILE_SIZE` (from `MAX_FILE_SIZE` env var, default
`2 * 1024 * 1024 * 1024`). It's checked twice: against the **estimated** size from
yt-dlp metadata before downloading, and against the **actual** file size on disk
after downloading/converting, before anything is uploaded to Telegram.

## 9. Notes

- All yt-dlp calls go through `youtube-dl-exec`'s options object (never raw shell
  strings), so there is no command-injection surface from user input.
- Every downloaded file lives in a per-request temp directory
  (`downloads/<random-id>/`) that is deleted in a `finally` block after being sent
  or after a permanent failure — nothing accumulates on disk.
- The playlist range can be picked from the inline buttons **or** typed directly as
  plain text (`2-5`, `1-9`, `all`) right after the playlist is detected.
