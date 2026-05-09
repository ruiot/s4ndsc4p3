// MAC grid fluid sim. u on vertical faces (left of cell), v on horizontal faces (top of cell),
// p and dye at cell centers. All indexed j*stride+i.

export class FluidSim {
  constructor(cols, rows, cellSize) {
    this.cols = cols;
    this.rows = rows;
    this.cs   = cellSize;

    const nU = (cols + 1) * rows;
    const nV = cols * (rows + 1);
    const nC = cols * rows;

    this.u    = new Float32Array(nU);   // u face: j*(cols+1)+i
    this.u0   = new Float32Array(nU);
    this.v    = new Float32Array(nV);   // v face: j*cols+i
    this.v0   = new Float32Array(nV);
    this.p    = new Float32Array(nC);
    this.p0   = new Float32Array(nC);
    this.dye  = new Float32Array(nC);
    this.dye0 = new Float32Array(nC);
    this.solid = new Uint8Array(nC);    // 1=fluid, 0=wall

    this._dyeImg = new ImageData(cols, rows);  // 1px per cell for fast rendering
    this.dt = 1 / 60;
    this._initSolid();
  }

  _initSolid() {
    const { cols, rows, solid } = this;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        solid[j*cols+i] = (i===0||i===cols-1||j===0||j===rows-1) ? 0 : 1;
  }

  step(gx, gy) {
    this._applyGravity(gx, gy);
    this._advectVel();
    this._project(8);
    this._advectDye();
    this._decayDye();
  }

  _applyGravity(gx, gy) {
    const { cols, rows, u, v, solid, dt } = this;
    const G = 9.81 * dt;
    const cp1 = cols + 1;
    for (let j = 1; j < rows-1; j++)
      for (let i = 1; i < cols; i++)
        if (solid[j*cols+i-1] & solid[j*cols+i])
          u[j*cp1+i] += gx * G;
    for (let j = 1; j < rows; j++)
      for (let i = 1; i < cols-1; i++)
        if (solid[(j-1)*cols+i] & solid[j*cols+i])
          v[j*cols+i] += gy * G;
  }

  _advectVel() {
    const { cols, rows, u, v, u0, v0, dt, cs } = this;
    u0.set(u); v0.set(v);
    const cp1 = cols + 1;
    for (let j = 1; j < rows-1; j++)
      for (let i = 1; i < cols; i++) {
        const x = i*cs, y = (j+0.5)*cs;
        const vx = this._sU(x, y, u0), vy = this._sV(x, y, v0);
        u[j*cp1+i] = this._sU(x - vx*dt*cs, y - vy*dt*cs, u0);
      }
    for (let j = 1; j < rows; j++)
      for (let i = 1; i < cols-1; i++) {
        const x = (i+0.5)*cs, y = j*cs;
        const vx = this._sU(x, y, u0), vy = this._sV(x, y, v0);
        v[j*cols+i] = this._sV(x - vx*dt*cs, y - vy*dt*cs, v0);
      }
  }

  _project(iters) {
    const { cols, rows, u, v, solid } = this;
    const cs = this.cs, invCs = 1 / cs;
    const cp1 = cols + 1;
    // Use local variables for the ping-pong so the swap is actually visible each iter.
    let pA = this.p, pB = this.p0;
    pA.fill(0); pB.fill(0);

    for (let iter = 0; iter < iters; iter++) {
      for (let j = 1; j < rows-1; j++) {
        const jc = j*cols, jcp1 = j*cp1;
        const jcU = (j+1)*cols, jcp1U = (j+1)*cp1;
        const jcP = (j-1)*cols;
        for (let i = 1; i < cols-1; i++) {
          if (!solid[jc+i]) continue;
          const div = (u[jcp1+i+1] - u[jcp1+i] + v[jcU+i] - v[jc+i]) * invCs;
          const sL = solid[jc+i-1], sR = solid[jc+i+1];
          const sT = solid[jcP+i],  sB = solid[jcU+i];
          const n = sL + sR + sT + sB;
          if (!n) continue;
          pB[jc+i] = (-div*cs + sL*pA[jc+i-1] + sR*pA[jc+i+1] + sT*pA[jcP+i] + sB*pA[jcU+i]) / n;
        }
      }
      // swap: pA becomes the freshly written buffer for next iteration's reads
      const tmp = pA; pA = pB; pB = tmp;
    }
    this.p = pA; this.p0 = pB;

    // subtract pressure gradient from velocity
    for (let j = 1; j < rows-1; j++)
      for (let i = 1; i < cols; i++) {
        if (solid[j*cols+i-1] || solid[j*cols+i])
          u[j*cp1+i] -= (pA[j*cols+i] - pA[j*cols+i-1]) * invCs;
      }
    for (let j = 1; j < rows; j++)
      for (let i = 1; i < cols-1; i++) {
        if (solid[(j-1)*cols+i] || solid[j*cols+i])
          v[j*cols+i] -= (pA[j*cols+i] - pA[(j-1)*cols+i]) * invCs;
      }

    // zero normal velocity at all solid faces
    for (let j = 0; j < rows; j++)
      for (let i = 0; i <= cols; i++) {
        const lF = i>0    && solid[j*cols+i-1];
        const rF = i<cols && solid[j*cols+i];
        if (!lF || !rF) u[j*cp1+i] = 0;
      }
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i < cols; i++) {
        const tF = j>0    && solid[(j-1)*cols+i];
        const bF = j<rows && solid[j*cols+i];
        if (!tF || !bF) v[j*cols+i] = 0;
      }
  }

  _advectDye() {
    const { cols, rows, dye, dye0, dt, cs, solid } = this;
    dye0.set(dye);
    for (let j = 1; j < rows-1; j++)
      for (let i = 1; i < cols-1; i++) {
        if (!solid[j*cols+i]) continue;
        const x = (i+0.5)*cs, y = (j+0.5)*cs;
        const vx = this._sU(x, y, this.u), vy = this._sV(x, y, this.v);
        dye[j*cols+i] = this._sDye(x - vx*dt*cs, y - vy*dt*cs, dye0);
      }
  }

  _decayDye() {
    const d = this.dye;
    for (let k = 0; k < d.length; k++) d[k] *= 0.995;
  }

  // --- bilinear samplers — take the backing array explicitly so advect can use u0/v0 ---

  _sU(px, py, arr) {
    // u at x=i*cs, y=(j+0.5)*cs — staggered half-cell in y
    const { cols, rows, cs } = this;
    const cp1 = cols + 1;
    const gx = Math.max(0, Math.min(cols,   px / cs));
    const gy = Math.max(0, Math.min(rows-1, py / cs - 0.5));
    const i0 = Math.min(cols-1, gx | 0),   i1 = i0 + 1;
    const j0 = Math.min(rows-2, gy | 0),   j1 = j0 + 1;
    const tx = gx - (gx | 0), ty = gy - (gy | 0);
    return (1-tx)*(1-ty)*arr[j0*cp1+i0] + tx*(1-ty)*arr[j0*cp1+i1]
         + (1-tx)*ty    *arr[j1*cp1+i0] + tx*ty    *arr[j1*cp1+i1];
  }

  _sV(px, py, arr) {
    // v at x=(i+0.5)*cs, y=j*cs — staggered half-cell in x
    const { cols, rows, cs } = this;
    const gx = Math.max(0, Math.min(cols-1, px / cs - 0.5));
    const gy = Math.max(0, Math.min(rows,   py / cs));
    const i0 = Math.min(cols-2, gx | 0),   i1 = i0 + 1;
    const j0 = Math.min(rows-1, gy | 0),   j1 = j0 + 1;
    const tx = gx - (gx | 0), ty = gy - (gy | 0);
    return (1-tx)*(1-ty)*arr[j0*cols+i0] + tx*(1-ty)*arr[j0*cols+i1]
         + (1-tx)*ty    *arr[j1*cols+i0] + tx*ty    *arr[j1*cols+i1];
  }

  _sDye(px, py, arr) {
    const { cols, rows, cs } = this;
    const gx = Math.max(0, Math.min(cols-1, px / cs - 0.5));
    const gy = Math.max(0, Math.min(rows-1, py / cs - 0.5));
    const i0 = Math.min(cols-2, gx | 0),   i1 = i0 + 1;
    const j0 = Math.min(rows-2, gy | 0),   j1 = j0 + 1;
    const tx = gx - (gx | 0), ty = gy - (gy | 0);
    return (1-tx)*(1-ty)*arr[j0*cols+i0] + tx*(1-ty)*arr[j0*cols+i1]
         + (1-tx)*ty    *arr[j1*cols+i0] + tx*ty    *arr[j1*cols+i1];
  }

  addForce(px, py, forceX, forceY, dyeAmt) {
    const { cols, rows, cs } = this;
    const cp1 = cols + 1;
    const ci = (px / cs) | 0, cj = (py / cs) | 0;
    const R = 3;
    for (let dj = -R; dj <= R; dj++)
      for (let di = -R; di <= R; di++) {
        const i = ci+di, j = cj+dj;
        if (i<1||i>=cols-1||j<1||j>=rows-1) continue;
        const w = Math.exp(-(di*di+dj*dj)/(R*R));
        this.u[j*cp1+i]     += forceX * w;
        this.u[j*cp1+i+1]   += forceX * w;
        this.v[j*cols+i]     += forceY * w;
        this.v[(j+1)*cols+i] += forceY * w;
        if (dyeAmt > 0) this.dye[j*cols+i] += dyeAmt * w;
      }
  }

  // Fills a cols×rows ImageData (1px per cell) — caller scales it up with drawImage.
  renderDye(r, g, b) {
    const { cols, rows, dye } = this;
    const d = this._dyeImg.data;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j*cols+i;
        const dv = dye[idx] > 1 ? 1 : dye[idx];
        const bv = (dv * 255) | 0;
        const dark = ((1 - dv) * 10) | 0;
        const k = idx * 4;
        d[k]   = dark + ((r * bv) >> 8);
        d[k+1] = dark + ((g * bv) >> 8);
        d[k+2] = dark + ((b * bv) >> 8);
        d[k+3] = 255;
      }
    }
    return this._dyeImg;
  }

  // Overlay velocity arrows on an existing ctx (screen coords = cell coords × cs).
  renderVectors(ctx, stride, scale) {
    const { cols, rows, cs } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,80,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 1; j < rows-1; j += stride)
      for (let i = 1; i < cols-1; i += stride) {
        const x = (i+0.5)*cs, y = (j+0.5)*cs;
        const ux = this._sU(x, y, this.u);
        const vy = this._sV(x, y, this.v);
        ctx.moveTo(x, y);
        ctx.lineTo(x + ux*scale, y + vy*scale);
      }
    ctx.stroke();
    ctx.restore();
  }
}
