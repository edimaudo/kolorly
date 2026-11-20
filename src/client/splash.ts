import { requestExpandedMode } from "@devvit/web/client";
import { api, isStandaloneMode, type InitResponse } from "./api";
import { markAppReady, startJourney } from "./telemetry";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Kolorly could not find its app container.");

function safeDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function render(data: InitResponse): void {
  if (isStandaloneMode) document.body.classList.add("standalone-site");
  const issue = `#${String(data.issueNumber).padStart(3, "0")}`;
  const date = safeDate(data.date);
  const statusLine = data.status === "COMPLETED"
    ? `${data.isArchive ? "Practice complete" : "Completed"} · ${data.totalScore.toLocaleString("en-CA")} pts${!isStandaloneMode && !data.isArchive && data.percentile ? ` · Top ${data.percentile}%` : ""}`
    : data.status === "IN_PROGRESS"
      ? `${data.isArchive ? "Resume practice" : "Resume round"} ${Math.min(data.currentRound, 5)} of 5`
      : isStandaloneMode
        ? "A new colour challenge is ready"
        : `${data.isArchive ? "Archive palette" : "5 daily swatches"} · ${data.averageAccuracyPct === null ? "Be the first to set the pace" : `Subreddit average ${data.averageAccuracyPct}%`}`;
  const buttonLabel = data.status === "COMPLETED"
    ? data.isArchive ? "View practice result" : "View result card"
    : data.status === "IN_PROGRESS"
      ? data.isArchive ? "Resume practice" : "Resume challenge"
      : data.isArchive ? "Practice this palette" : "Play today's palette";
  const footerNote = isStandaloneMode ? "" : `${data.playedToday.toLocaleString("en-CA")} played today`;
  const communityNote = isStandaloneMode
    ? ""
    : !data.isArchive && data.streak > 0
      ? `<span class="streak-pill">${data.streak}-day streak</span>`
      : data.isArchive
        ? "Practice only · no streak impact"
        : "";

  root!.innerHTML = `
    <section class="inline-card" aria-label="Kolorly daily colour challenge">
      <header class="inline-header">
        <div class="brand-lockup"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>kolorly</span></div>
        <div class="inline-meta"><span class="issue-badge">${issue}</span><time datetime="${escapeHtml(data.date)}">${escapeHtml(date)}</time></div>
      </header>
      <div class="inline-specimen" style="--hero-l:${data.heroLightness}%">
        <div class="specimen-rings" aria-hidden="true"></div>
        <div class="specimen-label"><h1>Match the colour.<br />Beat the clock.</h1></div>
        <div class="specimen-chip" aria-hidden="true"><span></span><span></span><span></span></div>
      </div>
      <div class="inline-footer">
        <p class="inline-status">${escapeHtml(statusLine)}</p>
        <button class="primary-button" id="play-button" type="button">${buttonLabel}<span aria-hidden="true">→</span></button>
        ${footerNote || communityNote ? `<div class="inline-footnote">${footerNote ? `<span>${escapeHtml(footerNote)}</span>` : ""}${communityNote}</div>` : ""}
      </div>
    </section>
  `;
  root!.querySelector<HTMLButtonElement>("#play-button")?.addEventListener("click", (event) => {
    if (data.status !== "COMPLETED") void startJourney();
    try {
      requestExpandedMode(event, "game", { title: "Kolorly · Daily palette" });
    } catch (error) {
      console.error("[kolorly] Could not open expanded mode", error);
      const note = document.createElement("p");
      note.className = "inline-error";
      note.setAttribute("role", "alert");
      note.textContent = "Kolorly could not open. Please try again.";
      root!.querySelector(".inline-footer")?.append(note);
    }
  });
}

async function boot(): Promise<void> {
  try {
    const data = await api.init();
    render(data);
    markAppReady();
  } catch (error) {
    root!.innerHTML = `<section class="inline-error-card"><div class="brand-lockup"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>kolorly</span></div><h2>Today's palette is taking a breather.</h2><p>${escapeHtml(error instanceof Error ? error.message : "Please reload the post and try again.")}</p><button class="secondary-button" id="retry">Try again</button></section>`;
    root!.querySelector<HTMLButtonElement>("#retry")?.addEventListener("click", () => void boot());
  }
}

void boot();
