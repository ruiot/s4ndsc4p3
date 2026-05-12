import { extractMaskData, stopCamera, facingMode } from './camera.js';
import { initParticles, scanRepose, updateParticles, getStaticBuf, getMovingBuf, setFluidRef, initSilhouette, fgParticleCount, airborneCount, GRID_SIZE, DURATION_MS, dislodgeInRadius } from './sand.js?v=0.2.23';
import { FluidSim } from './fluid.js';
import { gravX, gravY } from './orientation.js?v=0.2.23';

const CELL = 8;
// oil tint: dark indigo — visible only where dye > 0
const OIL_R = 20, OIL_G = 15, OIL_B = 55;

let _canvas, _ctx;
let _videoEl, _particleCountEl, _timerEl, _hudEl, _processingEl, _screenCamera;
let _gsEl, _fpsEl, _viscosityEl, _airborneEl;
let _show, _hide, _setState, _formatTime;
let _smoothFps = 30;

let _fluid     = null;
let _small     = null;   // cols×rows canvas for fluid dye upscale
let _smallCtx  = null;
let _sandCanvas  = null;   // full W×H canvas for staticBuf (settled grains)
let _sandCtx     = null;
let _movingCanvas = null;  // full W×H canvas for movingBuf (airborne grains)
let _movingCtx    = null;

let startTime     = 0;
let rafId         = null;
let _lastFrameTs  = 0;
const FRAME_MS    = 1000 / 30;

export function simInit({ canvas, videoEl, particleCountEl, timerEl, hudEl, processingEl, screenCamera,
                          gsEl, fpsEl, viscosityEl, airborneEl,
                          show, hide, setState, formatTime }) {
  _canvas        = canvas;
  _ctx           = canvas.getContext('2d');
  _videoEl       = videoEl;
  _particleCountEl = particleCountEl;
  _timerEl       = timerEl;
  _hudEl         = hudEl;
  _processingEl  = processingEl;
  _screenCamera  = screenCamera;
  _gsEl = gsEl; _fpsEl = fpsEl; _viscosityEl = viscosityEl; _airborneEl = airborneEl;
  _show = show; _hide = hide; _setState = setState; _formatTime = formatTime;
}

export function addFluidForce(x, y, fx, fy) {
  if (_fluid) _fluid.addForce(x, y, fx, fy, 0.15);
}

export function dislodgeAtPoint(cx, cy, r, dragVx, dragVy) {
  dislodgeInRadius(cx, cy, r, dragVx, dragVy);
}

export function captureAndDissolve() {
  _setState('PROCESSING');

  const W = window.innerWidth;
  const H = window.innerHeight;

  _canvas.width  = W;
  _canvas.height = H;
  _canvas.style.display = 'block';

  requestAnimationFrame(async () => {
    const vw = _videoEl.videoWidth;
    const vh = _videoEl.videoHeight;

    if (vw > 0 && vh > 0) {
      const scale = Math.max(W / vw, H / vh);
      const sw = vw * scale, sh = vh * scale;
      if (facingMode === 'user') {
        _ctx.save(); _ctx.translate(W, 0); _ctx.scale(-1, 1);
        _ctx.drawImage(_videoEl, (W - sw) / 2, (H - sh) / 2, sw, sh);
        _ctx.restore();
      } else {
        _ctx.drawImage(_videoEl, (W - sw) / 2, (H - sh) / 2, sw, sh);
      }
    } else {
      _ctx.drawImage(_videoEl, 0, 0, W, H);
    }

    const imgData = _ctx.getImageData(0, 0, W, H).data;
    stopCamera(_videoEl);
    _hide(_screenCamera);

    _show(_processingEl);
    const maskData = await extractMaskData(_canvas, W, H);
    _hide(_processingEl);

    _setState('DISSOLVING');
    initParticles(imgData, maskData, W, H, _ctx);
    _particleCountEl.textContent = fgParticleCount.toLocaleString() + ' grains';
    _gsEl.textContent = 'gs ' + GRID_SIZE;

    // ── Fluid sim setup ───────────────────────────────────────────────────────
    const cols = (W / CELL) | 0;
    const rows = (H / CELL) | 0;
    _fluid = new FluidSim(cols, rows, CELL);
    setFluidRef(_fluid);
    initSilhouette(_fluid);

    _small = document.createElement('canvas');
    _small.width  = cols;
    _small.height = rows;
    _smallCtx = _small.getContext('2d');

    _sandCanvas = document.createElement('canvas');
    _sandCanvas.width  = W;
    _sandCanvas.height = H;
    _sandCtx = _sandCanvas.getContext('2d');

    _movingCanvas = document.createElement('canvas');
    _movingCanvas.width  = W;
    _movingCanvas.height = H;
    _movingCtx = _movingCanvas.getContext('2d');

    _ctx.imageSmoothingEnabled = false;
    // ─────────────────────────────────────────────────────────────────────────

    if ('wakeLock' in navigator) navigator.wakeLock.request('screen').catch(() => {});

    startTime = performance.now();
    rafId = requestAnimationFrame(frame);
  });
}

function frame(timestamp) {
  if (timestamp - _lastFrameTs < FRAME_MS) { rafId = requestAnimationFrame(frame); return; }
  const frameDelta = _lastFrameTs > 0 ? timestamp - _lastFrameTs : FRAME_MS;
  _lastFrameTs = timestamp;
  const elapsed = timestamp - startTime;
  const gx = gravX, gy = gravY;

  // 1. Viscosity damping: cold/thick at t=0, warm/fluid at t=DURATION_MS
  const _t = Math.min(1, elapsed / DURATION_MS);
  const _retain = 1 - (0.06 * (1 - _t) + 0.003 * _t);
  const _fu = _fluid.u, _fv = _fluid.v;
  for (let _k = 0; _k < _fu.length; _k++) _fu[_k] *= _retain;
  for (let _k = 0; _k < _fv.length; _k++) _fv[_k] *= _retain;

  // 2. Advance fluid
  _fluid.step(gx, gy);

  // 2. Render fluid dye → full-screen background
  _smallCtx.putImageData(_fluid.renderDye(OIL_R, OIL_G, OIL_B), 0, 0);
  _ctx.drawImage(_small, 0, 0, _canvas.width, _canvas.height);

  // 3. Composite staticBuf (transparent bg, opaque settled/unreleased grains)
  _sandCtx.putImageData(getStaticBuf(), 0, 0);
  _ctx.drawImage(_sandCanvas, 0, 0);

  // 4. Update moving grains → pixel buffer, then composite
  scanRepose();
  updateParticles(elapsed, _fluid);
  _movingCtx.putImageData(getMovingBuf(), 0, 0);
  _ctx.drawImage(_movingCanvas, 0, 0);

  _timerEl.textContent = elapsed < DURATION_MS ? _formatTime(DURATION_MS - elapsed) : '0:00';

  if (_hudEl.style.display === 'flex') {
    _fluid.renderVectors(_ctx, 4, 30);
    _smoothFps += (1000 / frameDelta - _smoothFps) * 0.1;
    _fpsEl.textContent = Math.round(_smoothFps) + ' fps';
    _viscosityEl.textContent = 'kill ' + ((1 - _retain) * 100).toFixed(1) + '%';
    _airborneEl.textContent = '↑ ' + airborneCount.toLocaleString();
  }

  rafId = requestAnimationFrame(frame);
}
