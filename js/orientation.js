export let gravX = 0;
export let gravY = 1;

const RAD = Math.PI / 180;
let _gravInfoEl = null;

export function setupOrientation(gravInfoEl) {
  _gravInfoEl = gravInfoEl;
}

export function handleOrientation(e) {
  if (e.gamma === null) return;
  const gx_d = Math.sin((e.gamma || 0) * RAD);
  const gy_d = Math.sin((e.beta  || 0) * RAD);
  const ang = (screen.orientation?.angle ?? window.orientation ?? 0) | 0;
  switch (ang) {
    case   0: gravX =  gy_d; gravY = -gx_d; break;
    case  90: gravX =  gx_d; gravY =  gy_d; break;
    case 180: gravX = -gy_d; gravY =  gx_d; break;
    case 270: gravX = -gx_d; gravY = -gy_d; break;
    default:  gravX =  gx_d; gravY =  gy_d;
  }
  if (_gravInfoEl) _gravInfoEl.textContent =
    `ang${ang} β${(e.beta||0).toFixed(0)} γ${(e.gamma||0).toFixed(0)} gx${gravX.toFixed(2)} gy${gravY.toFixed(2)}`;
}

export function handleMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x === null) return;
  const ang = (screen.orientation?.angle ?? window.orientation ?? 0) | 0;
  const gx = (g.x || 0) / 9.81;
  const gy = (g.y || 0) / 9.81;
  // Rotate device axes into screen axes. For iPad 10th gen (natural landscape=ang0):
  // device-x ≡ screen-down, device-y ≡ screen-right; each 90° CW rotation swaps/negates.
  switch (ang) {
    case   0: gravX = -gy; gravY = -gx; break;
    case  90: gravX =  gx; gravY = -gy; break;
    case 180: gravX =  gy; gravY =  gx; break;
    case 270: gravX = -gx; gravY =  gy; break;
    default:  gravX =  gx; gravY = -gy;
  }
  if (_gravInfoEl) _gravInfoEl.textContent =
    `mot ang${ang} gx${gravX.toFixed(2)} gy${gravY.toFixed(2)}`;
}
