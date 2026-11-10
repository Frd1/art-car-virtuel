import './style.css';
import { warpQuad, prepare, vectorize } from './pipeline.js';
import { initOverlay, DEMO_SVG } from './overlay.js';

const $ = (id) => document.getElementById(id);

const state = {
  img: null, // ImageData de la photo (réduite)
  quad: null, // coins en pixels de l'image réduite
  flat: null, // ImageData redressée
  mode: 'noir',
  svg: '',
  drag: -1,
};

const MAX_PHOTO = 1600; // réduction de la photo pour rester fluide sur un vieux téléphone

// ---------- Chargement de la photo ----------

async function loadFile(file) {
  if (!file) return;
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_PHOTO / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  state.img = ctx.getImageData(0, 0, w, h);
  state.photoCanvas = c;
  const m = 0.1;
  state.quad = [[w * m, h * m], [w * (1 - m), h * m], [w * (1 - m), h * (1 - m)], [w * m, h * (1 - m)]];
  $('s-crop').hidden = false;
  $('s-trace').hidden = true;
  $('s-result').hidden = true;
  drawCrop();
  $('s-crop').scrollIntoView({ behavior: 'smooth' });
}

$('in-camera').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('in-file').addEventListener('change', (e) => loadFile(e.target.files[0]));

// ---------- Cadrage 4 coins ----------

const cv = $('cv-crop');

function drawCrop() {
  const { width: w, height: h } = state.img;
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(state.photoCanvas, 0, 0);
  const r = Math.max(14, w / 40);
  ctx.lineWidth = Math.max(2, w / 400);
  ctx.strokeStyle = '#ff6a3d';
  ctx.fillStyle = 'rgba(255,106,61,0.25)';
  ctx.beginPath();
  state.quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  state.quad.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6a3d';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  });
}

function canvasPoint(e) {
  const rect = cv.getBoundingClientRect();
  return [((e.clientX - rect.left) / rect.width) * cv.width, ((e.clientY - rect.top) / rect.height) * cv.height];
}

cv.addEventListener('pointerdown', (e) => {
  const [px, py] = canvasPoint(e);
  let best = -1;
  let bd = Infinity;
  state.quad.forEach(([x, y], i) => {
    const d = Math.hypot(x - px, y - py);
    if (d < bd) { bd = d; best = i; }
  });
  // zone de saisie large pour les doigts
  if (bd < cv.width / 8) {
    state.drag = best;
    cv.setPointerCapture(e.pointerId);
  }
});
cv.addEventListener('pointermove', (e) => {
  if (state.drag < 0) return;
  const [px, py] = canvasPoint(e);
  state.quad[state.drag] = [Math.min(Math.max(px, 0), cv.width), Math.min(Math.max(py, 0), cv.height)];
  drawCrop();
});
const endDrag = () => { state.drag = -1; };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

// ---------- Redressement ----------

$('btn-warp').addEventListener('click', () => {
  try {
    state.flat = warpQuad(state.img, state.quad, 1000);
  } catch (err) {
    alert(err.message);
    return;
  }
  const f = $('cv-flat');
  f.width = state.flat.width;
  f.height = state.flat.height;
  f.getContext('2d').putImageData(new ImageData(state.flat.data, state.flat.width, state.flat.height), 0, 0);
  $('s-trace').hidden = false;
  $('s-result').hidden = true;
  $('s-trace').scrollIntoView({ behavior: 'smooth' });
});

// ---------- Réglages ----------

function setMode(mode) {
  state.mode = mode;
  $('m-noir').classList.toggle('on', mode === 'noir');
  $('m-couleurs').classList.toggle('on', mode === 'couleurs');
  $('c-threshold').hidden = mode !== 'noir';
  $('c-colors').hidden = mode !== 'couleurs';
  $('c-bg').hidden = mode !== 'couleurs';
}
$('m-noir').addEventListener('click', () => setMode('noir'));
$('m-couleurs').addEventListener('click', () => setMode('couleurs'));
$('r-colors').addEventListener('input', (e) => ($('v-colors').textContent = e.target.value));

// ---------- Vectorisation ----------

$('btn-trace').addEventListener('click', () => {
  const status = $('status');
  status.textContent = 'Vectorisation en cours...';
  // laisse le navigateur afficher le message avant le calcul
  setTimeout(() => {
    try {
      const t0 = performance.now();
      const opts = {
        mode: state.mode,
        threshold: +$('r-threshold').value,
        bgTolerance: +$('r-bg').value,
        colors: +$('r-colors').value,
        detail: +$('r-detail').value,
      };
      const clean = prepare(state.flat, opts);
      state.svg = vectorize(clean, opts);
      $('svg-out').innerHTML = state.svg;
      const n = (state.svg.match(/<path/g) || []).length;
      status.textContent = `${n} tracés, ${Math.round(performance.now() - t0)} ms`;
      $('s-result').hidden = false;
      $('s-result').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      status.textContent = 'Erreur : ' + err.message;
    }
  }, 30);
});

// ---------- Export ----------

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$('btn-svg').addEventListener('click', () => {
  download(new Blob([state.svg], { type: 'image/svg+xml' }), 'dessin.svg');
});

$('btn-png').addEventListener('click', () => {
  // le SVG n'a qu'un viewBox : on ajoute une taille explicite pour que l'Image l'accepte
  const sized = state.svg.replace(
    '<svg ',
    `<svg width="${state.flat.width}" height="${state.flat.height}" `
  );
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = state.flat.width;
    c.height = state.flat.height;
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    c.toBlob((b) => download(b, 'dessin.png'), 'image/png');
    URL.revokeObjectURL(url);
  };
  im.src = url;
});

// ---------- Étape 2 : poser le dessin sur un véhicule ----------

const overlay = initOverlay();

async function openOverlay(svgText) {
  $('s-overlay').hidden = false;
  await overlay.setDrawing(await overlay.rasterizeSvg(svgText));
  $('s-overlay').scrollIntoView({ behavior: 'smooth' });
}

$('btn-to-overlay').addEventListener('click', () => openOverlay(state.svg));
$('btn-demo').addEventListener('click', () => openOverlay(DEMO_SVG));
