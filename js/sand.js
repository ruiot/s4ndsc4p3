import { gravX, gravY } from './orientation.js?v=0.2.23';

const _gs = +(new URLSearchParams(location.search).get('gs')) || 3;
export const GRID_SIZE   = (_gs >= 1 && _gs <= 8) ? _gs : 3;
export const GRAVITY     = 0.02;
export const DRAG        = 0.97;
export const TURBULENCE  = 0.02;  // constant lateral wobble; ~4% of terminal velocity
export const DURATION_MS = 169000;
export const COUPLING    = 0.05;
const GRAIN_FORCE    = 0.0003;
const SETTLE_IMPULSE = 0.01;

export let N = 0, partCols = 0, rowCount = 0;
export let fgParticleCount = 0;
export let airborneCount = 0;

let px, py, pvx, pvy, pr, pg, pb, pactive, prelease;
let occ, cellPart;
let staticBuf = null;
let movingBuf = null, movingData = null;
let _W = 0, _H = 0;
let _fluid = null;
let _fxBuf = null;
let _fyBuf = null;
let _silBuf = null;

export function getStaticBuf() { return staticBuf; }
export function getMovingBuf() { return movingBuf; }
export function setFluidRef(f) { _fluid = f; _fxBuf = null; _fyBuf = null; }

export function initSilhouette(fluid) {
  const { cols, rows, cs } = fluid;
  _silBuf = new Uint16Array(cols * rows);

  for (let i = 0; i < N; i++) {
    if (pactive[i] !== 0) continue;
    const fc = Math.max(0, Math.min(cols - 1, (px[i] / cs) | 0));
    const fr = Math.max(0, Math.min(rows - 1, (py[i] / cs) | 0));
    _silBuf[fr * cols + fc]++;
  }

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const isBorder = (i === 0 || i === cols - 1 || j === 0 || j === rows - 1);
      fluid.solid[k] = (isBorder || _silBuf[k] > 0) ? 0 : 1;
    }
  }
}

// ── Static buffer helpers ─────────────────────────────────────────────────────

function eraseCellAt(col, row) {
  const sd = staticBuf.data;
  const x0 = col * GRID_SIZE, y0 = row * GRID_SIZE;
  for (let dy = 0; dy < GRID_SIZE; dy++) {
    const y = y0 + dy; if (y < 0 || y >= _H) continue;
    for (let dx = 0; dx < GRID_SIZE; dx++) {
      const x = x0 + dx; if (x < 0 || x >= _W) continue;
      const p = (y * _W + x) * 4;
      sd[p] = 0; sd[p+1] = 0; sd[p+2] = 0; sd[p+3] = 0;
    }
  }
}

function eraseFromBuf(i) {
  eraseCellAt(
    Math.round(px[i] / GRID_SIZE - 0.5),
    Math.round(py[i] / GRID_SIZE - 0.5)
  );
}

function paintToBuf(i) {
  const sd = staticBuf.data;
  const ts = GRID_SIZE;
  const x0 = Math.round(px[i] - ts * 0.5);
  const y0 = Math.round(py[i] - ts * 0.5);
  for (let dy = 0; dy < ts; dy++) {
    const y = y0 + dy; if (y < 0 || y >= _H) continue;
    for (let dx = 0; dx < ts; dx++) {
      const x = x0 + dx; if (x < 0 || x >= _W) continue;
      const p = (y * _W + x) * 4;
      sd[p] = pr[i]; sd[p+1] = pg[i]; sd[p+2] = pb[i]; sd[p+3] = 255;
    }
  }
}

// ── Settling helpers ──────────────────────────────────────────────────────────

function doSettle(i, col, row) {
  px[i] = (col + 0.5) * GRID_SIZE;
  py[i] = (row + 0.5) * GRID_SIZE;
  pvx[i] = pvy[i] = 0;
  pactive[i] = 2;
  occ[row * partCols + col] = 1;
  cellPart[row * partCols + col] = i;
  paintToBuf(i);
  if (_fluid) _fluid.addForce(px[i], py[i], -gravX * SETTLE_IMPULSE, -gravY * SETTLE_IMPULSE, 0);
}

function trySettle(i) {
  const col = Math.max(0, Math.min(partCols - 1, Math.floor(px[i] / GRID_SIZE)));
  const row = Math.max(0, Math.min(rowCount  - 1, Math.floor(py[i] / GRID_SIZE)));

  if (!occ[row * partCols + col]) { doSettle(i, col, row); return; }

  const pdc = -Math.round(gravY);
  const pdr =  Math.round(gravX);
  for (const s of [1, -1]) {
    const nc = col + s * pdc, nr = row + s * pdr;
    if (nc >= 0 && nc < partCols && nr >= 0 && nr < rowCount && !occ[nr * partCols + nc]) {
      doSettle(i, nc, nr); return;
    }
  }
  pvx[i] = (Math.random() - 0.5) * 0.5;
  pvy[i] = gravY * 0.1 + gravX * 0.1;
  pactive[i] = 1;
}

function releaseFromOcc(i) {
  const col = i % partCols;
  const row = (i / partCols) | 0;
  occ[row * partCols + col] = 0;
}

// ── Repose scan ───────────────────────────────────────────────────────────────

export function scanRepose() {
  const dc = Math.round(gravX);
  const dr = Math.round(gravY);
  if (dc === 0 && dr === 0) return;

  const pdc = -dr, pdr = dc;

  for (let i = 0; i < N; i++) {
    if (pactive[i] !== 2) continue;

    const col = Math.round(px[i] / GRID_SIZE - 0.5);
    const row = Math.round(py[i] / GRID_SIZE - 0.5);

    const bc = col + dc, br = row + dr;
    const atBound = bc < 0 || bc >= partCols || br < 0 || br >= rowCount;

    if (!atBound && !occ[br * partCols + bc]) {
      eraseFromBuf(i);
      occ[row * partCols + col] = 0;
      cellPart[row * partCols + col] = -1;
      pvx[i] = gravX * 0.05; pvy[i] = gravY * 0.05;
      pactive[i] = 1;
      continue;
    }

    const sides = Math.random() < 0.5 ? [1, -1] : [-1, 1];
    for (const s of sides) {
      const diagC = bc + s * pdc, diagR = br + s * pdr;
      if (diagC < 0 || diagC >= partCols || diagR < 0 || diagR >= rowCount) continue;
      if (occ[diagR * partCols + diagC]) continue;

      const sideC = col + s * pdc, sideR = row + s * pdr;
      const sideOccupied = sideC < 0 || sideC >= partCols || sideR < 0 || sideR >= rowCount
                           || occ[sideR * partCols + sideC];
      if (!sideOccupied && Math.random() > 0.2) continue;

      eraseFromBuf(i);
      occ[row * partCols + col] = 0;
      cellPart[row * partCols + col] = -1;
      doSettle(i, diagC, diagR);
      break;
    }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initParticles(imgData, maskData, W, H, ctx) {
  _W = W; _H = H;
  partCols = (W / GRID_SIZE) | 0;
  rowCount = (H / GRID_SIZE) | 0;
  N = partCols * rowCount;

  px       = new Float32Array(N);
  py       = new Float32Array(N);
  pvx      = new Float32Array(N);
  pvy      = new Float32Array(N);
  pr       = new Uint8Array(N);
  pg       = new Uint8Array(N);
  pb       = new Uint8Array(N);
  pactive  = new Uint8Array(N);
  prelease = new Float32Array(N);

  occ      = new Uint8Array(partCols * rowCount);
  cellPart = new Int32Array(partCols * rowCount).fill(-1);
  fgParticleCount = 0;

  staticBuf = ctx.createImageData(W, H);
  movingBuf = ctx.createImageData(W, H);
  movingData = movingBuf.data;
  const sd  = staticBuf.data;
  for (let k = 0; k < sd.length; k += 4) {
    sd[k] = 0; sd[k+1] = 0; sd[k+2] = 0; sd[k+3] = 0;
  }

  const ts = GRID_SIZE;

  for (let i = 0; i < N; i++) {
    const col = i % partCols;
    const row = (i / partCols) | 0;
    const cx  = (col + 0.5) * GRID_SIZE;
    const cy  = (row + 0.5) * GRID_SIZE;

    px[i] = cx; py[i] = cy;
    pvx[i] = 0; pvy[i] = 0;

    const sx  = Math.min(W - 1, Math.round(cx));
    const sy  = Math.min(H - 1, Math.round(cy));
    const idx = (sy * W + sx) * 4;
    pr[i] = Math.max(40, imgData[idx]);
    pg[i] = Math.max(40, imgData[idx + 1]);
    pb[i] = Math.max(40, imgData[idx + 2]);

    const fg = !maskData || maskData[(sy * W + sx) * 4] > 128;

    if (!fg) { pactive[i] = 3; prelease[i] = 0; continue; }
    fgParticleCount++;

    const x0 = Math.round(cx - ts * 0.5);
    const y0 = Math.round(cy - ts * 0.5);
    for (let dy = 0; dy < ts; dy++) {
      const y = y0 + dy; if (y < 0 || y >= H) continue;
      for (let dx = 0; dx < ts; dx++) {
        const x = x0 + dx; if (x < 0 || x >= W) continue;
        const p = (y * W + x) * 4;
        sd[p] = pr[i]; sd[p+1] = pg[i]; sd[p+2] = pb[i]; sd[p+3] = 255;
      }
    }

    prelease[i] = Math.random() * DURATION_MS;
    pactive[i]  = 0;
    occ[i]      = 1;
    cellPart[i] = i;
  }
}

// ── Per-frame update ──────────────────────────────────────────────────────────

export function updateParticles(elapsed, fluid) {
  const W = _W, H = _H, GS = GRID_SIZE;
  movingData.fill(0);
  airborneCount = 0;
  const _gx = gravX, _gy = gravY;
  const fDt = fluid ? fluid.dt * fluid.cs : 0;

  if (fluid) {
    _fluid = fluid;
    if (!_fxBuf) {
      _fxBuf = new Float32Array(fluid.cols * fluid.rows);
      _fyBuf = new Float32Array(fluid.cols * fluid.rows);
    }
  }

  for (let i = 0; i < N; i++) {
    if (pactive[i] !== 0 && pactive[i] !== 1) continue;

    if (pactive[i] === 0) {
      if (elapsed < prelease[i]) continue;
      pactive[i] = 1;
      eraseFromBuf(i);
      releaseFromOcc(i);
      if (fluid) fluid.addForce(px[i], py[i], 0, 0.3, 0.3);
      if (_silBuf && _fluid) {
        const fc = Math.max(0, Math.min(_fluid.cols - 1, (px[i] / _fluid.cs) | 0));
        const fr = Math.max(0, Math.min(_fluid.rows - 1, (py[i] / _fluid.cs) | 0));
        const sk = fr * _fluid.cols + fc;
        if (_silBuf[sk] > 0 && --_silBuf[sk] === 0) _fluid.solid[sk] = 1;
      }
    }

    pvx[i] = pvx[i] * DRAG + _gx * GRAVITY + (Math.random() - 0.5) * TURBULENCE;
    pvy[i] = pvy[i] * DRAG + _gy * GRAVITY + (Math.random() - 0.5) * TURBULENCE;

    if (fluid) {
      pvx[i] += fluid._sU(px[i], py[i], fluid.u) * fDt * COUPLING;
      pvy[i] += fluid._sV(px[i], py[i], fluid.v) * fDt * COUPLING;
      const fc = Math.max(1, Math.min(fluid.cols - 2, (px[i] / fluid.cs) | 0));
      const fr = Math.max(1, Math.min(fluid.rows - 2, (py[i] / fluid.cs) | 0));
      _fxBuf[fr * fluid.cols + fc] += pvx[i] * GRAIN_FORCE;
      _fyBuf[fr * fluid.cols + fc] += pvy[i] * GRAIN_FORCE;
    }

    px[i] += pvx[i];
    py[i] += pvy[i];

    if (px[i] < 0)  { px[i] = 0;     pvx[i] =  Math.abs(pvx[i]) * 0.3; }
    if (px[i] >= W) { px[i] = W - 1; pvx[i] = -Math.abs(pvx[i]) * 0.3; }
    if (py[i] < 0)  { py[i] = 0;     pvy[i] =  Math.abs(pvy[i]) * 0.3; }
    if (py[i] >= H) { py[i] = H - 1; pvy[i] = -Math.abs(pvy[i]) * 0.3; }

    const cCol = Math.max(0, Math.min(partCols - 1, (px[i] / GS) | 0));
    const cRow = Math.max(0, Math.min(rowCount  - 1, (py[i] / GS) | 0));

    const hitPile  = occ[cRow * partCols + cCol] === 1;
    const hitBound = (_gy > 0.1 && py[i] >= H - GS) ||
                     (_gy < -0.1 && py[i] < GS)      ||
                     (_gx > 0.1 && px[i] >= W - GS)  ||
                     (_gx < -0.1 && px[i] < GS);

    if (hitPile || hitBound) {
      if (hitPile) { px[i] -= pvx[i]; py[i] -= pvy[i]; }
      px[i] = Math.max(0, Math.min(W - 1, px[i]));
      py[i] = Math.max(0, Math.min(H - 1, py[i]));
      trySettle(i);
      if (pactive[i] === 1) {
        airborneCount++;
        const x0 = Math.round(px[i] - GS * 0.5), y0 = Math.round(py[i] - GS * 0.5);
        const ri = pr[i], gi = pg[i], bi = pb[i];
        for (let dy = 0; dy < GS; dy++) {
          const y = y0 + dy; if (y < 0 || y >= H) continue;
          for (let dx = 0; dx < GS; dx++) {
            const x = x0 + dx; if (x < 0 || x >= W) continue;
            const p = (y * W + x) * 4;
            movingData[p] = ri; movingData[p+1] = gi; movingData[p+2] = bi; movingData[p+3] = 255;
          }
        }
      }
    } else {
      airborneCount++;
      const x0 = Math.round(px[i] - GS * 0.5), y0 = Math.round(py[i] - GS * 0.5);
      const ri = pr[i], gi = pg[i], bi = pb[i];
      for (let dy = 0; dy < GS; dy++) {
        const y = y0 + dy; if (y < 0 || y >= H) continue;
        for (let dx = 0; dx < GS; dx++) {
          const x = x0 + dx; if (x < 0 || x >= W) continue;
          const p = (y * W + x) * 4;
          movingData[p] = ri; movingData[p+1] = gi; movingData[p+2] = bi; movingData[p+3] = 255;
        }
      }
    }
  }

  // Apply accumulated grain→fluid forces (P2G), clear buffer as we go
  if (fluid && _fxBuf) {
    const cp1 = fluid.cols + 1;
    for (let j = 1; j < fluid.rows - 1; j++) {
      for (let i = 1; i < fluid.cols - 1; i++) {
        const k = j * fluid.cols + i;
        const fx = _fxBuf[k], fy = _fyBuf[k];
        if (fx === 0 && fy === 0) continue;
        fluid.u[j * cp1 + i]           += fx;
        fluid.u[j * cp1 + i + 1]       += fx;
        fluid.v[j * fluid.cols + i]     += fy;
        fluid.v[(j + 1) * fluid.cols + i] += fy;
        _fxBuf[k] = 0;
        _fyBuf[k] = 0;
      }
    }
  }
}

// ── Touch-triggered pile dislodgement ─────────────────────────────────────────
// Dislodges settled (pactive=2) grains within radius r of (cx,cy).
// dragVx/dragVy: touch delta since last frame → applied as directional impulse.
export function dislodgeInRadius(cx, cy, r, dragVx, dragVy) {
  const r2 = r * r;
  const c0 = Math.max(0, Math.floor((cx - r) / GRID_SIZE));
  const c1 = Math.min(partCols - 1, Math.ceil((cx + r) / GRID_SIZE));
  const rr0 = Math.max(0, Math.floor((cy - r) / GRID_SIZE));
  const rr1 = Math.min(rowCount - 1, Math.ceil((cy + r) / GRID_SIZE));

  for (let row = rr0; row <= rr1; row++) {
    for (let col = c0; col <= c1; col++) {
      const k = row * partCols + col;
      if (!occ[k]) continue;
      const gi = cellPart[k];
      if (gi < 0 || pactive[gi] !== 2) continue;

      const ddx = px[gi] - cx, ddy = py[gi] - cy;
      if (ddx * ddx + ddy * ddy > r2) continue;

      eraseFromBuf(gi);
      occ[k] = 0;
      cellPart[k] = -1;
      // radial outward push from touch center + drag bias + random scatter
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      pvx[gi] = (ddx / dist) * Math.random() * 2.5 + dragVx * 0.12 + (Math.random() - 0.5) * 3.0;
      pvy[gi] = (ddy / dist) * Math.random() * 2.5 + dragVy * 0.12 + (Math.random() - 0.5) * 3.0;
      pactive[gi] = 1;
    }
  }
}
