// Pipeline sans DOM : utilisable dans le navigateur et dans Node (tests).
import ImageTracer from 'imagetracerjs';

// ---------- Redressement par homographie (4 coins) ----------

// Résout A x = b par élimination de Gauss (matrice carrée).
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-12) throw new Error('Coins invalides (points alignés ou confondus)');
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

// Homographie qui envoie le rectangle (0,0),(w,0),(w,h),(0,h) vers le quad source.
export function rectToQuad(quad, w, h) {
  const dst = [[0, 0], [w, 0], [w, h], [0, h]];
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i];
    const [u, v] = quad[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const [a, bb, c, d, e, f, g, hh] = solve(A, b);
  return [a, bb, c, d, e, f, g, hh];
}

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// Taille de sortie estimée à partir des côtés du quad, plafonnée à maxSide.
export function outputSize(quad, maxSide = 1000) {
  const w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  const h = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(2, Math.round(w * k)), h: Math.max(2, Math.round(h * k)) };
}

// quad : [[x,y] x4] dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche (pixels de src).
export function warpQuad(src, quad, maxSide = 1000) {
  const { w, h } = outputSize(quad, maxSide);
  const H = rectToQuad(quad, w, h);
  const out = new Uint8ClampedArray(w * h * 4);
  const sd = src.data;
  const sw = src.width;
  const sh = src.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const den = H[6] * x + H[7] * y + 1;
      const u = (H[0] * x + H[1] * y + H[2]) / den;
      const v = (H[3] * x + H[4] * y + H[5]) / den;
      const o = (y * w + x) * 4;
      if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) {
        out[o] = out[o + 1] = out[o + 2] = 255;
        out[o + 3] = 255;
        continue;
      }
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = u - x0;
      const fy = v - y0;
      for (let c = 0; c < 3; c++) {
        const p00 = sd[(y0 * sw + x0) * 4 + c];
        const p10 = sd[(y0 * sw + x1) * 4 + c];
        const p01 = sd[(y1 * sw + x0) * 4 + c];
        const p11 = sd[(y1 * sw + x1) * 4 + c];
        out[o + c] = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

// ---------- Nettoyage du fond ----------

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// Estime le niveau de blanc du papier (percentile élevé de la luminance) pour compenser l'éclairage.
function paperLevel(img) {
  const hist = new Uint32Array(256);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) hist[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++;
  const total = d.length / 4;
  let acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * 0.1) return Math.max(v, 1); // 90e percentile
  }
  return 255;
}

// Mode "noir" : encre noire sur fond blanc. threshold 0..100 (plus haut = plus d'encre retenue).
// Mode "couleurs" : on pousse le fond vers le blanc pur, les couleurs sont gardées.
export function prepare(img, { mode = 'noir', threshold = 50, bgTolerance = 30 } = {}) {
  const out = new Uint8ClampedArray(img.data.length);
  const d = img.data;
  const paper = paperLevel(img);
  const gain = 255 / paper;
  for (let i = 0; i < d.length; i += 4) {
    // correction d'éclairage : on ramène le papier à 255
    const r = Math.min(255, d[i] * gain);
    const g = Math.min(255, d[i + 1] * gain);
    const b = Math.min(255, d[i + 2] * gain);
    const L = lum(r, g, b);
    if (mode === 'noir') {
      const cut = 40 + (threshold / 100) * 180; // 40..220
      const v = L < cut ? 0 : 255;
      out[i] = out[i + 1] = out[i + 2] = v;
    } else {
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const isBg = L > 255 - bgTolerance && sat < bgTolerance + 10;
      if (isBg) {
        out[i] = out[i + 1] = out[i + 2] = 255;
      } else {
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
      }
    }
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

// ---------- Vectorisation ----------

const NEAR_WHITE = 245;

// Supprime les tracés quasi blancs (le fond) pour obtenir un SVG à fond transparent.
export function stripBackground(svg) {
  return svg.replace(/<path[^>]*?fill="rgb\((\d+),(\d+),(\d+)\)"[^>]*?\/>/g, (m, r, g, b) =>
    +r >= NEAR_WHITE && +g >= NEAR_WHITE && +b >= NEAR_WHITE ? '' : m
  );
}

// detail 0..100 : plus haut = plus de petits détails conservés.
export function vectorize(img, { mode = 'noir', colors = 6, detail = 50 } = {}) {
  const pathomit = Math.round(40 - (detail / 100) * 38); // 40..2
  const common = {
    ltres: 1,
    qtres: 1,
    pathomit,
    roundcoords: 1,
    strokewidth: 0,
    viewbox: true,
    blurradius: 0,
    linefilter: false,
    scale: 1,
  };
  const options =
    mode === 'noir'
      ? {
          ...common,
          colorsampling: 0,
          numberofcolors: 2,
          pal: [
            { r: 0, g: 0, b: 0, a: 255 },
            { r: 255, g: 255, b: 255, a: 255 },
          ],
        }
      : { ...common, colorsampling: 2, numberofcolors: colors + 1, colorquantcycles: 3, mincolorratio: 0 };
  const raw = ImageTracer.imagedataToSVG(img, options);
  return stripBackground(raw);
}
