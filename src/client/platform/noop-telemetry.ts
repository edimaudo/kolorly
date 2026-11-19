/** Devvit Journeys are intentionally disabled in the standalone Vercel preview. */
export const telemetry = {
  appReady: async () => undefined,
  startJourney: async () => undefined,
  progress: async () => undefined,
  interaction: async () => undefined,
  endJourney: async () => undefined,
};
