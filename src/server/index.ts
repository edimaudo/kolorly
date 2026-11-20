import { Hono } from "hono";
import { createTelemetryRouter } from "@devvit/analytics/server/reddit";
import { context, redis, reddit, settings } from "@devvit/web/server";
import { averageLab, colourAccuracy, hexToLab, labToHex } from "../shared/colors";
import type {
  ApiError,
  CrowdAggregate,
  DailyPuzzle,
  GameResponse,
  InitResponse,
  RoundResult,
  SessionState,
  UserProfile,
} from "../shared/types";
import culturalColors from "../../assets/cultural_colors.json";
import fridayPalettes from "../../assets/friday_palettes.json";
import { generateDailyPuzzle, issueNumberForDate } from "./services/puzzleGen";

const app = new Hono();
const ROUND_TIME_MS = 12_000;
const EMPTY_CROWD: CrowdAggregate = { sumL: 0, sumA: 0, sumB: 0, count: 0 };
const FLAIR_PRESENTATION: Record<string, { backgroundColor: string; textColor: "dark" | "light" }> = {
  "95% Club": { backgroundColor: "#E9C46A", textColor: "dark" },
  "7-Day Streak": { backgroundColor: "#E76F51", textColor: "light" },
  "Eagle Eye": { backgroundColor: "#457B9D", textColor: "light" },
};

interface RequestIdentity {
  postId: string;
  userId: string;
  username: string;
  subredditName: string;
  date: string;
  issueNumber: number;
  isArchive: boolean;
}

interface DailyStats {
  completedCount: number;
  scoreSum: number;
}

interface GameContext {
  identity: RequestIdentity;
  puzzle: DailyPuzzle;
  sessionKey: string;
  profileKey: string;
  leaderboardKey: string;
  participantKey: string;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function emptyProfile(): UserProfile {
  return { streak: 0, maxStreak: 0, lastCompletedDate: null, unlockedFlairs: [], equippedFlairs: [] };
}

function emptySession(identity: RequestIdentity): SessionState {
  return {
    postId: identity.postId,
    userId: identity.userId,
    date: identity.date,
    issueNumber: identity.issueNumber,
    isArchive: identity.isArchive,
    status: "UNSTARTED",
    currentRound: 1,
    roundStartedAt: null,
    rounds: [],
    totalScore: 0,
    hasCommented: false,
    startedAt: null,
    completedAt: null,
    earnedFlairs: [],
    equippedFlairs: [],
    percentile: null,
    playerCount: 0,
    streak: 0,
    maxStreak: 0,
  };
}

function getPostDataDate(): { date: string; issueNumber: number } {
  const postData = (context.postData ?? {}) as Record<string, unknown>;
  const date = isDateString(postData.date) ? postData.date : todayUtc();
  const issueFromPost = Number(postData.issueNumber);
  return {
    date,
    issueNumber: Number.isInteger(issueFromPost) && issueFromPost > 0 ? issueFromPost : issueNumberForDate(date),
  };
}

async function getRequestIdentity(): Promise<RequestIdentity> {
  const postId = context.postId;
  if (!postId) throw new Error("This game must be opened from a Kolorly post.");

  const user = await reddit.getCurrentUser();
  const username = user?.username;
  const userId = user?.id;
  if (!userId || !username) throw new Error("Please sign in to Reddit to play Kolorly.");

  const subredditName = context.subredditName ?? (await reddit.getCurrentSubreddit()).name;
  if (!subredditName) throw new Error("Kolorly could not identify this subreddit installation.");

  const postDate = getPostDataDate();
  return {
    postId,
    userId,
    username,
    subredditName,
    date: postDate.date,
    issueNumber: postDate.issueNumber,
    isArchive: postDate.date < todayUtc(),
  };
}

async function getPuzzle(date: string, issueNumber: number): Promise<DailyPuzzle> {
  const salt = (await settings.get<string>("puzzleSalt"))?.trim();
  if (!salt) throw new Error("Kolorly is waiting for its app secret. The developer must set puzzleSalt before the first round can begin.");

  const key = `kolorly:puzzle:${date}`;
  const cached = await redis.get(key);
  if (cached) return parseJson<DailyPuzzle>(cached, generateFallbackPuzzle(date, issueNumber, salt));

  const generated = generateDailyPuzzle(date, salt, culturalColors, fridayPalettes);
  generated.issueNumber = issueNumber;
  await redis.set(key, JSON.stringify(generated));
  return generated;
}

function generateFallbackPuzzle(date: string, issueNumber: number, salt: string): DailyPuzzle {
  // A corrupt cache should not take the post offline; regenerate with the configured app-global secret.
  const safe = generateDailyPuzzle(date, salt, culturalColors, fridayPalettes);
  safe.issueNumber = issueNumber;
  return safe;
}

async function getGameContext(): Promise<GameContext> {
  const identity = await getRequestIdentity();
  const puzzle = await getPuzzle(identity.date, identity.issueNumber);
  const sessionKey = `kolorly:session:${identity.postId}:${identity.userId}`;
  return {
    identity,
    puzzle,
    sessionKey,
    profileKey: `kolorly:user:${identity.userId}`,
    leaderboardKey: `kolorly:lb:${identity.date}`,
    participantKey: `kolorly:participants:${identity.date}`,
  };
}

async function getSession(key: string, identity: RequestIdentity): Promise<SessionState> {
  return parseJson<SessionState>(await redis.get(key), emptySession(identity));
}

async function getProfile(key: string): Promise<UserProfile> {
  return parseJson<UserProfile>(await redis.get(key), emptyProfile());
}

async function getCrowd(key: string): Promise<CrowdAggregate> {
  return parseJson<CrowdAggregate>(await redis.get(key), EMPTY_CROWD);
}

function getCrowdKey(date: string, round: number): string {
  return `kolorly:crowd:${date}:${round}`;
}

async function getDailyStats(date: string): Promise<DailyStats> {
  return parseJson<DailyStats>(await redis.get(`kolorly:stats:${date}`), { completedCount: 0, scoreSum: 0 });
}

function sessionToGameResponse(session: SessionState, puzzle: DailyPuzzle, notice?: string): GameResponse {
  const revealPending = session.status === "IN_PROGRESS" && session.roundStartedAt === null && session.rounds.length > 0;
  const round = session.status === "COMPLETED" || revealPending ? null : puzzle.rounds[session.currentRound - 1] ?? null;
  return {
    ok: true,
    date: session.date,
    issueNumber: session.issueNumber,
    isArchive: session.isArchive,
    status: session.status,
    currentRound: session.currentRound,
    roundStartedAt: session.roundStartedAt,
    round,
    totalScore: session.totalScore,
    rounds: session.rounds,
    streak: session.streak,
    maxStreak: session.maxStreak,
    earnedFlairs: session.earnedFlairs,
    equippedFlairs: session.equippedFlairs,
    percentile: session.percentile,
    playerCount: session.playerCount,
    hasCommented: session.hasCommented,
    ...(notice ? { notice } : {}),
  };
}

async function getInitPayload(game: GameContext): Promise<InitResponse> {
  const [session, profile, stats, playedToday, playerCount] = await Promise.all([
    getSession(game.sessionKey, game.identity),
    getProfile(game.profileKey),
    getDailyStats(game.identity.date),
    redis.zCard(game.participantKey),
    redis.zCard(game.leaderboardKey),
  ]);

  const averageAccuracyPct = stats.completedCount > 0
    ? Number((stats.scoreSum / stats.completedCount / 50).toFixed(1))
    : null;

  return {
    ok: true,
    date: game.identity.date,
    issueNumber: game.identity.issueNumber,
    isArchive: game.identity.isArchive,
    status: session.status,
    currentRound: session.currentRound,
    totalScore: session.totalScore,
    streak: profile.streak,
    maxStreak: profile.maxStreak,
    playedToday,
    averageAccuracyPct,
    playerCount,
    percentile: session.percentile,
    hasCommented: session.hasCommented,
    heroLightness: game.puzzle.heroLightness,
  };
}

async function startRound(game: GameContext, advance = false): Promise<{ session: SessionState; notice?: string }> {
  const { sessionKey, identity } = game;
  let notice: string | undefined;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const transaction = await redis.watch(sessionKey);
    const current = parseJson<SessionState>(await transaction.get(sessionKey), emptySession(identity));

    if (current.status === "COMPLETED") {
      await transaction.unwatch();
      return { session: current };
    }

    if (current.status === "IN_PROGRESS" && current.roundStartedAt === null && current.rounds.length > 0 && !advance) {
      await transaction.unwatch();
      return { session: current, notice };
    }

    if (current.status === "IN_PROGRESS" && current.roundStartedAt !== null && Date.now() - current.roundStartedAt >= ROUND_TIME_MS) {
      await transaction.unwatch();
      try {
        await submitRound(game, "#808080", current.currentRound, true);
        notice = "A round timed out while you were away. Your next swatch is ready.";
      } catch (error) {
        // Another request may have submitted the same expired round after our WATCH ended.
        if (!(error instanceof Error) || !error.message.includes("already been submitted")) throw error;
      }
      continue;
    }

    const next = { ...current };
    if (next.status === "UNSTARTED") {
      next.status = "IN_PROGRESS";
      next.startedAt = Date.now();
      next.currentRound = 1;
    }
    if (next.roundStartedAt === null) next.roundStartedAt = Date.now();

    await transaction.multi();
    await transaction.set(sessionKey, JSON.stringify(next));
    const committed = await transaction.exec();
    if (committed !== null) {
      await redis.zAdd(game.participantKey, { member: identity.userId, score: Date.now() });
      return { session: next, notice };
    }
  }

  throw new Error("Kolorly could not start this round. Please try again.");
}

async function submitRound(game: GameContext, submittedHex: string, expectedRound: number, forcedTimeout = false): Promise<{ session: SessionState; result: RoundResult }> {
  if (!/^#[0-9a-fA-F]{6}$/.test(submittedHex)) throw new Error("The submitted colour is not valid.");
  if (!Number.isInteger(expectedRound) || expectedRound < 1 || expectedRound > 5) throw new Error("The submitted round number is not valid.");

  const { identity, puzzle, sessionKey, profileKey, leaderboardKey } = game;
  const roundNumberFromSession = (await getSession(sessionKey, identity)).currentRound;
  if (roundNumberFromSession !== expectedRound) throw new Error("This swatch has already been submitted. Load the next one.");
  const crowdKey = getCrowdKey(identity.date, roundNumberFromSession);
  const statsKey = `kolorly:stats:${identity.date}`;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const transaction = await redis.watch(sessionKey, crowdKey, profileKey, leaderboardKey, statsKey);
    const session = parseJson<SessionState>(await transaction.get(sessionKey), emptySession(identity));
    if (session.status !== "IN_PROGRESS" || session.currentRound < 1 || session.currentRound > 5) {
      await transaction.unwatch();
      throw new Error("There is no active round to submit.");
    }
    // The crowd key is chosen from the session snapshot read before WATCH.
    // Reject a raced submission instead of writing a newer round into an older crowd bucket.
    if (session.currentRound !== roundNumberFromSession || session.currentRound !== expectedRound) {
      await transaction.unwatch();
      throw new Error("This swatch has already been submitted. Load the next one.");
    }
    if (session.roundStartedAt === null) {
      await transaction.unwatch();
      throw new Error("The round timer has not started. Return to the game and try again.");
    }

    const target = puzzle.rounds[session.currentRound - 1];
    const elapsed = Date.now() - session.roundStartedAt;
    const timedOut = forcedTimeout || elapsed >= ROUND_TIME_MS;
    const guessHex = submittedHex.toUpperCase();
    const measured = colourAccuracy(target.targetHex, guessHex);
    const accuracyPct = timedOut ? 0 : measured.accuracyPct;
    const roundScore = timedOut ? 0 : measured.roundScore;

    const crowd = parseJson<CrowdAggregate>(await transaction.get(crowdKey), EMPTY_CROWD);
    let nextCrowd = crowd;
    if (!timedOut && !identity.isArchive) {
      const lab = hexToLab(guessHex);
      nextCrowd = {
        sumL: crowd.sumL + lab.L,
        sumA: crowd.sumA + lab.a,
        sumB: crowd.sumB + lab.b,
        count: crowd.count + 1,
      };
    }
    const crowdMean = averageLab(nextCrowd);
    const crowdAvgHex = crowdMean ? labToHex(crowdMean) : "#808080";
    const crowdAccuracyPct = Number(colourAccuracy(target.targetHex, crowdAvgHex).accuracyPct.toFixed(1));

    const result: RoundResult = {
      round: session.currentRound,
      targetHex: target.targetHex,
      guessHex,
      deltaE: measured.deltaE,
      accuracyPct,
      roundScore,
      crowdAvgHex,
      crowdAccuracyPct,
      crowdCount: nextCrowd.count,
      ...(target.triviaTitle ? { triviaTitle: target.triviaTitle } : {}),
      ...(target.triviaNote ? { triviaNote: target.triviaNote } : {}),
      ...(timedOut ? { timedOut: true } : {}),
    };

    const nextSession: SessionState = {
      ...session,
      rounds: [...session.rounds, result],
      totalScore: session.totalScore + roundScore,
      currentRound: session.currentRound,
      roundStartedAt: null,
    };

    let nextProfile: UserProfile | null = null;
    let nextStats: DailyStats | null = null;
    if (session.currentRound === 5) {
      nextSession.status = "COMPLETED";
      nextSession.completedAt = Date.now();
      nextSession.currentRound = 5;
      if (!identity.isArchive) {
        const profile = parseJson<UserProfile>(await transaction.get(profileKey), emptyProfile());
        const yesterday = new Date(Date.parse(`${identity.date}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
        const streak = profile.lastCompletedDate === identity.date
          ? profile.streak
          : profile.lastCompletedDate === yesterday ? profile.streak + 1 : 1;
        const unlocked = new Set(profile.unlockedFlairs);
        if (nextSession.totalScore >= 4_750) unlocked.add("95% Club");
        if (streak >= 7) unlocked.add("7-Day Streak");
        if (nextSession.rounds.every((round) => !round.timedOut && round.accuracyPct >= 95)) unlocked.add("Eagle Eye");
        nextProfile = {
          streak,
          maxStreak: Math.max(profile.maxStreak, streak),
          lastCompletedDate: identity.date,
          unlockedFlairs: [...unlocked],
          equippedFlairs: profile.equippedFlairs,
        };
        nextSession.streak = nextProfile.streak;
        nextSession.maxStreak = nextProfile.maxStreak;
        nextSession.earnedFlairs = nextProfile.unlockedFlairs;
        nextSession.equippedFlairs = nextProfile.equippedFlairs;
        const stats = parseJson<DailyStats>(await transaction.get(statsKey), { completedCount: 0, scoreSum: 0 });
        nextStats = { completedCount: stats.completedCount + 1, scoreSum: stats.scoreSum + nextSession.totalScore };
      }
    } else {
      nextSession.currentRound = session.currentRound + 1;
    }

    await transaction.multi();
    await transaction.set(sessionKey, JSON.stringify(nextSession));
    if (!identity.isArchive && !timedOut) await transaction.set(crowdKey, JSON.stringify(nextCrowd));
    if (nextProfile) await transaction.set(profileKey, JSON.stringify(nextProfile));
    if (nextStats) {
      await transaction.set(statsKey, JSON.stringify(nextStats));
      await transaction.zAdd(leaderboardKey, { member: identity.userId, score: nextSession.totalScore });
    }
    const committed = await transaction.exec();
    if (committed === null) continue;

    if (nextSession.status === "COMPLETED" && !identity.isArchive) {
      const [count, rank] = await Promise.all([
        redis.zCard(leaderboardKey),
        redis.zRank(leaderboardKey, identity.userId),
      ]);
      nextSession.playerCount = count;
      nextSession.percentile = count > 0 && typeof rank === "number"
        ? Math.max(1, Math.ceil(((count - rank) / count) * 100))
        : null;
      await redis.set(sessionKey, JSON.stringify(nextSession));
    }

    return { session: nextSession, result };
  }

  throw new Error("Your round was updated somewhere else. Refresh the game to continue.");
}

async function postDailyPuzzle(): Promise<{ created: boolean; postId?: string; issueNumber: number; date: string }> {
  const date = todayUtc();
  const issueNumber = issueNumberForDate(date);
  // A post can be created during the first install before the developer has set
  // the app secret. Do not cache a public/default puzzle during that interval.
  if ((await settings.get<string>("puzzleSalt"))?.trim()) await getPuzzle(date, issueNumber);
  const postKey = `kolorly:post:${date}`;
  const existing = await redis.get(postKey);
  if (existing && existing !== "PENDING") return { created: false, postId: existing, issueNumber, date };
  if (existing === "PENDING") return { created: false, issueNumber, date };

  const transaction = await redis.watch(postKey);
  const marker = await transaction.get(postKey);
  if (marker) {
    await transaction.unwatch();
    return { created: false, ...(marker !== "PENDING" ? { postId: marker } : {}), issueNumber, date };
  }
  await transaction.multi();
  await transaction.set(postKey, "PENDING");
  await transaction.expire(postKey, 300);
  const claimed = await transaction.exec();
  if (claimed === null) return { created: false, issueNumber, date };

  try {
    const subredditName = context.subredditName ?? (await reddit.getCurrentSubreddit()).name;
    const post = await reddit.submitCustomPost({
      subredditName,
      title: `Kolorly #${String(issueNumber).padStart(3, "0")} — Today's Palette`,
      entry: "default",
      postData: { date, issueNumber, schemaVersion: 1 },
      textFallback: "A five-round daily colour-mixing challenge. Open this post to play Kolorly.",
    });
    await redis.set(postKey, post.id);
    return { created: true, postId: post.id, issueNumber, date };
  } catch (error) {
    await redis.del(postKey);
    throw error;
  }
}

function makeShareText(session: SessionState): string {
  const percentage = Number((session.totalScore / 50).toFixed(1));
  const marks = session.rounds.map((round) => {
    if (round.timedOut) return "⬜ 0%";
    const marker = round.accuracyPct >= 90 ? "🟩" : round.accuracyPct >= 75 ? "🟨" : "🟥";
    return `${marker} ${Math.round(round.accuracyPct)}%`;
  });
  const streakLine = session.isArchive ? "Practice run" : `Streak: ${session.streak} 🔥`;
  return `Kolorly #${String(session.issueNumber).padStart(3, "0")} — ${session.totalScore.toLocaleString("en-CA")}/5,000 (${percentage}%)\n${marks.join(" | ")}\n${streakLine}`;
}

app.get("/api/init", async (c) => {
  try {
    const game = await getGameContext();
    return c.json(await getInitPayload(game));
  } catch (error) {
    const body: ApiError = { ok: false, error: error instanceof Error ? error.message : "Unable to load Kolorly." };
    return c.json(body, 401);
  }
});

app.post("/api/round/start", async (c) => {
  try {
    const game = await getGameContext();
    const input = await c.req.json<{ advance?: boolean }>().catch(
      (): { advance?: boolean } => ({}),
    );
    const started = await startRound(game, input.advance === true);
    return c.json(sessionToGameResponse(started.session, game.puzzle, started.notice));
  } catch (error) {
    const body: ApiError = { ok: false, error: error instanceof Error ? error.message : "Unable to start the round." };
    return c.json(body, 400);
  }
});

app.post("/api/round/submit", async (c) => {
  try {
    const game = await getGameContext();
    const input = await c.req.json<{ guessHex?: string; round?: number }>();
    const guessHex = typeof input.guessHex === "string" ? input.guessHex : "";
    const submitted = await submitRound(game, guessHex, Number(input.round));
    const gameResponse = sessionToGameResponse(submitted.session, game.puzzle);
    const { ok: _ok, round: _round, ...session } = gameResponse;
    return c.json({ ok: true, result: submitted.result, session });
  } catch (error) {
    const body: ApiError = { ok: false, error: error instanceof Error ? error.message : "Unable to submit this colour." };
    return c.json(body, 400);
  }
});

app.post("/api/share", async (c) => {
  let game: GameContext | undefined;
  let reserved = false;
  try {
    game = await getGameContext();
    const session = await getSession(game.sessionKey, game.identity);
    if (session.status !== "COMPLETED") return c.json<ApiError>({ ok: false, error: "Complete all five swatches before sharing your result." }, 409);
    if (session.hasCommented) return c.json({ ok: true, hasCommented: true, alreadyPosted: true });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transaction = await redis.watch(game.sessionKey);
      const current = parseJson<SessionState>(await transaction.get(game.sessionKey), emptySession(game.identity));
      if (current.hasCommented) {
        await transaction.unwatch();
        return c.json({ ok: true, hasCommented: true, alreadyPosted: true });
      }
      current.hasCommented = true;
      await transaction.multi();
      await transaction.set(game.sessionKey, JSON.stringify(current));
      if (await transaction.exec() !== null) {
        reserved = true;
        break;
      }
    }
    if (!reserved) return c.json<ApiError>({ ok: false, error: "Your result is already being posted. Refresh to check its status." }, 409);

    const comment = await reddit.submitComment({ id: game.identity.postId, text: makeShareText(session), runAs: "USER" });
    return c.json({ ok: true, hasCommented: true, commentId: comment.id });
  } catch (error) {
    if (game && reserved) {
      const current = await getSession(game.sessionKey, game.identity);
      current.hasCommented = false;
      await redis.set(game.sessionKey, JSON.stringify(current));
    }
    const body: ApiError = {
      ok: false,
      error: error instanceof Error
        ? `${error.message} You can still copy the result text from this screen.`
        : "Reddit could not post the comment. You can still copy your result text.",
    };
    return c.json(body, 502);
  }
});

app.post("/api/flair", async (c) => {
  try {
    const game = await getGameContext();
    const input = await c.req.json<{ flair?: string }>();
    const flair = typeof input.flair === "string" ? input.flair : "";
    const session = await getSession(game.sessionKey, game.identity);
    const profile = await getProfile(game.profileKey);
    if (!profile.unlockedFlairs.includes(flair) || !FLAIR_PRESENTATION[flair]) {
      return c.json<ApiError>({ ok: false, error: "That flair has not been unlocked on this account." }, 403);
    }

    await reddit.setUserFlair({
      subredditName: game.identity.subredditName,
      username: game.identity.username,
      text: flair,
      backgroundColor: FLAIR_PRESENTATION[flair].backgroundColor,
      textColor: FLAIR_PRESENTATION[flair].textColor,
    });
    profile.equippedFlairs = [...new Set([...profile.equippedFlairs, flair])];
    session.equippedFlairs = profile.equippedFlairs;
    await Promise.all([
      redis.set(game.profileKey, JSON.stringify(profile)),
      redis.set(game.sessionKey, JSON.stringify(session)),
    ]);
    return c.json({ ok: true, equippedFlairs: profile.equippedFlairs });
  } catch (error) {
    const body: ApiError = {
      ok: false,
      error: error instanceof Error
        ? `Flair could not be equipped. The app may need moderator access or the subreddit may restrict user flair. (${error.message})`
        : "Flair could not be equipped. The subreddit may restrict user flair.",
    };
    return c.json(body, 403);
  }
});

app.post("/internal/scheduler/daily-drop", async (c) => {
  try {
    const result = await postDailyPuzzle();
    return c.json({ status: "ok", ...result });
  } catch (error) {
    console.error("[kolorly] daily drop failed", error);
    return c.json({ status: "error", message: error instanceof Error ? error.message : "Daily drop failed." }, 500);
  }
});

app.post("/internal/triggers/on-app-install", async (c) => {
  try {
    const result = await postDailyPuzzle();
    return c.json({ status: "ok", ...result });
  } catch (error) {
    console.error("[kolorly] initial post creation failed", error);
    return c.json({ status: "error", message: error instanceof Error ? error.message : "Initial post creation failed." }, 500);
  }
});

app.post("/internal/menu/create-daily-post", async (c) => {
  try {
    const result = await postDailyPuzzle();
    return c.json({ status: "ok", message: result.created ? "Today's Kolorly post was created." : "Today's Kolorly post already exists.", ...result });
  } catch (error) {
    console.error("[kolorly] moderator post creation failed", error);
    return c.json({ status: "error", message: error instanceof Error ? error.message : "Post creation failed." }, 500);
  }
});

// The adapter mounts Reddit's supported client-side Journeys event routes.
app.use(createTelemetryRouter());

app.onError((error, c) => {
  console.error("[kolorly] unhandled server error", error);
  return c.json({ ok: false, error: "Kolorly hit an unexpected server error. Please try again." }, 500);
});

export default app;
