/** Devvit Journeys are not available in the standalone Vercel build. */
export const telemetry = {
  appReady: async () => undefined,
  startJourney: async () => undefined,
  progress: async () => undefined,
  interaction: async () => undefined,
  endJourney: async () => undefined,
};
