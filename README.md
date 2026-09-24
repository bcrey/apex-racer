# Apex Racer

A top-down multiplayer drift racer in the browser: lap timing, a daily and
all-time leaderboard, and two graphics styles (V1 and V2) switchable in the HUD.

Live at https://apex-racer.vercel.app

## Run locally

Needs Node.js.

```sh
npm install
npm run dev   # http://localhost:3004
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

## Layout

- `src/App.tsx`: game loop, physics, V1 renderer, HUD
- `src/graphicsV2.ts`, `src/SpeedGauge.tsx`: V2 renderer and speedometer
- `src/track.ts`: track layout and starting grid, shared with `server.ts`
- `lib/leaderboard.ts`: leaderboard database access; `lib/leaderboardShared.ts` holds the parts the browser also uses
- `api/leaderboard.ts`: the leaderboard as a Vercel function
- `scripts/brand/`: sources for the Open Graph card and icons (`render.sh` regenerates them)
