import culturalColors from "../../assets/cultural_colors.json";
import { colourAccuracy } from "../shared/colors";
import type {
  GameResponse,
  InitResponse,
  PuzzleRound,
  RoundResult,
  SubmitRoundResponse,
} from "../shared/types";

type StandaloneSession = Omit<GameResponse, "ok" | "round">;

const ROUND_TIME_MS = 12_000;
const STORAGE_PREFIX = "kolorly-browser-demo-v1";
const issueEpoch = Date.parse("2026-10-30T00:00:00.000Z");

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function issueNumberForDate(date: string): number {
  const day = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(day) || day < issueEpoch) return 1;
  return Math.floor((day - issueEpoch) / 86_400_000) + 1;
}

function dailyPuzzle(date: string): PuzzleRound[] {
  // These sample targets are used only by the standalone Vercel build.
  // Devvit continues to generate the real daily palette on the server.
  const day = Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000);
  const samplePalettes = [
    ["#D85D4A", "#E8D5BC", "#293C59", "#8B9189"],
    ["#287C83", "#F1DFB8", "#553C72", "#A5A29B"],
    ["#B44E77", "#D8E7E9", "#344A38", "#9B8D81"],
    ["#D18B32", "#DCE5C9", "#3B4269", "#898D8F"],
    ["#4771A8", "#F0D7D1", "#5D3E35", "#A0A08E"],
  ];
  const palette = samplePalettes[((day % samplePalettes.length) + samplePalettes.length) % samplePalettes.length];
  const cultural = culturalColors[((day % culturalColors.length) + culturalColors.length) % culturalColors.length];

  return [
    { round: 1, label: "Vibrant", targetHex: palette[0] },
    { round: 2, label: "Pastel tint", targetHex: palette[1] },
    { round: 3, label: "Deep shade", targetHex: palette[2] },
    { round: 4, label: "Muted neutral", targetHex: palette[3] },
    { round: 5, label: "Cultural colour", targetHex: cultural.hex, triviaTitle: cultural.name, triviaNote: cultural.note },
  ];
}

function emptySession(date: string): StandaloneSession {
  return {
    date,
    issueNumber: issueNumberForDate(date),
    isArchive: false,
    status: "UNSTARTED",
    currentRound: 1,
    roundStartedAt: null,
    totalScore: 0,
    rounds: [],
    streak: 0,
    maxStreak: 0,
    earnedFlairs: [],
    equippedFlairs: [],
    percentile: null,
    playerCount: 0,
    hasCommented: false,
  };
}

function storageKey(date: string): string {
  return `${STORAGE_PREFIX}:${date}`;
}

function loadSession(): StandaloneSession {
  const date = todayUtc();
  try {
    const stored = localStorage.getItem(storageKey(date));
    if (stored) {
      const parsed = JSON.parse(stored) as StandaloneSession;
      if (parsed.date === date && Array.isArray(parsed.rounds)) return parsed;
    }
  } catch {
    // Private browsing or disabled storage: keep the current session playable for this page load.
  }
  return emptySession(date);
}

let session = loadSession();

function saveSession(): void {
  try {
    localStorage.setItem(storageKey(session.date), JSON.stringify(session));
  } catch {
    // Persistence is optional in the standalone build.
  }
}

function currentRound(): PuzzleRound | null {
  if (session.status === "COMPLETED") return null;
  return dailyPuzzle(session.date)[session.currentRound - 1] ?? null;
}

function gameResponse(includeNextRound = true): GameResponse {
  return {
    ok: true,
    ...session,
    round: includeNextRound ? currentRound() : null,
  };
}

function initResponse(): InitResponse {
  return {
    ok: true,
    date: session.date,
    issueNumber: session.issueNumber,
    isArchive: false,
    status: session.status,
    currentRound: session.currentRound,
    totalScore: session.totalScore,
    streak: 0,
    maxStreak: 0,
    playedToday: session.status === "UNSTARTED" ? 0 : 1,
    averageAccuracyPct: null,
    playerCount: 0,
    percentile: null,
    hasCommented: false,
    heroLightness: 61,
  };
}

function recordSubmission(roundNumber: number, guessHex: string, timedOut = false): RoundResult {
  if (!/^#[0-9a-fA-F]{6}$/.test(guessHex)) throw new Error("Enter a valid six-digit colour.");
  if (session.status !== "IN_PROGRESS" || roundNumber !== session.currentRound) {
    throw new Error("This swatch has already been submitted. Load the next one.");
  }

  const target = dailyPuzzle(session.date)[roundNumber - 1];
  if (!target) throw new Error("The requested swatch does not exist.");
  const submitted = timedOut ? "#808080" : guessHex.toUpperCase();
  const score = timedOut
    ? { deltaE: 100, accuracyPct: 0, roundScore: 0 }
    : colourAccuracy(target.targetHex, submitted);
  const result: RoundResult = {
    round: roundNumber,
    targetHex: target.targetHex,
    guessHex: submitted,
    deltaE: score.deltaE,
    accuracyPct: score.accuracyPct,
    roundScore: score.roundScore,
    crowdAvgHex: "#808080",
    crowdAccuracyPct: 0,
    crowdCount: 0,
    ...(target.triviaTitle ? { triviaTitle: target.triviaTitle } : {}),
    ...(target.triviaNote ? { triviaNote: target.triviaNote } : {}),
    ...(timedOut ? { timedOut: true } : {}),
  };

  session.rounds.push(result);
  session.totalScore += result.roundScore;
  session.roundStartedAt = null;
  if (roundNumber === 5) {
    session.status = "COMPLETED";
    const earned: string[] = [];
    if (session.totalScore >= 4_750) earned.push("95% Club");
    if (session.rounds.every((round) => !round.timedOut && round.accuracyPct >= 95)) earned.push("Eagle Eye");
    session.earnedFlairs = earned;
  } else {
    session.currentRound = roundNumber + 1;
  }
  saveSession();
  return result;
}

export const standaloneApi = {
  async init(): Promise<InitResponse> {
    return initResponse();
  },

  async startRound(advance = false): Promise<GameResponse> {
    if (session.status === "UNSTARTED") {
      session.status = "IN_PROGRESS";
      session.currentRound = 1;
      session.roundStartedAt = Date.now();
      saveSession();
    } else if (session.status === "IN_PROGRESS") {
      if (session.roundStartedAt !== null && Date.now() - session.roundStartedAt >= ROUND_TIME_MS) {
        recordSubmission(session.currentRound, "#808080", true);
      }

      if (session.status === "IN_PROGRESS" && session.roundStartedAt === null) {
        if (session.rounds.length > 0 && !advance) {
          return gameResponse(false);
        }
        session.roundStartedAt = Date.now();
        saveSession();
      }
    }
    return gameResponse();
  },

  async submitRound(round: number, guessHex: string): Promise<SubmitRoundResponse> {
    const result = recordSubmission(round, guessHex);
    const { ok: _ok, round: _round, ...savedSession } = gameResponse();
    return { ok: true, result, session: savedSession };
  },

  async share(): Promise<{ ok: true; hasCommented: boolean }> {
    throw new Error("Comment sharing is unavailable for this practice session.");
  },

  async equipFlair(_flair: string): Promise<{ ok: true; equippedFlairs: string[] }> {
    throw new Error("Reddit flair can only be equipped from the Devvit app.");
  },
};

