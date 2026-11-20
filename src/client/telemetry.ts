import { telemetry } from "@devvit/analytics/client/reddit";

interface ReadyTelemetry {
  appReady?: () => Promise<unknown> | unknown;
}

interface EventReceipt {
  receipt?: { status?: string; message?: string };
}

function reportReceipt(eventName: string, result: unknown): void {
  const receipt = (result as EventReceipt | undefined)?.receipt;
  if (!receipt) return;
  if (receipt.status === "JOURNEY_RECEIPT_VALID") {
    console.debug(`[kolorly] ${eventName}: recorded`);
    return;
  }
  console.warn(`[kolorly] ${eventName}: ${receipt.status ?? "unknown receipt"} — ${receipt.message ?? "No receipt message."}`);
}

export function markAppReady(): void {
  // App.Ready is part of the Journeys event map. Keep this guarded because
  // some SDK builds expose the event while others do not expose a helper yet.
  const api = telemetry as unknown as ReadyTelemetry;
  if (typeof api.appReady === "function") {
    void Promise.resolve(api.appReady())
      .then((result) => reportReceipt("App.Ready", result))
      .catch((error) => console.debug("[kolorly] App.Ready was not recorded", error));
  }
}

export async function startJourney(): Promise<void> {
  try {
    const result = await telemetry.startJourney();
    reportReceipt("Journey.Start", result);
  } catch (error) {
    console.debug("[kolorly] Journey.Start was not recorded", error);
  }
}

export async function recordProgress(progress: number, action = "swatch_locked"): Promise<void> {
  try {
    const result = await telemetry.progress({ progress, action });
    reportReceipt("Journey.Progress", result);
  } catch (error) {
    console.debug("[kolorly] Journey.Progress was not recorded", error);
  }
}

export async function recordInteraction(action: "cvd_toggle" | "result_swatch_opened" | "share_result" | "flair_equipped" | "mixer_mode_palette" | "mixer_mode_sliders"): Promise<void> {
  try {
    const result = await telemetry.interaction({ action });
    reportReceipt("Journey.Interaction", result);
  } catch (error) {
    console.debug("[kolorly] Journey.Interaction was not recorded", error);
  }
}

export async function endJourney(score: number): Promise<void> {
  try {
    const result = await telemetry.endJourney({ complete: true, game: { win: true, score } });
    reportReceipt("Journey.End", result);
  } catch (error) {
    console.debug("[kolorly] Journey.End was not recorded", error);
  }
}
