import {
  cssMatrix, translateQuad, pinchQuad, scaleQuadAbout, rotateQuadAbout, centroid, initialQuad,
} from './overlay-math.js';

const $ = (id) => document.getElementById(id);

// SVG de test : formes originales, sans rapport avec un dessin existant.
export const DEMO_SVG = `<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">
<path d="M20 380 C 200 120, 420 120, 780 60 L 780 140 C 480 190, 300 230, 20 450 Z" fill="rgb(255,106,61)"/>
<path d="M20 450 C 300 230, 480 190, 780 140 L 780 190 C 520 250, 320 300, 20 490 Z" fill="rgb(20,24,30)"/>
<circle cx="560" cy="330" r="90" fill="rgb(30,170,170)"/>
<circle cx="560" cy="330" r="50" fill="rgb(245,230,200)"/>
</svg>`;

// Rastérise un texte SVG dans un canvas (grand côté = longSide px).
export async function rasterizeSvg(svgText, longSide = 1000) {
  const rootMatch = svgText.match(/<svg\b([^>]*)>/i);
  if (!rootMatch) throw new Error("Ce fichier n'est pas un SVG valide");
  const attrs = rootMatch[1];
  const vb = attrs.match(/viewBox\s*=\s*"\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*"/i);
  const wAttr = attrs.match(/\swidth\s*=\s*"([\d.]+)/i);
  const hAttr = attrs.match(/\sheight\s*=\s*"([\d.]+)/i);
  let w;
  let h;
  let cleaned = attrs.replace(/\s(width|height)\s*=\s*"[^"]*"/gi, '');
  if (vb) {
    w = +vb[1];
    h = +vb[2];
  } else if (wAttr && hAttr) {
    w = +wAttr[1];
    h = +hAttr[1];
    cleaned += ` viewBox="0 0 ${w} ${h}"`;
  } else {
    throw new Error('SVG sans taille : il faut un viewBox ou width et height');
  }
  const k = longSide / Math.max(w, h);
  const cw = Math.max(2, Math.round(w * k));
  const ch = Math.max(2, Math.round(h * k));
  const sized = svgText.replace(rootMatch[0], `<svg${cleaned} width="${cw}" height="${ch}">`);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const im = new Image();
    await new Promise((res, rej) => {
      im.onload = res;
      im.onerror = () => rej(new Error('SVG illisible'));
      im.src = url;
    });
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    c.getContext('2d').drawImage(im, 0, 0, cw, ch);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rasterizeImageFile(file, longSide = 1000) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, longSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export function initOverlay() {
  const stage = $('ov-stage');
  const art = $('ov-art');
  const handles = [...stage.querySelectorAll('.handle')];
  const bgImg = $('ov-bg-img');
  const bgVideo = $('ov-bg-video');
  const placeholder = $('ov-placeholder');

  let nq = null; // quad normalisé (x/largeur, y/hauteur de la scène)
  let flip = false;
  let stream = null;
  const pointers = new Map();

  const size = () => {
    const r = stage.getBoundingClientRect();
    return { W: r.width, H: r.height, left: r.left, top: r.top };
  };
  const toPx = (q) => {
    const { W, H } = size();
    return q.map(([x, y]) => [x * W, y * H]);
  };
  const toNorm = (q) => {
    const { W, H } = size();
    return q.map(([x, y]) => [x / W, y / H]);
  };

  function render() {
    if (!nq || !art.width) return;
    const q = toPx(nq);
    try {
      art.style.transform = cssMatrix(q, art.width, art.height, flip);
    } catch {
      // coins alignés pendant un geste : on garde le dernier rendu
    }
    handles.forEach((h, i) => {
      h.style.left = q[i][0] + 'px';
      h.style.top = q[i][1] + 'px';
    });
  }

  function resetQuad() {
    if (!art.width) return;
    const { W, H } = size();
    nq = toNorm(initialQuad(art.width, art.height, W, H));
    flip = false;
    render();
  }

  function setDrawing(canvas) {
    art.width = canvas.width;
    art.height = canvas.height;
    art.style.width = canvas.width + 'px';
    art.style.height = canvas.height + 'px';
    art.getContext('2d').clearRect(0, 0, art.width, art.height);
    art.getContext('2d').drawImage(canvas, 0, 0);
    resetQuad();
  }

  // ----- Fond : photo ou caméra -----

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    bgVideo.srcObject = null;
    bgVideo.hidden = true;
  }

  async function setBackgroundFile(file) {
    if (!file) return;
    stopCamera();
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bgImg.src = c.toDataURL('image/jpeg', 0.9);
    bgImg.hidden = false;
    placeholder.hidden = true;
    stage.style.aspectRatio = `${c.width} / ${c.height}`;
    requestAnimationFrame(resetQuad);
  }

  async function startCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      alert("La caméra en direct demande une connexion HTTPS. En attendant, utilise « Photo du véhicule ».");
      return;
    }
    try {
      stopCamera();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      bgVideo.srcObject = stream;
      await bgVideo.play();
      bgImg.hidden = true;
      bgVideo.hidden = false;
      placeholder.hidden = true;
      stage.style.aspectRatio = `${bgVideo.videoWidth} / ${bgVideo.videoHeight}`;
      requestAnimationFrame(resetQuad);
    } catch (err) {
      alert('Caméra indisponible : ' + err.message);
    }
  }

  $('ov-photo').addEventListener('change', (e) => setBackgroundFile(e.target.files[0]));
  $('ov-gallery').addEventListener('change', (e) => setBackgroundFile(e.target.files[0]));
  $('ov-cam').addEventListener('click', startCamera);

  // ----- Import du dessin -----

  $('ov-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const isSvg = f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);
      setDrawing(isSvg ? await rasterizeSvg(await f.text()) : await rasterizeImageFile(f));
    } catch (err) {
      alert(err.message);
    }
  });
  $('ov-demo').addEventListener('click', async () => setDrawing(await rasterizeSvg(DEMO_SVG)));

  // ----- Réglages -----

  $('ov-opacity').addEventListener('input', (e) => {
    art.style.opacity = e.target.value / 100;
    $('ov-op-v').textContent = e.target.value;
  });
  $('ov-blend').addEventListener('change', (e) => (art.style.mixBlendMode = e.target.value));
  $('ov-flip').addEventListener('click', () => { flip = !flip; render(); });
  $('ov-reset').addEventListener('click', resetQuad);
  $('ov-handles').addEventListener('click', (e) => {
    const hidden = stage.classList.toggle('nohandles');
    e.target.textContent = hidden ? 'Afficher les points' : 'Masquer les points';
  });

  // ----- Gestes : coins individuels -----

  const stagePoint = (e) => {
    const { left, top } = size();
    return [e.clientX - left, e.clientY - top];
  };

  handles.forEach((h) => {
    const i = +h.dataset.i;
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      h.dataset.drag = '1';
    });
    h.addEventListener('pointermove', (e) => {
      if (!h.dataset.drag || !nq) return;
      const { W, H } = size();
      const [x, y] = stagePoint(e);
      nq[i] = [Math.min(Math.max(x / W, -0.3), 1.3), Math.min(Math.max(y / H, -0.3), 1.3)];
      render();
    });
    const end = () => delete h.dataset.drag;
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });

  // ----- Gestes : le dessin entier (1 doigt = déplacer, 2 doigts = taille et rotation) -----

  art.addEventListener('pointerdown', (e) => {
    art.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, stagePoint(e));
    art.style.cursor = 'grabbing';
  });
  art.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !nq) return;
    const prev = pointers.get(e.pointerId);
    const cur = stagePoint(e);
    let q = toPx(nq);
    if (pointers.size === 1) {
      q = translateQuad(q, cur[0] - prev[0], cur[1] - prev[1]);
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
      q = pinchQuad(q, prev, other, cur, other);
    }
    pointers.set(e.pointerId, cur);
    nq = toNorm(q);
    render();
  });
  const endArt = (e) => {
    pointers.delete(e.pointerId);
    art.style.cursor = 'grab';
  };
  art.addEventListener('pointerup', endArt);
  art.addEventListener('pointercancel', endArt);

  // Molette (test sur ordinateur) : zoom, et Maj + molette pour tourner.
  art.addEventListener('wheel', (e) => {
    if (!nq) return;
    e.preventDefault();
    const [cx, cy] = centroid(toPx(nq));
    const q = toPx(nq);
    nq = toNorm(e.shiftKey ? rotateQuadAbout(q, cx, cy, e.deltaY * 0.002) : scaleQuadAbout(q, cx, cy, Math.exp(-e.deltaY * 0.001)));
    render();
  }, { passive: false });

  // La scène change de taille (rotation du téléphone, redimensionnement) : on réaffiche.
  new ResizeObserver(render).observe(stage);

  return { setDrawing, rasterizeSvg };
}
