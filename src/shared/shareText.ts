import type { RoundResult } from "./types";

export interface ShareTextData {
  issueNumber: number;
  totalScore: number;
  rounds: RoundResult[];
  streak: number;
  isArchive: boolean;
}

/** A plain-text breakdown whose colour values correspond exactly to the rendered swatches. */
export function formatShareText(state: ShareTextData): string {
  const totalPercent = ((state.totalScore / 5_000) * 100).toFixed(1);
  const heading = `Kolorly #${String(state.issueNumber).padStart(3, "0")} — ${state.totalScore.toLocaleString("en-CA")}/5,000 (${totalPercent}%)`;
  const rounds = state.rounds.map((round) => {
    const colourValues = [
      `Target ${round.targetHex.toUpperCase()}`,
      `Your mix ${round.guessHex.toUpperCase()}`,
    ];
    if (round.crowdCount > 0) {
      colourValues.push(`Community ${round.crowdAvgHex.toUpperCase()} (${round.crowdCount} guesses)`);
    }
    if (round.timedOut) colourValues.push("Timed out");
    colourValues.push(`${round.accuracyPct.toFixed(1)}%`, `${round.roundScore.toLocaleString("en-CA")} pts`);
    return `${round.round}. ${colourValues.join(" · ")}`;
  });

  const lines = [heading, ...rounds];
  if (!state.isArchive && state.streak > 0) lines.push(`Streak: ${state.streak} days`);
  return lines.join("\n");
}
