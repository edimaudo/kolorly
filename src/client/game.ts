import { requestExpandedMode } from "@devvit/web/client";
import { api, isStandaloneMode, type GameResponse, type InitResponse, type RoundResult } from "./api";
import { hslToHex, hslToRgb } from "../shared/colors";
import { formatShareText } from "../shared/shareText";
import { endJourney, markAppReady, recordInteraction, recordProgress } from "./telemetry";

const root = document.querySelector<HTMLElement>("#app");
const toast = document.querySelector<HTMLElement>("#toast");
if (!root) throw new Error("Kolorly could not find its app container.");

const ROUND_MS = 12_000;
const HINT_KEY = "kolorly-hint-dismissed";
const MIXER_MODE_KEY = "kolorly-mixer-mode-v1";
type MixerMode = "sliders" | "palette";

function loadMixerMode(): MixerMode {
  try {
    return localStorage.getItem(MIXER_MODE_KEY) === "palette" ? "palette" : "sliders";
  } catch {
    return "sliders";
  }
}

let mixerMode: MixerMode = loadMixerMode();
let activePalettePointer: number | null = null;
const sliderState = { h: 180, s: 50, l: 50 };
let currentGame: GameResponse | null = null;
let currentInit: InitResponse | null = null;
let currentGuess = "#808080";
let frameHandle = 0;
let isSubmitting = false;
let cvdMode = false;
let hintVisible = false;
let lastResult: RoundResult | null = null;
let selectedResultRound = 1;
let toastTimeout = 0;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function setSkipLink(targetId: string, label: string): void {
  const link = document.querySelector<HTMLAnchorElement>("#skip-link");
  if (!link) return;
  link.href = `#${targetId}`;
  link.textContent = label;
}

function paletteHomeButtonMarkup(): string {
  return `<button class="home-nav-button" type="button" aria-label="Back to palette screen" title="Back to palette"><span aria-hidden="true">←</span><span>Home</span></button>`;
}

function bindPaletteHomeButton(): void {
  root!.querySelector<HTMLButtonElement>(".home-nav-button")?.addEventListener("click", (event) => {
    try {
      // Devvit 0.15 supports switching entry points while already expanded.
      // The Vercel adapter maps this same action back to the browser landing page.
      requestExpandedMode(event, "home", { title: "Kolorly" });
    } catch (error) {
      console.error("[kolorly] Could not return to the palette screen", error);
      showToast("Could not open the palette screen. Please try again.");
    }
  });
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
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

function hslGuess(): string {
  return hslToHex(sliderState.h, sliderState.s, sliderState.l);
}

function drawPaletteSpectrum(canvas: HTMLCanvasElement, hue: number): void {
  if (canvas.dataset.hue === String(hue)) return;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const lightness = 100 - (y / (height - 1)) * 100;
    for (let x = 0; x < width; x += 1) {
      const saturation = (x / (width - 1)) * 100;
      const [red, green, blue] = hslToRgb(hue, saturation, lightness).map((channel) => Math.round(channel * 255));
      const offset = (y * width + x) * 4;
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  canvas.dataset.hue = String(hue);
}

function gradientStyles(): void {
  const hue = sliderState.h;
  const saturation = sliderState.s;
  const lightness = sliderState.l;
  const hueSliders = root!.querySelectorAll<HTMLInputElement>("#hue-slider, #palette-hue-slider");
  const saturationSlider = root!.querySelector<HTMLInputElement>("#saturation-slider, #palette-saturation-slider");
  const lightnessSlider = root!.querySelector<HTMLInputElement>("#lightness-slider, #palette-lightness-slider");
  const mixPane = root!.querySelector<HTMLElement>("#your-swatch");
  const palette = root!.querySelector<HTMLElement>("#sl-palette");
  for (const hueSlider of hueSliders) {
    hueSlider.style.setProperty("--track", "linear-gradient(90deg,#f00 0%,#ff0 16.6%,#0f0 33.3%,#0ff 50%,#00f 66.6%,#f0f 83.3%,#f00 100%)");
  }
  if (saturationSlider) saturationSlider.style.setProperty("--track", `linear-gradient(90deg,hsl(${hue} 0% ${lightness}%),hsl(${hue} 100% ${lightness}%))`);
  if (lightnessSlider) lightnessSlider.style.setProperty("--track", `linear-gradient(90deg,#000000,hsl(${hue} ${saturation}% 50%),#ffffff)`);
  if (mixPane) mixPane.style.setProperty("--swatch", hslGuess());
  if (palette) {
    const canvas = palette.querySelector<HTMLCanvasElement>(".palette-spectrum");
    if (canvas) drawPaletteSpectrum(canvas, hue);
    const marker = palette.querySelector<HTMLElement>(".palette-marker");
    if (marker) {
      marker.style.left = `${saturation}%`;
      marker.style.top = `${100 - lightness}%`;
    }
    palette.setAttribute("aria-label", `Saturation and lightness palette. Saturation ${Math.round(saturation)} percent. Lightness ${Math.round(lightness)} percent. Use arrow keys to adjust.`);
  }
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
  for (const [id, value] of [["hue-slider", values.hue], ["palette-hue-slider", values.hue], ["saturation-slider", values.saturation], ["palette-saturation-slider", values.saturation], ["lightness-slider", values.lightness], ["palette-lightness-slider", values.lightness]] as const) {
    root!.querySelector<HTMLInputElement>(`#${id}`)?.setAttribute("aria-valuetext", value);
  }
  const paletteReadout = root!.querySelector<HTMLElement>("#palette-value-readout");
  if (paletteReadout) {
    paletteReadout.hidden = !cvdMode;
    paletteReadout.textContent = `Hue ${values.hue} · Saturation ${values.saturation} · Lightness ${values.lightness}`;
  }
}

function setSliderValues(): void {
  const hue = root!.querySelector<HTMLInputElement>("#hue-slider, #palette-hue-slider");
  const saturation = root!.querySelector<HTMLInputElement>("#saturation-slider, #palette-saturation-slider");
  const lightness = root!.querySelector<HTMLInputElement>("#lightness-slider, #palette-lightness-slider");
  if (hue) hue.value = String(sliderState.h);
  if (saturation) saturation.value = String(sliderState.s);
  if (lightness) lightness.value = String(sliderState.l);
  gradientStyles();
  updateSliderReadouts();
}

function mixerControlsMarkup(): string {
  if (mixerMode === "sliders") {
    return `
      <div class="slider-list" id="mixer-controls">
        <div class="slider-control"><label for="hue-slider">Hue</label><input id="hue-slider" type="range" min="0" max="360" step="1" value="180" aria-describedby="slider-instructions" /><output id="hue-value" for="hue-slider"></output></div>
        <div class="slider-control"><label for="saturation-slider">Saturation</label><input id="saturation-slider" type="range" min="0" max="100" step="1" value="50" aria-describedby="slider-instructions" /><output id="saturation-value" for="saturation-slider"></output></div>
        <div class="slider-control"><label for="lightness-slider">Lightness</label><input id="lightness-slider" type="range" min="0" max="100" step="1" value="50" aria-describedby="slider-instructions" /><output id="lightness-value" for="lightness-slider"></output></div>
      </div>`;
  }

  return `
    <div class="palette-mixer" id="mixer-controls">
      <div class="palette-square" id="sl-palette" role="group" tabindex="0" aria-label="Saturation and lightness palette. Saturation 50 percent. Lightness 50 percent. Use arrow keys to adjust." aria-describedby="palette-help">
        <canvas class="palette-spectrum" width="201" height="201" aria-hidden="true"></canvas>
        <span class="palette-marker" aria-hidden="true"></span>
      </div>
      <p class="palette-help" id="palette-help">Choose saturation from left to right and lightness from bottom to top. Use the arrow keys when the square is focused.</p>
      <div class="slider-control palette-hue-control"><label for="palette-hue-slider">Hue</label><input id="palette-hue-slider" type="range" min="0" max="360" step="1" value="180" aria-label="Hue" aria-describedby="slider-instructions" /><output id="hue-value" for="palette-hue-slider"></output></div>
      <output class="palette-value-readout" id="palette-value-readout" hidden></output>
      <div class="palette-accessible-controls" aria-label="Additional keyboard and screen reader controls">
        <label class="sr-only" for="palette-saturation-slider">Saturation</label>
        <input class="palette-accessible-range" id="palette-saturation-slider" type="range" min="0" max="100" step="1" value="50" aria-describedby="palette-help" />
        <label class="sr-only" for="palette-lightness-slider">Lightness</label>
        <input class="palette-accessible-range" id="palette-lightness-slider" type="range" min="0" max="100" step="1" value="50" aria-describedby="palette-help" />
      </div>
    </div>`;
}

function applyPalettePoint(clientX: number, clientY: number): void {
  const palette = root!.querySelector<HTMLElement>("#sl-palette");
  if (!palette) return;
  const rect = palette.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  sliderState.s = Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100);
  sliderState.l = Math.round((1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))) * 100);
  setSliderValues();
}

function bindMixerControls(): void {
  if (mixerMode === "sliders") {
    const bindings = [
      { selector: "#hue-slider", key: "h" as const },
      { selector: "#saturation-slider", key: "s" as const },
      { selector: "#lightness-slider", key: "l" as const },
    ];
    for (const binding of bindings) {
      const slider = root!.querySelector<HTMLInputElement>(binding.selector);
      if (!slider) continue;
      slider.addEventListener("pointerdown", hideHint, { once: true });
      slider.addEventListener("keydown", hideHint, { once: true });
      slider.addEventListener("input", () => {
        if (isSubmitting) return;
        sliderState[binding.key] = Number(slider.value);
        gradientStyles();
        updateSliderReadouts();
      });
    }
    return;
  }

  const hue = root!.querySelector<HTMLInputElement>("#palette-hue-slider");
  const saturation = root!.querySelector<HTMLInputElement>("#palette-saturation-slider");
  const lightness = root!.querySelector<HTMLInputElement>("#palette-lightness-slider");
  const palette = root!.querySelector<HTMLElement>("#sl-palette");
  for (const [input, key] of [[hue, "h"], [saturation, "s"], [lightness, "l"]] as const) {
    if (!input) continue;
    input.addEventListener("pointerdown", hideHint, { once: true });
    input.addEventListener("keydown", hideHint, { once: true });
    input.addEventListener("input", () => {
      if (isSubmitting) return;
      sliderState[key] = Number(input.value);
      setSliderValues();
    });
  }
  if (!palette) return;
  palette.addEventListener("pointerdown", (event: PointerEvent) => {
    if (isSubmitting) return;
    hideHint();
    activePalettePointer = event.pointerId;
    palette.setPointerCapture(event.pointerId);
    applyPalettePoint(event.clientX, event.clientY);
  });
  palette.addEventListener("pointermove", (event: PointerEvent) => {
    if (activePalettePointer !== event.pointerId || isSubmitting) return;
    applyPalettePoint(event.clientX, event.clientY);
  });
  const releasePointer = (event: PointerEvent) => {
    if (activePalettePointer === event.pointerId) activePalettePointer = null;
  };
  palette.addEventListener("pointerup", releasePointer);
  palette.addEventListener("pointercancel", releasePointer);
  palette.addEventListener("keydown", (event: KeyboardEvent) => {
    if (isSubmitting) return;
    const step = event.shiftKey ? 10 : 1;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft": sliderState.s = Math.max(0, sliderState.s - step); break;
      case "ArrowRight": sliderState.s = Math.min(100, sliderState.s + step); break;
      case "ArrowDown": sliderState.l = Math.max(0, sliderState.l - step); break;
      case "ArrowUp": sliderState.l = Math.min(100, sliderState.l + step); break;
      case "Home": sliderState.s = 0; break;
      case "End": sliderState.s = 100; break;
      default: handled = false;
    }
    if (handled) {
      event.preventDefault();
      hideHint();
      setSliderValues();
    }
  });
}

function bindMixerModeButtons(): void {
  root!.querySelectorAll<HTMLButtonElement>("[data-mixer-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (isSubmitting) return;
      const nextMode = button.dataset.mixerMode;
      if (nextMode !== "palette" && nextMode !== "sliders") return;
      mixerMode = nextMode;
      try { localStorage.setItem(MIXER_MODE_KEY, mixerMode); } catch { /* preference remains for this session */ }
      root!.querySelectorAll<HTMLButtonElement>("[data-mixer-mode]").forEach((option) => {
        option.setAttribute("aria-pressed", String(option.dataset.mixerMode === mixerMode));
      });
      const hint = root!.querySelector<HTMLElement>("#hint-pill");
      if (hint) hint.textContent = mixerMode === "palette" ? "Choose within the square" : "Drag sliders to match";
      const controls = root!.querySelector<HTMLElement>("#mixer-controls");
      if (controls) controls.outerHTML = mixerControlsMarkup();
      setSliderValues();
      bindMixerControls();
      button.focus();
      void recordInteraction(`mixer_mode_${mixerMode}`);
    });
  });
}
function hideHint(): void {
  if (!hintVisible) return;
  hintVisible = false;
  try { localStorage.setItem(HINT_KEY, "1"); } catch { /* storage can be disabled in embedded webviews */ }
  root!.querySelector("#hint-pill")?.remove();
}

function renderGame(state: GameResponse, init?: InitResponse): void {
  stopTimer();
  root!.classList.remove("results-mode", "single-state");
  currentGame = state;
  lastResult = null;
  isSubmitting = false;
  cvdMode = false;
  sliderState.h = 180;
  sliderState.s = 50;
  sliderState.l = 50;

  if (isStandaloneMode) document.body.classList.add("standalone-site");
  if (state.status === "COMPLETED") {
    // Reopening a completed challenge always opens the result card. The final reveal
    // is shown immediately after submission and remains there until the player continues.
    renderResult(state);
    return;
  }
  if (state.status === "IN_PROGRESS" && state.roundStartedAt === null && state.rounds.length > 0) {
    const previousResult = state.rounds[state.rounds.length - 1];
    const { ok: _ok, round: _round, ...session } = state;
    renderReveal(previousResult, session);
    return;
  }
  if (!state.round || state.roundStartedAt === null) {
    root!.classList.add("single-state");
    root!.innerHTML = `<section class="error-state" role="status"><h2>Your next swatch is ready.</h2><p>Kolorly is restoring the round timer.</p><button class="primary-button" id="resume-round" type="button">Continue</button></section>`;
    setSkipLink("resume-round", "Skip to continue");
    root!.querySelector<HTMLButtonElement>("#resume-round")?.addEventListener("click", () => void beginRound());
    return;
  }

  const round = state.round;
  hintVisible = false;
  try { hintVisible = localStorage.getItem(HINT_KEY) !== "1"; } catch { hintVisible = true; }
  const dots = Array.from({ length: 5 }, (_, index) => {
    const number = index + 1;
    const className = number < state.currentRound ? "round-dot done" : number === state.currentRound ? "round-dot current" : "round-dot";
    return `<span class="${className}" aria-hidden="true"></span>`;
  }).join("");

  root!.innerHTML = `
    <header class="game-hud" aria-label="Game status">
      <div class="round-track" role="progressbar" aria-label="Round progress" aria-valuemin="1" aria-valuemax="5" aria-valuenow="${state.currentRound}" aria-valuetext="Round ${state.currentRound} of 5">${dots}</div>
      <div class="timer-wrap" role="timer" aria-label="Time remaining" aria-live="off">
        <span class="timer-count" id="timer-count">12.0</span>
        <div class="timer-track" aria-hidden="true"><div class="timer-fill" id="timer-fill"></div></div>
        <span class="sr-only" id="timer-announcement" role="status" aria-live="polite" aria-atomic="true">12 seconds remaining</span>
      </div>
      <button class="cvd-button" id="cvd-toggle" type="button" aria-pressed="false" aria-label="Enable numeric HSL readouts for colour-vision support" title="Show numeric HSL readouts">CVD</button>
      ${paletteHomeButtonMarkup()}
    </header>
    <header class="round-heading">
      <div><p class="round-kicker">${state.isArchive ? "ARCHIVE PRACTICE" : `DAILY SWATCH · ${escapeHtml(dateLabel(state.date))}`}</p><h1 id="round-heading" tabindex="-1">${escapeHtml(round.label)}</h1></div>
      <span class="round-count">Round ${state.currentRound} of 5</span>
    </header>
    <section class="arena" aria-label="Colour comparison. Target colour above, your mix below.">
      <div class="swatch-pane target" style="--swatch:${round.targetHex}" id="target-swatch"><span class="swatch-label">TARGET</span></div>
      <div class="swatch-divider" aria-hidden="true"></div>
      <div class="swatch-pane yours" style="--swatch:${currentGuess}" id="your-swatch"><span class="swatch-label">YOUR MIX</span></div>
    </section>
    <section class="studio" aria-labelledby="studio-heading">
      <div class="studio-top">
        <h2 class="studio-title" id="studio-heading" tabindex="-1">Studio mixer</h2>
        <div class="studio-tools">
          <div class="mixer-mode-switch" role="group" aria-label="Choose colour controls">
            <button class="mixer-mode-button" type="button" data-mixer-mode="palette" aria-pressed="${mixerMode === "palette"}">Square palette</button>
            <button class="mixer-mode-button" type="button" data-mixer-mode="sliders" aria-pressed="${mixerMode === "sliders"}">Sliders</button>
          </div>
          ${hintVisible ? `<span class="hint-pill" id="hint-pill">${mixerMode === "palette" ? "Choose within the square" : "Drag sliders to match"}</span>` : ""}
        </div>
      </div>
      <p class="sr-only" id="slider-instructions">Adjust hue, saturation and lightness with the arrow keys or by dragging. Hue ranges from 0 to 360 degrees. Saturation and lightness range from 0 to 100 percent.</p>
      ${mixerControlsMarkup()}
    </section>
    <footer class="action-footer"><button class="primary-button lock-button" id="lock-button" type="button">Lock in colour <span aria-hidden="true">→</span></button></footer>
  `;
  setSkipLink("studio-heading", "Skip to colour controls");
  bindPaletteHomeButton();

  root!.querySelector<HTMLElement>("#round-heading")?.focus();
  setSliderValues();
  bindMixerModeButtons();
  bindMixerControls();
  root!.querySelector<HTMLButtonElement>("#cvd-toggle")?.addEventListener("click", () => {
    cvdMode = !cvdMode;
    const button = root!.querySelector<HTMLButtonElement>("#cvd-toggle");
    button?.setAttribute("aria-pressed", String(cvdMode));
    button?.setAttribute("aria-label", cvdMode ? "Disable numeric HSL readouts" : "Enable numeric HSL readouts for colour-vision support");
    button!.textContent = cvdMode ? "CVD on" : "CVD";
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
  const announcement = root!.querySelector<HTMLElement>("#timer-announcement");
  if (!fill || !count) return;
  let lastAnnouncedSecond = 12;
  const announceAt = new Set([10, 5, 3, 1]);
  const tick = () => {
    const remaining = Math.max(0, ROUND_MS - (Date.now() - startedAt));
    const fraction = remaining / ROUND_MS;
    const display = (remaining / 1000).toFixed(1);
    if (count.textContent !== display) count.textContent = display;
    const wholeSeconds = Math.ceil(remaining / 1000);
    if (announcement && announceAt.has(wholeSeconds) && wholeSeconds !== lastAnnouncedSecond) {
      announcement.textContent = `${wholeSeconds} seconds remaining`;
      lastAnnouncedSecond = wholeSeconds;
    }
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
  root!.querySelectorAll<HTMLButtonElement>("[data-mixer-mode]").forEach((button) => { button.disabled = true; });
  root!.querySelector<HTMLElement>("#sl-palette")?.setAttribute("aria-disabled", "true");
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
  const nextColor = result.guessHex;
  const dots = Array.from({ length: 5 }, (_, index) => `<span class="round-dot ${index < result.round ? "done" : ""}" aria-hidden="true"></span>`).join("");
  const crowdDetail = result.crowdCount > 0
    ? `Subreddit average: ${result.crowdAccuracyPct.toFixed(1)}% match · ${result.crowdAvgHex} · ${result.crowdCount} guess${result.crowdCount === 1 ? "" : "es"}`
    : !isStandaloneMode ? "No community guesses yet." : "";

  root!.innerHTML = `
    <header class="game-hud" aria-label="Game status">
      <div class="round-track" role="progressbar" aria-label="Round progress" aria-valuemin="1" aria-valuemax="5" aria-valuenow="${result.round}" aria-valuetext="Round ${result.round} of 5">${dots}</div>
      <div class="timer-wrap timer-complete" aria-label="Round complete"><span class="timer-count">Done</span><div class="timer-track" aria-hidden="true"><div class="timer-fill" style="transform:scaleX(0)"></div></div></div>
      <span class="round-count">${result.round} / 5</span>
      ${paletteHomeButtonMarkup()}
    </header>
    <header class="round-heading">
      <div><p class="round-kicker">SWATCH ${result.round} REVEALED</p><h1 id="reveal-heading" tabindex="-1">Your match</h1></div>
    </header>
    <section class="arena revealed" aria-label="Colour reveal. Target colour above, your mix below.">
      <div class="swatch-pane target" style="--swatch:${result.targetHex}">
        <span class="swatch-label">TARGET</span>
        ${result.crowdCount > 0 ? `<span class="swatch-reticle" style="--crowd:${result.crowdAvgHex}" role="img" aria-label="Subreddit average colour ${result.crowdAvgHex}"></span>` : ""}
      </div>
      <div class="swatch-divider" aria-hidden="true"></div>
      <div class="swatch-pane yours" style="--swatch:${nextColor}">
        <div class="mix-meta"><strong>YOUR MIX</strong><span>${result.guessHex}</span></div>
      </div>
      <div class="match-badge" role="status" aria-live="polite" aria-atomic="true">
        <strong>${result.accuracyPct.toFixed(1)}% match</strong><span>+${result.roundScore.toLocaleString("en-CA")} pts</span>
      </div>
    </section>
    <section class="reveal-summary" aria-label="Round result details">
      <div class="reveal-summary-main">
        <p class="reveal-meta"><strong>Perceptual difference (ΔE₀₀):</strong> ${result.deltaE.toFixed(2)}${result.timedOut ? " · Time expired" : ""}</p>
        ${crowdDetail ? `<p class="reveal-meta">${escapeHtml(crowdDetail)}</p>` : ""}
        ${result.triviaTitle ? `<p class="reveal-meta"><strong>${escapeHtml(result.triviaTitle)}</strong>${result.triviaNote ? ` · ${escapeHtml(result.triviaNote)}` : ""}</p>` : ""}
      </div>
      <p class="reveal-prompt">Review your match, then continue when you're ready.</p>
    </section>
    <footer class="action-footer"><button class="primary-button next-button" id="next-swatch" type="button">${session.status === "COMPLETED" ? "See your results" : "Next swatch"}<span aria-hidden="true">→</span></button></footer>
  `;
  setSkipLink("next-swatch", "Skip to continue");
  bindPaletteHomeButton();
  const advance = () => {
    if (session.status === "COMPLETED") {
      const completeState: GameResponse = { ok: true, ...session, round: null };
      renderResult(completeState);
      return;
    }
    void beginRound();
  };
  root!.querySelector<HTMLElement>("#reveal-heading")?.focus();
  root!.querySelector<HTMLButtonElement>("#next-swatch")?.addEventListener("click", advance);
  // Round reveal remains on screen until the player chooses to continue.
  if (session.status === "COMPLETED") void endJourney(session.totalScore);
}

async function beginRound(): Promise<void> {
  try {
    const next = await api.startRound(true);
    currentGame = next;
    renderGame(next);
  } catch (error) {
    root!.classList.add("single-state");
    root!.innerHTML = `<section class="error-state" role="alert"><h2>Couldn't load the next swatch.</h2><p>${escapeHtml(error instanceof Error ? error.message : "Please try again.")}</p><button class="primary-button" id="retry-round" type="button">Retry</button></section>`;
    setSkipLink("retry-round", "Skip to retry");
    root!.querySelector<HTMLButtonElement>("#retry-round")?.addEventListener("click", () => void beginRound());
  }
}

function shareText(state: GameResponse): string {
  return formatShareText(state);
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

function resultDetail(_state: GameResponse, round: RoundResult): string {
  const crowdValue = round.crowdCount > 0
    ? `<div class="detail-value"><span>Community average</span><strong><i class="detail-colour-chip" style="--chip:${round.crowdAvgHex}" aria-hidden="true"></i>${round.crowdAvgHex}</strong></div>`
    : "";
  return `
    <div class="detail-heading"><strong>Swatch ${round.round}${round.triviaTitle ? ` · ${escapeHtml(round.triviaTitle)}` : ""}</strong><span>${round.accuracyPct.toFixed(1)}% match</span></div>
    <div class="detail-values">
      <div class="detail-value"><span>Target</span><strong><i class="detail-colour-chip" style="--chip:${round.targetHex}" aria-hidden="true"></i>${round.targetHex}</strong></div>
      <div class="detail-value"><span>Your mix</span><strong><i class="detail-colour-chip" style="--chip:${round.guessHex}" aria-hidden="true"></i>${round.guessHex}</strong></div>
      <div class="detail-value"><span>ΔE₀₀</span><strong>${round.deltaE.toFixed(2)}</strong></div>
      ${crowdValue}
    </div>
    ${round.triviaNote ? `<p class="trivia-note">${escapeHtml(round.triviaNote)}</p>` : ""}
  `;
}

function renderResult(state: GameResponse): void {
  stopTimer();
  root!.classList.add("results-mode");
  root!.classList.remove("single-state");
  currentGame = state;
  selectedResultRound = state.rounds.length ? state.rounds[state.rounds.length - 1].round : 1;
  const percentage = Number((state.totalScore / 50).toFixed(1));
  const title = state.isArchive ? "Practice complete" : "Today's palette, decoded.";
  const percentile = state.isArchive ? "Archive practice" : state.percentile === null ? "Percentile pending" : `Top ${state.percentile}%`;
  const playerText = state.isArchive ? "" : state.playerCount > 0 ? `of ${state.playerCount.toLocaleString("en-CA")} players` : "of today's players";
  const statItems = [`<span><strong>${percentage}%</strong> accuracy</span>`];
  if (!isStandaloneMode && !state.isArchive) {
    statItems.push(`<span><strong>${escapeHtml(percentile)}</strong> ${escapeHtml(playerText)}</span>`);
    statItems.push(`<span><strong>${state.streak}-day streak</strong> ✦</span>`);
  }
  const tiles = state.rounds.map((round) => {
    const crowdLabel = round.crowdCount > 0 ? `, community average ${round.crowdAvgHex}` : "";
    const accessibleLabel = isStandaloneMode ? "" : round.crowdCount > 0 ? crowdLabel : ", no community average";
    const crowdSwatch = isStandaloneMode ? "" : `<span class="${round.crowdCount > 0 ? "" : "crowd-empty"}" style="${round.crowdCount > 0 ? `background:${round.crowdAvgHex}` : ""}"></span>`;
    return `
      <button class="review-tile" type="button" data-round="${round.round}" aria-pressed="${round.round === selectedResultRound}" aria-label="Round ${round.round}, ${round.accuracyPct.toFixed(0)} percent match. Target ${round.targetHex}, your mix ${round.guessHex}${accessibleLabel}">
        <span class="review-swatches ${isStandaloneMode ? "two-swatches" : ""}" aria-hidden="true">
          <span style="background:${round.targetHex}"></span><span style="background:${round.guessHex}"></span>${crowdSwatch}
        </span>
        <small>${round.round} · ${round.accuracyPct.toFixed(0)}%</small>
      </button>
    `;
  }).join("");
  const detailRound = state.rounds.find((round) => round.round === selectedResultRound) ?? state.rounds[0];
  const flairButtons = !state.isArchive && !isStandaloneMode ? state.earnedFlairs.map((flair) => {
    const equipped = state.equippedFlairs.includes(flair);
    return `<button class="outline-button ${equipped ? "equipped" : ""}" type="button" data-flair="${escapeHtml(flair)}" ${equipped ? "disabled" : ""}>${equipped ? `✓ ${escapeHtml(flair)} equipped` : `Equip “${escapeHtml(flair)}”`}</button>`;
  }).join("") : "";
  const actions = `
    <div class="share-heading"><h2>Share your result</h2><p>Copied results include the exact target, your mix, community colour (when available), and points for each swatch.</p></div>
    <div class="share-action-buttons">
      ${isStandaloneMode ? "" : `<button class="primary-button share-button" id="share-button" type="button" ${state.hasCommented ? "disabled" : ""}>${state.hasCommented ? "Posted to comments ✓" : "Post result to comments"}</button>`}
      <button class="${isStandaloneMode ? "primary-button" : "outline-button"} copy-breakdown-button" id="copy-result" type="button">Copy colour breakdown</button>
    </div>
    ${flairButtons ? `<div class="flair-actions" aria-label="Unlocked flair">${flairButtons}</div>` : ""}
  `;

  root!.innerHTML = `
    <section class="result-shell">
      <header class="result-topline"><div class="brand-lockup"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>kolorly</span></div><div class="result-top-actions"><span class="issue-badge">#${String(state.issueNumber).padStart(3, "0")} · ${escapeHtml(dateLabel(state.date))}</span>${paletteHomeButtonMarkup()}</div></header>
      <section class="result-hero" aria-labelledby="result-title">
        <h1 id="result-title" tabindex="-1">${title}</h1>
        <div class="score-line"><strong class="score-total">${state.totalScore.toLocaleString("en-CA")}</strong><span class="score-denom">/ 5,000 points</span></div>
        <div class="result-stats">${statItems.join("")}</div>
      </section>
      ${state.isArchive ? '<div class="practice-label">ARCHIVE PRACTICE · DOES NOT AFFECT STREAKS OR LEADERBOARDS</div>' : ""}
      <div class="result-section-title"><h2>Your five swatches</h2><span>Select a swatch to inspect it</span></div>
      <div class="review-strip">${tiles}</div>
      <section class="detail-drawer" id="detail-drawer" aria-live="polite">${detailRound ? resultDetail(state, detailRound) : "No swatches to inspect."}</section>
      <details class="scoring-explainer">
        <summary>How scoring works</summary>
        <div class="scoring-explainer-body">
          <p><strong>ΔE₀₀ (CIEDE2000)</strong> estimates the perceptual difference between the target colour and your mix. It compares lightness, chroma (colour intensity) and hue, with adjustments for how people perceive those differences. A lower value is closer; 0 means the colours are identical.</p>
          <ol>
            <li>Kolorly converts the target and your mix from sRGB into CIELAB colour values.</li>
            <li>It calculates their CIEDE2000 colour difference, shown as ΔE₀₀.</li>
            <li>It converts that difference into a game accuracy score: <code>clamp(100 − (ΔE₀₀ × 2.2), 0, 100)</code>.</li>
            <li>Round points are <code>round(accuracy × 10)</code>, up to 1,000 points per swatch.</li>
          </ol>
          <p class="scoring-note">The 2.2 multiplier is Kolorly's game-scoring scale; it is not part of the CIEDE2000 standard. The five swatches can earn up to 5,000 points.</p>
        </div>
      </details>
      <section class="community-actions" aria-label="Result actions">${actions}</section>
    </section>
  `;
  setSkipLink("result-title", "Skip to results");
  bindPaletteHomeButton();

  root!.querySelector<HTMLElement>("#result-title")?.focus();
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
    showToast(copied ? "Colour breakdown copied." : "Your browser blocked clipboard access.");
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
  if (isStandaloneMode) document.body.classList.add("standalone-site");
  try {
    currentInit = await api.init();
    const state = await api.startRound();
    currentGame = state;
    markAppReady();
    renderGame(state, currentInit);
  } catch (error) {
    root!.classList.add("single-state");
    root!.innerHTML = `<section class="error-state" role="alert"><div class="brand-lockup"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>kolorly</span></div><h2>Kolorly couldn't load.</h2><p>${escapeHtml(error instanceof Error ? error.message : "Please reload this post and try again.")}</p><button class="primary-button" id="retry-app" type="button">Try again</button></section>`;
    setSkipLink("retry-app", "Skip to retry");
    root!.querySelector<HTMLButtonElement>("#retry-app")?.addEventListener("click", () => void boot());
  }
}

void boot();
