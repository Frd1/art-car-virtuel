// Maths de la superposition, sans DOM (testable dans Node).
import { rectToQuad } from './pipeline.js';

// Applique l'homographie [a..h] à un point.
export function applyH(H, x, y) {
  const den = H[6] * x + H[7] * y + 1;
  return [(H[0] * x + H[1] * y + H[2]) / den, (H[3] * x + H[4] * y + H[5]) / den];
}

// Ordre des coins : haut-gauche, haut-droit, bas-droit, bas-gauche.
// flip = miroir horizontal du dessin (on échange les colonnes, pas de re-rastérisation).
export function cornersFor(quadPx, flip) {
  return flip ? [quadPx[1], quadPx[0], quadPx[3], quadPx[2]] : quadPx;
}

// Chaîne CSS matrix3d qui envoie un élément de taille (w,h), origine en haut à gauche, sur le quad.
export function cssMatrix(quadPx, w, h, flip = false) {
  const [a, b, c, d, e, f, g, hh] = rectToQuad(cornersFor(quadPx, flip), w, h);
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${hh},0,0,1,0,${c},${f},0,1)`;
}

export function translateQuad(q, dx, dy) {
  return q.map(([x, y]) => [x + dx, y + dy]);
}

// Pincement à deux doigts : (pa,pb) positions précédentes, (ca,cb) positions courantes.
// Le quad subit la même similitude (déplacement + échelle + rotation) que la paire de doigts.
export function pinchQuad(q, pa, pb, ca, cb) {
  const pv = [pb[0] - pa[0], pb[1] - pa[1]];
  const cv = [cb[0] - ca[0], cb[1] - ca[1]];
  const pl = Math.hypot(pv[0], pv[1]);
  const cl = Math.hypot(cv[0], cv[1]);
  if (pl < 1e-6 || cl < 1e-6) return q;
  const s = cl / pl;
  const da = Math.atan2(cv[1], cv[0]) - Math.atan2(pv[1], pv[0]);
  const cos = Math.cos(da) * s;
  const sin = Math.sin(da) * s;
  const pm = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  const cm = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2];
  return q.map(([x, y]) => {
    const dx = x - pm[0];
    const dy = y - pm[1];
    return [cm[0] + dx * cos - dy * sin, cm[1] + dx * sin + dy * cos];
  });
}

// Zoom centré sur un point (molette sur ordinateur) et rotation autour d'un point.
export function scaleQuadAbout(q, cx, cy, s) {
  return q.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]);
}
export function rotateQuadAbout(q, cx, cy, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return q.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}

export const centroid = (q) => [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];

// Rectangle initial : ~50 % de la largeur de la scène, centré, ratio du dessin conservé.
export function initialQuad(artW, artH, stageW, stageH) {
  let w = stageW * 0.5;
  let h = (w * artH) / artW;
  if (h > stageH * 0.6) {
    h = stageH * 0.6;
    w = (h * artW) / artH;
  }
  const x0 = (stageW - w) / 2;
  const y0 = (stageH - h) / 2;
  return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
}
