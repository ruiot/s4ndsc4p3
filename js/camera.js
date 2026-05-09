let segmenter  = null;
let segReady   = false;
let stream     = null;
export let facingMode = 'user';

export async function initSegmenter() {
  if (segmenter !== null) return;
  segmenter = false; // loading sentinel
  try {
    const s = new SelfieSegmentation({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`
    });
    s.setOptions({ modelSelection: 1 });
    s.onResults(() => {});
    await s.initialize();
    segmenter = s;
    segReady = true;
  } catch (e) {
    console.warn('Segmenter unavailable:', e);
    segmenter = null;
  }
}

function smoothMask(data, w, h) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let fg = 0, total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          total++;
          if (data[(ny * w + nx) * 4] > 128) fg++;
        }
      }
      const p = (y * w + x) * 4;
      const v = (fg * 2 >= total) ? 255 : 0;
      out[p] = out[p+1] = out[p+2] = v; out[p+3] = 255;
    }
  }
  return out;
}

export async function extractMaskData(imageEl, w, h) {
  if (!segReady || !segmenter) return null;
  return new Promise(resolve => {
    segmenter.onResults(results => {
      segmenter.onResults(() => {});
      if (!results.segmentationMask) { resolve(null); return; }
      const oc = document.createElement('canvas');
      oc.width = w; oc.height = h;
      const octx = oc.getContext('2d');
      octx.drawImage(results.segmentationMask, 0, 0, w, h);
      const raw = octx.getImageData(0, 0, w, h).data;
      resolve(smoothMask(smoothMask(raw, w, h), w, h));
    });
    try { segmenter.send({ image: imageEl }); }
    catch (e) { resolve(null); }
  });
}

export async function startCamera(videoEl) {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    videoEl.srcObject = stream;
    videoEl.classList.toggle('mirror', facingMode === 'user');
    return true;
  } catch (e) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      videoEl.srcObject = stream;
      return true;
    } catch (e2) {
      return false;
    }
  }
}

export function stopCamera(videoEl) {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (videoEl) videoEl.srcObject = null;
}

export async function flipCamera(videoEl) {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  stopCamera(videoEl);
  return startCamera(videoEl);
}
