import type { ApiError, GameResponse, InitResponse, RoundResult, SessionStatus, SubmitRoundResponse } from "../shared/types";
import { demoApi, resetDemoSession } from "./demo-api";

export interface RoundStartResponse extends GameResponse {}

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const payload = await response.json().catch(() => ({ ok: false, error: "Reddit returned an unreadable response." })) as T | ApiError;
  if (!response.ok || (payload as { ok?: boolean }).ok === false) {
    throw new Error((payload as ApiError).error || `Request failed (${response.status}).`);
  }
  return payload as T;
}

const devvitApi = {
  init: () => request<InitResponse>("/api/init"),
  startRound: () => request<RoundStartResponse>("/api/round/start", { method: "POST" }),
  submitRound: (round: number, guessHex: string) => request<SubmitRoundResponse>("/api/round/submit", {
    method: "POST",
    body: JSON.stringify({ round, guessHex }),
  }),
  share: () => request<{ ok: true; hasCommented: boolean; alreadyPosted?: boolean; commentId?: string }>("/api/share", { method: "POST" }),
  equipFlair: (flair: string) => request<{ ok: true; equippedFlairs: string[] }>("/api/flair", {
    method: "POST",
    body: JSON.stringify({ flair }),
  }),
};

/**
 * Vercel uses a browser-only demo API stored in localStorage.
 * A normal Devvit build continues to use the real Reddit/Redis endpoints.
 */
export const api = isDemoMode ? demoApi : devvitApi;

export function mountDemoBanner(): void {
  if (!isDemoMode || document.querySelector(".browser-preview-banner")) return;
  const banner = document.createElement("div");
  banner.className = "browser-preview-banner";
  banner.innerHTML = '<span>Browser preview · local demo data</span><button type="button">Reset demo</button>';
  banner.querySelector("button")?.addEventListener("click", () => {
    resetDemoSession();
    window.location.assign("/");
  });
  document.body.append(banner);
}

export type { InitResponse, GameResponse, RoundResult, SessionStatus, SubmitRoundResponse };
