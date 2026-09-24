// Leaderboard types and rules shared by the browser and the servers. Keep this
// file free of Node-only imports so the client bundle can use it.

export type LeaderboardEntry = {
  initials: string;
  timeMs: number;
};

export type LeaderboardData = {
  allTime: LeaderboardEntry[];
  today: LeaderboardEntry[];
};

export const LEADERBOARD_LIMIT = 5;

export function emptyLeaderboardData(): LeaderboardData {
  return { allTime: [], today: [] };
}

/** Uppercase A-Z only, at most three letters. Empty when nothing is left. */
export function normalizeInitials(value: string | null | undefined) {
  return (value ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
}
