/** Browser-only replacement for Devvit expanded-mode navigation on Vercel. */
export function requestExpandedMode(
  _event: Event,
  entry = "game",
  _options?: { title?: string },
): void {
  window.location.assign(entry === "game" ? "/game" : "/");
}
