export type SessionStatus = "UNSTARTED" | "IN_PROGRESS" | "COMPLETED";

export interface PuzzleRound {
  round: number;
  label: string;
  targetHex: string;
  triviaTitle?: string;
  triviaNote?: string;
}

export interface DailyPuzzle {
  date: string;
  issueNumber: number;
  rounds: PuzzleRound[];
  heroLightness: number;
  fridayTheme?: string;
}

export interface RoundResult {
  round: number;
  targetHex: string;
  guessHex: string;
  deltaE: number;
  accuracyPct: number;
  roundScore: number;
  crowdAvgHex: string;
  crowdAccuracyPct: number;
  crowdCount: number;
  triviaTitle?: string;
  triviaNote?: string;
  timedOut?: boolean;
}

export interface SessionState {
  postId: string;
  userId: string;
  date: string;
  issueNumber: number;
  isArchive: boolean;
  status: SessionStatus;
  currentRound: number;
  roundStartedAt: number | null;
  rounds: RoundResult[];
  totalScore: number;
  hasCommented: boolean;
  startedAt: number | null;
  completedAt: number | null;
  earnedFlairs: string[];
  equippedFlairs: string[];
  percentile: number | null;
  playerCount: number;
  streak: number;
  maxStreak: number;
}

export interface UserProfile {
  streak: number;
  maxStreak: number;
  lastCompletedDate: string | null;
  unlockedFlairs: string[];
  equippedFlairs: string[];
}

export interface CrowdAggregate {
  sumL: number;
  sumA: number;
  sumB: number;
  count: number;
}

export interface InitResponse {
  ok: true;
  date: string;
  issueNumber: number;
  isArchive: boolean;
  status: SessionStatus;
  currentRound: number;
  totalScore: number;
  streak: number;
  maxStreak: number;
  playedToday: number;
  averageAccuracyPct: number | null;
  playerCount: number;
  percentile: number | null;
  hasCommented: boolean;
  heroLightness: number;
}

export interface GameResponse {
  ok: true;
  date: string;
  issueNumber: number;
  isArchive: boolean;
  status: SessionStatus;
  currentRound: number;
  roundStartedAt: number | null;
  round: PuzzleRound | null;
  totalScore: number;
  rounds: RoundResult[];
  streak: number;
  maxStreak: number;
  earnedFlairs: string[];
  equippedFlairs: string[];
  percentile: number | null;
  playerCount: number;
  hasCommented: boolean;
  notice?: string;
}

export interface SubmitRoundRequest {
  round: number;
  guessHex: string;
}

export interface SubmitRoundResponse {
  ok: true;
  result: RoundResult;
  session: Omit<GameResponse, "ok" | "round">;
}

export interface ApiError {
  ok: false;
  error: string;
}
