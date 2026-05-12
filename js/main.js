import { initSegmenter, startCamera, stopCamera, flipCamera } from './camera.js';
import { setupOrientation, handleOrientation, handleMotion } from './orientation.js?v=0.2.23';
import { simInit, captureAndDissolve, addFluidForce, dislodgeAtPoint } from './sim.js?v=0.2.23';

// ── State ─────────────────────────────────────────────────────────────────────
let state = 'TITLE';
function setState(s) { state = s; }

// ── DOM refs ──────────────────────────────────────────────────────────────────
const screenTitle     = document.getElementById('screen-title');
const screenCamera    = document.getElementById('screen-camera');
const videoEl         = document.getElementById('video');
const shutterBtn      = document.getElementById('shutter');
const flipBtn         = document.getElementById('flip-btn');
const countdownEl     = document.getElementById('countdown-overlay');
const canvas          = document.getElementById('canvas');
const hudEl           = document.getElementById('hud');
const timerEl         = document.getElementById('timer');
const particleCountEl = document.getElementById('particle-count');
const gravInfoEl      = document.getElementById('grav-info');
const gsEl            = document.getElementById('gs');
const fpsEl           = document.getElementById('fps');
const viscosityEl     = document.getElementById('viscosity');
const airborneEl      = document.getElementById('airborne');
const processingEl    = document.getElementById('processing-overlay');

// ── Helpers ───────────────────────────────────────────────────────────────────
function show(el) { el.style.display = 'flex'; }
function hide(el) { el.style.display = 'none'; }

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = (total / 60) | 0;
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Wire up modules ───────────────────────────────────────────────────────────
setupOrientation(gravInfoEl);

simInit({ canvas, videoEl, particleCountEl, timerEl, hudEl, processingEl, screenCamera,
          gsEl, fpsEl, viscosityEl, airborneEl,
          show, hide, setState, formatTime });

// ── Sensor diagnostic ─────────────────────────────────────────────────────────
const diagEl = document.getElementById('diag');
diagEl.textContent = `DOE:${typeof DeviceOrientationEvent} RP:${typeof DeviceOrientationEvent?.requestPermission}`;

// ── Screen transitions ────────────────────────────────────────────────────────
function goTitle() {
  state = 'TITLE';
  show(screenTitle);
  hide(screenCamera);
  hide(countdownEl);
  hide(hudEl);
  hide(processingEl);
  canvas.style.display = 'none';
  stopCamera(videoEl);
}

function goCamera() {
  state = 'CAMERA';
  hide(screenTitle);
  show(screenCamera);
  startCamera(videoEl);
  initSegmenter();
}

function goCountdown() {
  state = 'COUNTDOWN';
  show(countdownEl);
  hide(hudEl);
  let count = 3;
  countdownEl.textContent = count;
  const iv = setInterval(() => {
    count--;
    if (count > 0) {
      countdownEl.textContent = count;
    } else {
      clearInterval(iv);
      hide(countdownEl);
      captureAndDissolve();
    }
  }, 1000);
}

// ── Input handlers ────────────────────────────────────────────────────────────
screenTitle.addEventListener('click', async () => {
  if (state !== 'TITLE') return;
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    try {
      const r = await DeviceOrientationEvent.requestPermission();
      diagEl.textContent = `RP:${r}`;
      if (r === 'granted') {
        window.addEventListener('devicemotion', handleMotion, true);
      } else {
        window.addEventListener('devicemotion', handleMotion, true);
      }
    } catch (err) {
      diagEl.textContent = `RP-err:${err.name}`;
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
  } else {
    window.addEventListener('devicemotion', handleMotion, true);
    diagEl.textContent = 'no-RP-API';
  }
  goCamera();
});

shutterBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (state === 'CAMERA') goCountdown();
});

flipBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if (state === 'CAMERA') flipCamera(videoEl);
});

document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

// ── Touch: pile dislodgement + fluid nudge (single-finger drag) ───────────────
const TOUCH_SCALE    = 0.04;
const DISLODGE_R     = 50;   // px radius; tune via experiment
let _touchX = 0, _touchY = 0;
canvas.addEventListener('touchstart', (e) => {
  if (state !== 'DISSOLVING' || e.touches.length !== 1) return;
  _touchX = e.touches[0].clientX;
  _touchY = e.touches[0].clientY;
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (state !== 'DISSOLVING' || e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - _touchX, dy = t.clientY - _touchY;
  dislodgeAtPoint(t.clientX, t.clientY, DISLODGE_R, dx, dy);
  addFluidForce(t.clientX, t.clientY, dx * TOUCH_SCALE, dy * TOUCH_SCALE);
  _touchX = t.clientX; _touchY = t.clientY;
}, { passive: true });

// ── HUD toggle: three-finger long press (600ms) during DISSOLVING ────────────
// Shows: timer, grain count, airborne, gs, fps, kill%, gravity, diag, version.
const HUD_PRESS_MS = 600;
let _hudPressTimer = null;
document.addEventListener('touchstart', (e) => {
  if (state !== 'DISSOLVING') return;
  if (e.touches.length === 3) {
    clearTimeout(_hudPressTimer);
    _hudPressTimer = setTimeout(() => {
      hudEl.style.display === 'flex' ? hide(hudEl) : show(hudEl);
      _hudPressTimer = null;
    }, HUD_PRESS_MS);
  } else if (e.touches.length > 3 && _hudPressTimer !== null) {
    clearTimeout(_hudPressTimer);
    _hudPressTimer = null;
  }
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (e.touches.length < 3 && _hudPressTimer !== null) {
    clearTimeout(_hudPressTimer);
    _hudPressTimer = null;
  }
}, { passive: true });
document.addEventListener('touchcancel', () => {
  clearTimeout(_hudPressTimer);
  _hudPressTimer = null;
}, { passive: true });

// ── Boot ──────────────────────────────────────────────────────────────────────
goTitle();
