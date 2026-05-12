export let gravX = 0;
export let gravY = 1;

const RAD = Math.PI / 180;
let _gravInfoEl = null;

export function setupOrientation(gravInfoEl) {
  _gravInfoEl = gravInfoEl;
}

export function handleOrientation(e) {
  if (e.gamma === null) return;
  const screenAngle = (screen.orientation?.angle ?? window.orientation ?? 0) * RAD;
  const rawX = Math.sin((e.gamma ?? 0) * RAD);
  const rawY = Math.sin((e.beta  ?? 0) * RAD);
  const cos = Math.cos(screenAngle);
  const sin = Math.sin(screenAngle);
  gravX =  rawX * cos + rawY * sin;
  gravY = -rawX * sin + rawY * cos;
  if (_gravInfoEl) {
    const ang = (screen.orientation?.angle ?? window.orientation ?? 0) | 0;
    _gravInfoEl.textContent =
      `ang${ang} β${(e.beta||0).toFixed(0)} γ${(e.gamma||0).toFixed(0)} gx${gravX.toFixed(2)} gy${gravY.toFixed(2)}`;
  }
}

export function handleMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x === null) return;
  // accelerationIncludingGravity is in screen coordinates per W3C spec:
  // +x = screen right, +y = screen up. Negate y for canvas (+y = screen down).
  gravX =  (g.x || 0) / 9.81;
  gravY = -(g.y || 0) / 9.81;
  if (_gravInfoEl) {
    const ang = (screen.orientation?.angle ?? window.orientation ?? 0) | 0;
    _gravInfoEl.textContent = `mot ang${ang} gx${gravX.toFixed(2)} gy${gravY.toFixed(2)}`;
  }
}
