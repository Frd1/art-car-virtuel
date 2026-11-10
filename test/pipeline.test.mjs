import assert from 'node:assert/strict';
import { warpQuad, prepare, vectorize, rectToQuad } from '../src/pipeline.js';

// Photo synthétique 800x600 : table grise, feuille légèrement penchée un peu sombre,
// avec un disque noir et un rectangle rouge dessinés dessus.
const W = 800, H = 600;
const data = new Uint8ClampedArray(W * H * 4);
const paper = [[150, 100], [650, 130], [630, 520], [130, 480]];
function inQuad(x, y, q) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4];
    const c = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    if (c < 0) s--; else s++;
  }
  return Math.abs(s) === 4;
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const o = (y * W + x) * 4;
  let c = [90, 90, 95];
  if (inQuad(x, y, paper)) {
    c = [225, 222, 215]; // papier un peu gris (éclairage faible)
    if (Math.hypot(x - 330, y - 290) < 70) c = [20, 20, 25];
    if (x > 430 && x < 540 && y > 240 && y < 340) c = [190, 40, 40];
  }
  data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
}
const src = { width: W, height: H, data };

const warped = warpQuad(src, paper, 600);
assert.ok(warped.width > 300 && warped.height > 200, 'taille de sortie plausible');
// Les coins du redressé doivent être du papier (clair), pas la table.
const px = (img, x, y) => img.data[(y * img.width + x) * 4];
assert.ok(px(warped, 5, 5) > 200, 'coin haut-gauche = papier');
assert.ok(px(warped, warped.width - 6, warped.height - 6) > 200, 'coin bas-droit = papier');

// Homographie : le coin (0,0) du rectangle doit tomber sur le 1er coin du quad.
const Hm = rectToQuad(paper, 100, 100);
assert.ok(Math.abs(Hm[2] - 150) < 1e-6 && Math.abs(Hm[5] - 100) < 1e-6, 'origine -> premier coin');

const black = vectorize(prepare(warped, { mode: 'noir', threshold: 50 }), { mode: 'noir' });
const nPathsBlack = (black.match(/<path/g) || []).length;
assert.ok(nPathsBlack >= 1, 'au moins un tracé en mode noir');
assert.ok(!/fill="rgb\(255,255,255\)"/.test(black), 'fond blanc retiré');

const color = vectorize(prepare(warped, { mode: 'couleurs', bgTolerance: 30 }), { mode: 'couleurs', colors: 4 });
assert.ok(/fill="rgb\(/.test(color), 'tracés couleur présents');
assert.ok(/rgb\(1[5-9]\d,\s*[0-9]\d?,\s*[0-9]\d?\)|rgb\((1[5-9]\d|2\d\d),/.test(color), 'une teinte rouge est conservée');
console.log('OK', { warped: [warped.width, warped.height], pathsNoir: nPathsBlack, tailleSvgCouleur: color.length });
