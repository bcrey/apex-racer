# Apex Racer

A top-down multiplayer drift racer in the browser: lap timing with a best-lap
ghost and live splits, a daily and all-time leaderboard, synthesised sound, and
two graphics styles (V1 and V2) switchable in the HUD.

Live at https://apex-racer.vercel.app

## Controls

| Key | Action |
| --- | --- |
| W / Up | Gas |
| S / Down / Space | Brake (brake while steering to drift) |
| A, D / Left, Right | Steer |
| L | Headlights |
| M | Sound on or off |

WASD goes by key position, so it works on AZERTY and other layouts. Touch
screens get on-screen buttons instead.

Each race starts with a 3-2-1 countdown, and the lap clock starts when you
first cross the line. Your best lap is saved in the browser for your initials
and replayed as a see-through ghost car, with your gap to it shown at each
checkpoint and at the line. A lap during which the game was paused or froze
(a hidden tab, for example) is not counted.

## Run locally

Needs Node.js.

```sh
npm install
npm run dev   # http://localhost:3004
npm test      # unit tests
npm run lint  # type check
```

`npm run dev` starts `server.ts`: an Express server that serves the app through
Vite, the leaderboard API, and a WebSocket server for multiplayer.

## Environment

Put these in `.env.local` (see `.env.example`). Everything is optional; without
them the game runs solo with no saved leaderboard.

| Variable | Used for |
| --- | --- |
| `DATABASE_URL` | Postgres connection for the leaderboard. On Vercel use the Supabase Session Pooler URL. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase Realtime multiplayer. When set, it is used instead of the local WebSocket server. |
| `LEADERBOARD_ADMIN_TOKEN` | Allows resetting today's leaderboard. Without it, resets are switched off. |
| `LEADERBOARD_SECRET` | Signs lap-start tokens. Optional: by default a key is derived from `DATABASE_URL`. |

## Leaderboard rules

The server does not take the browser's word for a lap time:

- No lap can be faster than `MIN_LAP_MS` in `lib/leaderboardShared.ts` (9 s).
  An autopilot laps in about 11.8 s, and a test fails if physics changes bring
  it within 2 s of the floor.
- When a lap starts, the game asks `/api/lap-start` for a signed token holding
  the server's time. The lap is only accepted if it arrives no sooner than its
  claimed time after that (with 3 s of slack for network delay), and each
  token counts once.

## Resetting today's leaderboard

Set `LEADERBOARD_ADMIN_TOKEN`, then open the game once with
`?admin=<your token>`. That browser remembers the token and shows a Reset
button under "Top 5 Today"; the query is removed from the address bar. Open
`?admin=` with no value to forget it. Or reset directly:

```sh
curl -X DELETE -H "Authorization: Bearer $LEADERBOARD_ADMIN_TOKEN" \
  "https://apex-racer.vercel.app/api/leaderboard?timeZone=America/Los_Angeles"
```

## Layout

- `src/App.tsx`: game loop, V1 renderer, HUD
- `src/physics.ts`: car physics, run at a fixed 60 steps a second so every screen drives the same car
- `src/lap.ts`: lap timing, checkpoints and splits, measured in physics steps
- `src/ghost.ts`: recording, saving and replaying the best-lap ghost
- `src/remote.ts`: smoothing other players' cars between network updates
- `src/sound.ts`: engine, tyre and lap sounds, made with Web Audio
- `src/graphicsV2.ts`, `src/SpeedGauge.tsx`: V2 renderer and speedometer
- `src/track.ts`: track layout and starting grid, shared with `server.ts`
- `lib/leaderboard.ts`: leaderboard database access, lap tokens and admin checks; `lib/leaderboardShared.ts` holds the parts the browser also uses
- `api/leaderboard.ts`, `api/lap-start.ts`: the leaderboard API as Vercel functions
- `scripts/brand/`: sources for the Open Graph card and icons (`render.sh` regenerates them)
