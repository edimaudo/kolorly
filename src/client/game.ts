import { api, type GameResponse, type InitResponse, type RoundResult, type SubmitRoundResponse } from "./api";
import { hslToHex } from "../shared/colors";
import { endJourney, markAppReady, recordInteraction, recordProgress } from "./telemetry";

const root = document.querySelector<HTMLElement>("#app");
const toast = document.querySelector<HTMLElement>("#toast");
if (!root) throw new Error("Kolorly could not find its app container.");

const ROUND_MS = 12_000;
const HINT_KEY = "kolorly-hint-dismissed";
const sliderState = { h: 180, s: 50, l: 50 };
let currentGame: GameResponse | null = null;
let currentInit: InitResponse | null = null;
let currentGuess = "#808080";
let frameHandle = 0;
let revealTimeout = 0;
let isSubmitting = false;
let cvdMode = false;
let hintVisible = false;
let lastResult: RoundResult | null = null;
let selectedResultRound = 1;
let toastTimeout = 0;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function showToast(message: string): void {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function stopTimer(): void {
  if (frameHandle) cancelAnimationFrame(frameHandle);
  frameHandle = 0;
}

function dateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}

function hslGuess(): string {
  return hslToHex(sliderState.h, sliderState.s, sliderState.l);
}

function gradientStyles(): void {
  const hue = sliderState.h;
  const saturation = sliderState.s;
  const lightness = sliderState.l;
  const hueSlider = root!.querySelector<HTMLInputElement>("#hue-slider");
  const saturationSlider = root!.querySelector<HTMLInputElement>("#saturation-slider");
  const lightnessSlider = root!.querySelector<HTMLInputElement>("#lightness-slider");
  const mixPane = root!.querySelector<HTMLElement>("#your-swatch");
  if (hueSlider) hueSlider.style.setProperty("--track", "linear-gradient(90deg,#f00 0%,#ff0 16.6%,#0f0 33.3%,#0ff 50%,#00f 66.6%,#f0f 83.3%,#f00 100%)");
  if (saturationSlider) saturationSlider.style.setProperty("--track", `linear-gradient(90deg,hsl(${hue} 0% ${lightness}%),hsl(${hue} 100% ${lightness}%))`);
  if (lightnessSlider) lightnessSlider.style.setProperty("--track", `linear-gradient(90deg,#000000,hsl(${hue} ${saturation}% 50%),#ffffff)`);
  if (mixPane) mixPane.style.setProperty("--swatch", hslGuess());
  currentGuess = hslGuess();
}

function updateSliderReadouts(): void {
  const values = { hue: `${Math.round(sliderState.h)}°`, saturation: `${Math.round(sliderState.s)}%`, lightness: `${Math.round(sliderState.l)}%` };
  const h = root!.querySelector<HTMLOutputElement>("#hue-value");
  const s = root!.querySelector<HTMLOutputElement>("#saturation-value");
  const l = root!.querySelector<HTMLOutputElement>("#lightness-value");
  if (h) h.textContent = cvdMode ? values.hue : "";
  if (s) s.textContent = cvdMode ? values.saturation : "";
  if (l) l.textContent = cvdMode ? values.lightness : "";
  for (const [id, value] of [["hue-slider", values.hue], ["saturation-slider", values.saturation], ["lightness-slider", values.lightness]] as const) {
    root!.querySelector<HTMLInputElement>(`#${id}`)?.setAttribute("aria-valuetext", value);
  }
}

function setSliderValues(): void {
  const hue = root!.querySelector<HTMLInputElement>("#hue-slider");
  const saturation = root!.querySelector<HTMLInputElement>("#saturation-slider");
  const lightness = root!.querySelector<HTMLInputElement>("#lightness-slider");
  if (hue) hue.value = String(sliderState.h);
  if (saturation) saturation.value = String(sliderState.s);
  if (lightness) lightness.value = String(sliderState.l);
  gradientStyles();
  updateSliderReadouts();
}

function hideHint(): void {
  if (!hintVisible) return;
  hintVisible = false;
  try { localStorage.setItem(HINT_KEY, "1"); } catch { /* storage can be disabled in embedded webviews */ }
  root!.querySelector("#hint-pill")?.remove();
}

function renderGame(state: GameResponse, init?: InitResponse): void {
  stopTimer();
  currentGame = state;
  lastResult = null;
  isSubmitting = false;
  cvdMode = false;
  sliderState.h = 180;
  sliderState.s = 50;
  sliderState.l = 50;

  if (state.status === "COMPLETED") {
    renderResult(state);
    return;
  }
  if (!state.round || state.roundStartedAt === null) {
    root!.innerHTML = `<section class="error-state"><h2>Your next swatch is ready.</h2><p>Kolorly is restoring the round timer.</p><button class="primary-button" id="resume-round">Continue</button></section>`;
    root!.querySelector<HTMLButtonElement>("#resume-round")?.addEventListener("click", () => void beginRound());
    return;
  }

  const round = state.round;
  hintVisible = false;
  try { hintVisible = localStorage.getItem(HINT_KEY) !== "1"; } catch { hintVisible = true; }
  const dots = Array.from({ length: 5 }, (_, index) => {
    const number = index + 1;
    const className = number < state.currentRound ? "round-dot done" : number === state.currentRound ? "round-dot current" : "round-dot";
    return `<span class="${className}" aria-label="Round ${number}${number < state.currentRound ? " complete" : number === state.currentRound ? " current" : " upcoming"}"></span>`;
  }).join("");

  root!.innerHTML = `
    <div class="game-hud">
      <div class="round-track" aria-label="Round ${state.currentRound} of 5">${dots}</div>
      <div class="timer-wrap" aria-label="12 second round timer"><span class="timer-count" id="timer-count">12.0</span><div class="timer-track"><div class="timer-fill" id="timer-fill"></div></div></div>
      <button class="cvd-button" id="cvd-toggle" type="button" aria-pressed="false" title="Show numeric HSL values">CVD</button>
    </div>
    <div class="round-heading"><div><p class="round-kicker">${state.isArchive ? "ARCHIVE PRACTICE" : `DAILY SWATCH · ${escapeHtml(dateLabel(state.date))}`}</p><h1>${escapeHtml(round.label)}</h1></div><span class="round-count">${state.currentRound} / 5</span></div>
    <section class="arena" aria-label="Colour comparison">
      <div class="swatch-pane target" style="--swatch:${round.targetHex}" id="target-swatch"><span class="swatch-label">TARGET</span></div>
      <div class="swatch-divider"></div>
      <div class="swatch-pane yours" style="--swatch:${currentGuess}" id="your-swatch"><span class="swatch-label">YOUR MIX</span></div>
    </section>
    <section class="studio" aria-label="Colour mixing controls">
      <div class="studio-top"><p class="studio-title">Studio mixer</p>${hintVisible ? '<span class="hint-pill" id="hint-pill">Drag sliders to match</span>' : ""}</div>
      <div class="slider-list">
        <div class="slider-control"><label for="hue-slider">Hue</label><input id="hue-slider" type="range" min="0" max="360" step="1" value="180" aria-label="Hue" /><output id="hue-value" for="hue-slider"></output></div>
        <div class="slider-control"><label for="saturation-slider">Saturation</label><input id="saturation-slider" type="range" min="0" max="100" step="1" value="50" aria-label="Saturation" /><output id="saturation-value" for="saturation-slider"></output></div>
        <div class="slider-control"><label for="lightness-slider">Lightness</label><input id="lightness-slider" type="range" min="0" max="100" step="1" value="50" aria-label="Lightness" /><output id="lightness-value" for="lightness-slider"></output></div>
      </div>
    </section>
    <footer class="action-footer"><button class="primary-button lock-button" id="lock-button" type="button">Lock in colour <span aria-hidden="true">→</span></button></footer>
  `;

  setSliderValues();
  const sliderIds = ["#hue-slider", "#saturation-slider", "#lightness-slider"];
  for (const selector of sliderIds) {
    const slider = root!.querySelector<HTMLInputElement>(selector)!;
    slider.addEventListener("pointerdown", hideHint, { once: true });
    slider.addEventListener("input", () => {
      if (isSubmitting) return;
      const value = Number(slider.value);
      if (selector === "#hue-slider") sliderState.h = value;
      if (selector === "#saturation-slider") sliderState.s = value;
      if (selector === "#lightness-slider") sliderState.l = value;
      gradientStyles();
      updateSliderReadouts();
    });
  }
  root!.querySelector<HTMLButtonElement>("#cvd-toggle")?.addEventListener("click", () => {
    cvdMode = !cvdMode;
    const button = root!.querySelector<HTMLButtonElement>("#cvd-toggle");
    button?.setAttribute("aria-pressed", String(cvdMode));
    updateSliderReadouts();
    void recordInteraction("cvd_toggle");
  });
  root!.querySelector<HTMLButtonElement>("#lock-button")?.addEventListener("click", () => void submitGuess(false));
  runTimer(state.roundStartedAt);
  void init;
}

function runTimer(startedAt: number): void {
  stopTimer();
  const fill = root!.querySelector<HTMLElement>("#timer-fill");
  const count = root!.querySelector<HTMLElement>("#timer-count");
  if (!fill || !count) return;
  const tick = () => {
    const remaining = Math.max(0, ROUND_MS - (Date.now() - startedAt));
    const fraction = remaining / ROUND_MS;
    count.textContent = `${(remaining / 1000).toFixed(1)}`;
    fill.style.transform = `scaleX(${fraction})`;
    fill.classList.toggle("warn", remaining <= 3000 && remaining > 1500);
    fill.classList.toggle("critical", remaining <= 1500);
    if (remaining <= 0) {
      frameHandle = 0;
      void submitGuess(true);
      return;
    }
    frameHandle = requestAnimationFrame(tick);
  };
  tick();
}

async function submitGuess(timeout: boolean): Promise<void> {
  if (isSubmitting || !currentGame || currentGame.status !== "IN_PROGRESS") return;
  isSubmitting = true;
  const submittedRound = currentGame.currentRound;
  stopTimer();
  root!.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((input) => { input.disabled = true; });
  const lockButton = root!.querySelector<HTMLButtonElement>("#lock-button");
  if (lockButton) {
    lockButton.disabled = true;
    lockButton.textContent = timeout ? "Time's up" : "Locking colour…";
  }
  try {
    const submitted = await api.submitRound(submittedRound, timeout ? "#808080" : currentGuess);
    lastResult = submitted.result;
    currentGame = { ...currentGame, ...submitted.session, ok: true, round: null };
    // Analytics must never delay the reveal; gameplay remains responsive if telemetry is slow.
    void recordProgress(submitted.result.round / 5, "swatch_locked");
    renderReveal(submitted.result, submitted.session);
  } catch (error) {
    isSubmitting = false;
    showToast(error instanceof Error ? error.message : "Kolorly could not save this guess.");
    await beginRound();
  }
}

function renderReveal(result: RoundResult, session: Omit<GameResponse, "ok" | "round">): void {
  stopTimer();
  window.clearTimeout(revealTimeout);
  const nextColor = result.guessHex;
  root!.innerHTML = `
    <div class="game-hud">
      <div class="round-track" aria-label="Round ${result.round} of 5">${Array.from({ length: 5 }, (_, index) => `<span class="round-dot ${index < result.round ? "done" : ""}"></span>`).join("")}</div>
      <div class="timer-wrap"><span class="timer-count">DONE</span><div class="timer-track"><div class="timer-fill" style="transform:scaleX(0)"></div></div></div>
      <span class="round-count">${result.round} / 5</span>
    </div>
    <section class="arena revealed" aria-label="Target and your colour reveal">
      <div class="swatch-pane target" style="--swatch:${result.targetHex}"><span class="swatch-label">TARGET</span>${result.crowdCount > 0 ? `<span class="swatch-reticle" style="--crowd:${result.crowdAvgHex}" aria-label="Subreddit average colour ${result.crowdAvgHex}"></span>` : ""}</div>
      <div class="swatch-divider"></div>
      <div class="swatch-pane yours" style="--swatch:${nextColor}"><div class="mix-meta"><strong>YOUR MIX</strong><span>${result.guessHex}</span></div></div>
    </section>
    <section class="reveal-panel">
      <p class="round-kicker">SWATCH ${result.round} REVEALED</p>
      <div class="reveal-score"><span>${result.accuracyPct.toFixed(1)}%</span> match</div>
      <div class="reveal-meta">+${result.roundScore.toLocaleString("en-CA")} pts · ΔE ${result.deltaE.toFixed(2)}${result.timedOut ? " · time expired" : ""}</div>
      <div class="reveal-meta">${result.crowdCount > 0 ? `Subreddit average: ${result.crowdAccuracyPct.toFixed(1)}% match · ${result.crowdAvgHex} · ${result.crowdCount} guess${result.crowdCount === 1 ? "" : "es"}` : "Crowd average appears after the first guess."}</div>
      ${result.triviaTitle ? `<div class="reveal-meta"><strong>${escapeHtml(result.triviaTitle)}</strong>${result.triviaNote ? ` · ${escapeHtml(result.triviaNote)}` : ""}</div>` : ""}
      <button class="primary-button next-button" id="next-swatch" type="button">${session.status === "COMPLETED" ? "See your results" : "Next swatch"}<span aria-hidden="true">→</span></button>
    </section>
  `;
  const advance = () => {
    window.clearTimeout(revealTimeout);
    if (session.status === "COMPLETED") {
      const completeState: GameResponse = { ok: true, ...session, round: null };
      renderResult(completeState);
      return;
    }
    void beginRound();
  };
  root!.querySelector<HTMLButtonElement>("#next-swatch")?.addEventListener("click", advance);
  revealTimeout = window.setTimeout(advance, 2500);
  if (session.status === "COMPLETED") void endJourney(session.totalScore);
}

async function beginRound(): Promise<void> {
  try {
    const next = await api.startRound();
    currentGame = next;
    renderGame(next);
  } catch (error) {
    root!.innerHTML = `<section class="error-state"><h2>Couldn't load the next swatch.</h2><p>${escapeHtml(error instanceof Error ? error.message : "Please try again.")}</p><button class="primary-button" id="retry-round">Retry</button></section>`;
    root!.querySelector<HTMLButtonElement>("#retry-round")?.addEventListener("click", () => void beginRound());
  }
}

function shareText(state: GameResponse): string {
  const percent = Number((state.totalScore / 50).toFixed(1));
  const marks = state.rounds.map((round) => {
    if (round.timedOut) return "⬜ 0%";
    const marker = round.accuracyPct >= 90 ? "🟩" : round.accuracyPct >= 75 ? "🟨" : "🟥";
    return `${marker} ${Math.round(round.accuracyPct)}%`;
  });
  return `Kolorly #${String(state.issueNumber).padStart(3, "0")} — ${state.totalScore.toLocaleString("en-CA")}/5,000 (${percent}%)\n${marks.join(" | ")}\n${state.isArchive ? "Practice run" : `Streak: ${state.streak} 🔥`}`;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function resultDetail(state: GameResponse, round: RoundResult): string {
  return `
    <div class="detail-heading"><strong>Swatch ${round.round}${round.triviaTitle ? ` · ${escapeHtml(round.triviaTitle)}` : ""}</strong><span>${round.accuracyPct.toFixed(1)}% match</span></div>
    <div class="detail-values">
      <div class="detail-value"><span>Target</span><strong>${round.targetHex}</strong></div>
      <div class="detail-value"><span>Your mix</span><strong>${round.guessHex}</strong></div>
      <div class="detail-value"><span>ΔE 00</span><strong>${round.deltaE.toFixed(2)}</strong></div>
    </div>
    ${round.triviaNote ? `<p class="trivia-note">${escapeHtml(round.triviaNote)}</p>` : ""}
  `;
}

function renderResult(state: GameResponse): void {
  stopTimer();
  window.clearTimeout(revealTimeout);
  currentGame = state;
  const percentage = Number((state.totalScore / 50).toFixed(1));
  const title = state.isArchive ? "Practice complete" : "Today's palette, decoded.";
  const percentile = state.isArchive ? "Archive practice" : state.percentile === null ? "Percentile pending" : `Top ${state.percentile}%`;
  const playerText = state.isArchive ? "" : state.playerCount > 0 ? `of ${state.playerCount.toLocaleString("en-CA")} players` : "of today's players";
  const streakText = state.isArchive ? "Practice run" : `${state.streak}-day streak`;
  const tiles = state.rounds.map((round) => `
    <button class="review-tile" type="button" data-round="${round.round}" aria-pressed="${round.round === selectedResultRound}">
      <span class="review-swatches" aria-label="Target, your mix, and subreddit average colours">
        <span style="background:${round.targetHex}"></span><span style="background:${round.guessHex}"></span><span class="${round.crowdCount > 0 ? "" : "crowd-empty"}" style="${round.crowdCount > 0 ? `background:${round.crowdAvgHex}` : ""}"></span>
      </span>
      <small>${round.round} · ${round.accuracyPct.toFixed(0)}%</small>
    </button>
  `).join("");
  const detailRound = state.rounds.find((round) => round.round === selectedResultRound) ?? state.rounds[0];
  const flairButtons = !state.isArchive ? state.earnedFlairs.map((flair) => {
    const equipped = state.equippedFlairs.includes(flair);
    return `<button class="outline-button ${equipped ? "equipped" : ""}" type="button" data-flair="${escapeHtml(flair)}" ${equipped ? "disabled" : ""}>${equipped ? `✓ ${escapeHtml(flair)} equipped` : `Equip “${escapeHtml(flair)}”`}</button>`;
  }).join("") : "";

  root!.innerHTML = `
    <section class="result-shell">
      <header class="result-topline"><div class="brand-lockup"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>kolorly</span></div><span class="issue-badge">#${String(state.issueNumber).padStart(3, "0")} · ${escapeHtml(dateLabel(state.date))}</span></header>
      <section class="result-hero">
        <span class="micro-label">THE PALETTE IS YOURS</span>
        <h1 style="margin:6px 0 0;font-size:21px;letter-spacing:-.055em">${title}</h1>
        <div class="score-line"><strong class="score-total">${state.totalScore.toLocaleString("en-CA")}</strong><span class="score-denom">/ 5,000</span></div>
        <div class="result-stats"><span><strong>${percentage}%</strong> accuracy</span><span><strong>${percentile}</strong> ${playerText}</span><span><strong>${streakText}</strong>${state.isArchive ? "" : " ✦"}</span></div>
      </section>
      ${state.isArchive ? '<div class="practice-label">ARCHIVE PRACTICE · DOES NOT AFFECT STREAKS OR LEADERBOARDS</div>' : ""}
      <div class="result-section-title"><h2>Your five swatches</h2><span>TAP TO INSPECT</span></div>
      <div class="review-strip">${tiles}</div>
      <section class="detail-drawer" id="detail-drawer">${detailRound ? resultDetail(state, detailRound) : "No swatches to inspect."}</section>
      <section class="community-actions">
        <button class="primary-button share-button" id="share-button" type="button" ${state.hasCommented ? "disabled" : ""}>${state.hasCommented ? "Posted ✓" : "Post result to comments"}</button>
        <div class="action-row"><button class="outline-button" id="copy-result" type="button">Copy result text</button></div>
        ${flairButtons ? `<div class="action-row">${flairButtons}</div>` : ""}
      </section>
      <aside class="reminder-note"><strong>Tomorrow's palette · 00:00 UTC</strong>Daily push reminders are not enabled for this app yet. The next palette appears in the subreddit feed.</aside>
    </section>
  `;

  root!.querySelectorAll<HTMLButtonElement>(".review-tile").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = Number(button.dataset.round);
      selectedResultRound = selected;
      root!.querySelectorAll<HTMLButtonElement>(".review-tile").forEach((tile) => tile.setAttribute("aria-pressed", String(tile === button)));
      const selectedRound = state.rounds.find((round) => round.round === selected);
      const drawer = root!.querySelector<HTMLElement>("#detail-drawer");
      if (selectedRound && drawer) drawer.innerHTML = resultDetail(state, selectedRound);
      void recordInteraction("result_swatch_opened");
    });
  });

  root!.querySelector<HTMLButtonElement>("#share-button")?.addEventListener("click", async () => {
    const button = root!.querySelector<HTMLButtonElement>("#share-button");
    if (!button || state.hasCommented) return;
    button.disabled = true;
    button.textContent = "Posting…";
    void recordInteraction("share_result");
    try {
      await api.share();
      state.hasCommented = true;
      button.textContent = "Posted ✓";
      showToast("Your result is in the comments.");
    } catch (error) {
      const copied = await copyText(shareText(state));
      button.disabled = false;
      button.textContent = "Post result to comments";
      showToast(copied ? "Reddit could not post. Result copied instead." : (error instanceof Error ? error.message : "Could not post your result."));
    }
  });

  root!.querySelector<HTMLButtonElement>("#copy-result")?.addEventListener("click", async () => {
    const copied = await copyText(shareText(state));
    showToast(copied ? "Result copied." : "Your browser blocked clipboard access.");
  });
  root!.querySelectorAll<HTMLButtonElement>("[data-flair]").forEach((button) => {
    button.addEventListener("click", async () => {
      const flair = button.dataset.flair;
      if (!flair) return;
      button.disabled = true;
      button.textContent = "Equipping…";
      try {
        const response = await api.equipFlair(flair);
        state.equippedFlairs = response.equippedFlairs;
        button.textContent = `✓ ${flair} equipped`;
        button.classList.add("equipped");
        void recordInteraction("flair_equipped");
        showToast(`${flair} flair equipped.`);
      } catch (error) {
        button.disabled = false;
        button.textContent = `Equip “${flair}”`;
        showToast(error instanceof Error ? error.message : "Flair could not be equipped.");
      }
    });
  });
}

async function boot(): Promise<void> {
  try {
    currentInit = await api.init();
    const state = await api.startRound();
    currentGame = state;
    markAppReady();
    renderGame(state, currentInit);
  } catch (error) {
    root!.innerHTML = `<section class="error-state"><div class="brand-lockup"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>kolorly</span></div><h2>Kolorly couldn't load.</h2><p>${escapeHtml(error instanceof Error ? error.message : "Please reload this post and try again.")}</p><button class="primary-button" id="retry-app">Try again</button></section>`;
    root!.querySelector<HTMLButtonElement>("#retry-app")?.addEventListener("click", () => void boot());
  }
}

void boot();
