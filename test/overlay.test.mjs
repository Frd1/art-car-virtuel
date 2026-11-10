import assert from 'node:assert/strict';
import { rectToQuad } from '../src/pipeline.js';
import { applyH, cssMatrix, pinchQuad, translateQuad, initialQuad, cornersFor, scaleQuadAbout } from '../src/overlay-math.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// 1. L'homographie envoie bien les 4 coins du dessin sur le quad.
const quad = [[120, 80], [420, 110], [400, 330], [100, 290]];
const H = rectToQuad(quad, 800, 500);
[[0, 0], [800, 0], [800, 500], [0, 500]].forEach(([x, y], i) => {
  const [u, v] = applyH(H, x, y);
  close(u, quad[i][0]); close(v, quad[i][1]);
});

// 2. matrix3d : forme attendue (16 valeurs) et cohérente avec H (colonne 4 = perspective).
const m = cssMatrix(quad, 800, 500);
const nums = m.match(/matrix3d\((.*)\)/)[1].split(',').map(Number);
assert.equal(nums.length, 16);
close(nums[0], H[0]); close(nums[1], H[3]); close(nums[3], H[6]);
close(nums[4], H[1]); close(nums[5], H[4]); close(nums[7], H[7]);
close(nums[12], H[2]); close(nums[13], H[5]); close(nums[15], 1);

// 3. Miroir : le coin haut-gauche du dessin va sur le coin haut-droit du quad.
const Hf = rectToQuad(cornersFor(quad, true), 800, 500);
const [fx, fy] = applyH(Hf, 0, 0);
close(fx, quad[1][0]); close(fy, quad[1][1]);

// 4. Pincement : translation pure = translateQuad.
const t = pinchQuad(quad, [100, 100], [200, 100], [130, 90], [230, 90]);
const t2 = translateQuad(quad, 30, -10);
t.forEach((p, i) => { close(p[0], t2[i][0]); close(p[1], t2[i][1]); });

// 5. Pincement : écart des doigts x2 => tailles x2, centre des doigts conservé.
const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
const z = pinchQuad(sq, [40, 50], [60, 50], [30, 50], [70, 50]);
close(Math.hypot(z[1][0] - z[0][0], z[1][1] - z[0][1]), 200);
const z2 = scaleQuadAbout(sq, 50, 50, 2);
z.forEach((p, i) => { close(p[0], z2[i][0]); close(p[1], z2[i][1]); });

// 6. Rotation de 90 degrés des doigts => le quad tourne de 90 degrés.
const r = pinchQuad(sq, [0, 0], [10, 0], [0, 0], [0, 10]);
close(r[1][0], 0); close(r[1][1], 100);

// 7. Quad initial centré et dans la scène.
const iq = initialQuad(800, 500, 400, 300);
close((iq[0][0] + iq[1][0]) / 2, 200);
close((iq[0][1] + iq[3][1]) / 2, 150);
assert.ok(iq[2][1] <= 300 && iq[0][1] >= 0);
const tall = initialQuad(300, 900, 400, 300);
assert.ok(tall[3][1] - tall[0][1] <= 300 * 0.6 + 1e-9);

console.log('overlay OK');
