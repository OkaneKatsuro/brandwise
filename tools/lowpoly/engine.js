// Low-poly film engine (browser module). An episode is a pure function of time: update(t) places everything.
// Look: flat-shaded boxes, nearest-filtered procedural textures, rendered small and scaled up with hard pixels.
import * as THREE from "three";
export { THREE };

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const seg = (t, a, b) => clamp01((t - a) / (b - a)); // progress of t inside [a, b]
export const lerp = (a, b, u) => a + (b - a) * u;
export const smooth = (u) => u * u * (3 - 2 * u);
export const arc = (u, h) => 4 * h * u * (1 - u); // 0 -> h -> 0

// 1 px = 1 texel, drawn with a seeded rng so every render is identical
let s = 12345;
export const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

export function canvasTex(size, paint, repeat = [1, 1]) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const speckle = (g, n, size, colors) => { for (let i = 0; i < n; i++) { g.fillStyle = colors[Math.floor(rnd() * colors.length)]; g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 1, 1); } };

export const textures = {
  concrete: (rep = [14, 14]) => canvasTex(64, (g, z) => {
    g.fillStyle = "#8b8b84"; g.fillRect(0, 0, z, z); speckle(g, 500, z, ["#7a7a74", "#9a9a92", "#6f6f6a"]);
    g.strokeStyle = "#4a4a46"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 20); g.lineTo(22, 26); g.lineTo(40, 22); g.lineTo(64, 40); g.moveTo(30, 0); g.lineTo(34, 30); g.lineTo(28, 64); g.stroke();
  }, rep),
  brick: (rep = [3, 2]) => canvasTex(64, (g, z) => {
    g.fillStyle = "#cdbf94"; g.fillRect(0, 0, z, z); g.fillStyle = "#8f866a";
    for (let y = 0; y < z; y += 8) { g.fillRect(0, y, z, 1); for (let x = (y / 8) % 2 ? 0 : 8; x < z; x += 16) g.fillRect(x, y, 1, 8); }
    speckle(g, 200, z, ["#bfb184", "#d8cba0"]);
  }, rep),
  crate: () => canvasTex(32, (g, z) => {
    g.fillStyle = "#8a5a2b"; g.fillRect(0, 0, z, z); g.strokeStyle = "#4e3016"; g.lineWidth = 2; g.strokeRect(1, 1, z - 2, z - 2);
    g.beginPath(); g.moveTo(2, 2); g.lineTo(z - 2, z - 2); g.moveTo(z - 2, 2); g.lineTo(2, z - 2); g.stroke(); speckle(g, 60, z, ["#9c6a37", "#6d4521"]);
  }),
  barrel: (c1, c2) => canvasTex(32, (g, z) => { g.fillStyle = c1; g.fillRect(0, 0, z, z); g.fillStyle = c2; g.fillRect(0, 12, z, 8); speckle(g, 80, z, ["#00000030", "#ffffff20"]); }),
  stone: () => canvasTex(32, (g, z) => { g.fillStyle = "#77777a"; g.fillRect(0, 0, z, z); speckle(g, 150, z, ["#66666a", "#8a8a8e", "#58585c"]); }),
  fence: () => canvasTex(16, (g, z) => { g.clearRect(0, 0, z, z); g.strokeStyle = "#66707a"; g.lineWidth = 1; g.beginPath(); for (let i = -z; i < z * 2; i += 4) { g.moveTo(i, 0); g.lineTo(i + z, z); g.moveTo(i + z, 0); g.lineTo(i, z); } g.stroke(); }, [60, 6]),
  cloud: () => canvasTex(64, (g, z) => { g.clearRect(0, 0, z, z); g.fillStyle = "#ffffff"; for (const [x, y, w, h] of [[8, 30, 48, 12], [16, 22, 30, 12], [30, 18, 22, 14], [12, 38, 40, 8]]) g.fillRect(x, y, w, h); g.fillStyle = "#c8e4f0"; g.fillRect(10, 40, 44, 3); }),
};

// faces: skin base, brows, eyes, mouth and stubble, one canvas per expression (drawn 1 px at a time, nearest filtered)
Object.assign(textures, {
face: (expr) => canvasTex(32, (g, z) => {
  g.fillStyle = "#e3b08f"; g.fillRect(0, 0, z, z); speckle(g, 26, z, ["#c99577", "#d4a085"]);
  for (let i = 0; i < 40; i++) { g.fillStyle = "#8a6a58"; g.fillRect(6 + Math.floor(rnd() * 20), 22 + Math.floor(rnd() * 8), 1, 1); } // stubble
  g.fillStyle = "#3a2a22"; // brows
  if (expr === "strain") { g.fillRect(5, 9, 8, 2); g.fillRect(19, 9, 8, 2); g.fillRect(11, 11, 2, 1); g.fillRect(19, 11, 2, 1); }
  else if (expr === "yell") { g.fillRect(5, 6, 8, 1); g.fillRect(19, 6, 8, 1); }
  else { g.fillRect(5, 8, 8, 1); g.fillRect(19, 8, 8, 1); }
  g.fillStyle = "#fff"; g.fillRect(6, 11, 7, 5); g.fillRect(19, 11, 7, 5); g.fillStyle = "#111"; // eyes
  if (expr === "dazed") { for (const x of [7, 20]) { g.fillRect(x, 12, 1, 1); g.fillRect(x + 2, 12, 1, 1); g.fillRect(x + 1, 13, 1, 1); g.fillRect(x, 14, 1, 1); g.fillRect(x + 2, 14, 1, 1); } }
  else if (expr === "blank") { g.fillRect(8, 13, 2, 2); g.fillRect(21, 13, 2, 2); g.fillStyle = "#e3b08f"; g.fillRect(6, 11, 7, 2); g.fillRect(19, 11, 7, 2); }
  else { g.fillRect(expr === "up" ? 9 : 8, expr === "up" ? 11 : 13, 3, 3); g.fillRect(expr === "up" ? 22 : 21, expr === "up" ? 11 : 13, 3, 3); }
  g.fillStyle = "#6a1a1a"; // mouth
  if (expr === "yell") { g.fillRect(11, 21, 10, 7); g.fillStyle = "#fff"; g.fillRect(11, 21, 10, 2); }
  else if (expr === "strain") { g.fillStyle = "#fff"; g.fillRect(10, 22, 12, 4); g.fillStyle = "#222"; g.fillRect(10, 24, 12, 1); }
  else if (expr === "dazed") { g.fillRect(12, 23, 8, 3); }
  else g.fillRect(11, 24, 10, 1);
}),
knit: (base, line) => canvasTex(32, (g, z) => { g.fillStyle = base; g.fillRect(0, 0, z, z); g.fillStyle = line; for (let y = 0; y < z; y += 4) g.fillRect(0, y, z, 1); speckle(g, 80, z, ["#00000018", "#ffffff18"]); }),
sweaterFront: () => canvasTex(32, (g, z) => { g.fillStyle = "#d9a512"; g.fillRect(0, 0, z, z); g.fillStyle = "#b88a0c"; for (let y = 0; y < z; y += 4) g.fillRect(0, y, z, 1); g.fillStyle = "#7a5a08"; for (let i = 0; i < 6; i++) g.fillRect(10 + i, i, 12 - i * 2, 1); g.fillStyle = "#e8c860"; g.fillRect(4, 22, 6, 1); }),
sweaterBack: () => canvasTex(32, (g, z) => { g.fillStyle = "#d9a512"; g.fillRect(0, 0, z, z); g.fillStyle = "#b88a0c"; for (let y = 0; y < z; y += 4) g.fillRect(0, y, z, 1); g.fillStyle = "#5a1a1a"; g.fillRect(6, 8, 20, 10); g.fillStyle = "#f2d060"; for (const [x, y, w] of [[8, 10, 6], [16, 10, 8], [8, 14, 14]]) g.fillRect(x, y, w, 2); }),
pants: () => canvasTex(32, (g, z) => { g.fillStyle = "#5a3a22"; g.fillRect(0, 0, z, z); g.fillStyle = "#47301c"; for (let y = 0; y < z; y += 3) g.fillRect(0, y, z, 1); g.fillStyle = "#3a2616"; g.fillRect(2, 4, 7, 1); g.fillRect(2, 4, 1, 6); speckle(g, 60, z, ["#6a462a"]); }),
graffiti: () => canvasTex(64, (g, z) => { g.clearRect(0, 0, z, z); g.fillStyle = "#ff3cac"; g.fillRect(4, 14, 56, 16); g.fillStyle = "#ffe14d"; for (let i = 0; i < 5; i++) g.fillRect(6 + i * 11, 16, 8, 12); g.fillStyle = "#222"; g.fillRect(6, 34, 52, 2); g.fillStyle = "#3cf0ff"; g.fillRect(40, 38, 14, 10); g.fillRect(44, 34, 6, 20); }),
windows: () => canvasTex(32, (g, z) => { g.fillStyle = "#8a93a0"; g.fillRect(0, 0, z, z); for (let y = 2; y < z; y += 6) for (let x = 2; x < z; x += 6) { g.fillStyle = rnd() < 0.3 ? "#ffe8a0" : "#33414f"; g.fillRect(x, y, 3, 4); } }, [3, 8]),
skyGrad: () => canvasTex(32, (g, z) => { const gr = g.createLinearGradient(0, 0, 0, z); gr.addColorStop(0, "#0f9fe0"); gr.addColorStop(0.55, "#52cdf0"); gr.addColorStop(1, "#f6f0c8"); g.fillStyle = gr; g.fillRect(0, 0, z, z); }),
});
export const mat = (color, map) => new THREE.MeshLambertMaterial({ color, map, flatShading: true });
export const mesh = (geo, m) => new THREE.Mesh(geo, m);
export const box = (w, h, d, m) => mesh(new THREE.BoxGeometry(w, h, d), m);

// A limb is a pivot at its top joint with the mesh hanging below it.
function limb(parent, x, y, z, w, h, d, m) {
  const pivot = new THREE.Group(); pivot.position.set(x, y, z);
  const part = box(w, h, d, m); part.position.y = -h / 2; pivot.add(part); parent.add(pivot);
  return pivot;
}

// Blocky character built facing +z locally; root.position = feet, root.rotation.y = heading, tilt = pitch (falls) about the feet.
// Faces and clothes are nearest-filtered textures; setFace() swaps the expression. `shape` bends the proportions (all optional):
//   legLen legW  torsoH chestW chestD chestFrac waistW  head:[x,y,z] headTilt  neckLen  armLen armW  handS fingers  shoulderDy  bulge  hunch
export const SHAPES = {
  normal: {},
  bigHead: { head: [2.1, 2.0, 1.9], legLen: 1.15, legW: 0.14, chestW: 0.72, chestD: 0.5, torsoH: 0.8, armLen: 0.8, armW: 0.14, handS: 0.34, fingers: 4, bulge: 1 },
  combo: { head: [1.7, 1.45, 1.6], headTilt: 0.28, neckLen: 0.0, legLen: 0.62, legW: 0.15, torsoH: 1.15, chestW: 1.5, chestD: 0.95, chestFrac: 0.62, waistW: 0.42, armLen: 1.2, armW: 0.15, handS: 0.5, fingers: 7, shoulderDy: 0.2, bulge: 1, hunch: 0.35 },
  extreme: { head: [1.3, 2.3, 1.2], headTilt: -0.2, neckLen: 0.35, legLen: 0.5, legW: 0.1, torsoH: 1.5, chestW: 1.65, chestD: 1.1, chestFrac: 0.5, waistW: 0.3, armLen: 1.3, armW: 0.1, handS: 0.62, fingers: 9, shoulderDy: -0.28, bulge: 1, hunch: 0.5 },
};
export class Character {
  constructor({ skin = 0xe3b08f, shoes = 0x1e1e1e, shape = {}, seed = 7 } = {}) {
    const P = { legLen: 0.85, legW: 0.32, torsoH: 0.85, chestW: 0.98, chestD: 0.66, chestFrac: 1, waistW: null, head: [1, 1, 1], headTilt: 0, neckLen: 0, armLen: 0.62, armW: 0.22, handS: 0.2, fingers: 0, shoulderDy: 0, bulge: 0, hunch: 0, ...shape };
    P.waistW ??= P.chestW; this.P = P;
    let k = seed; const r = () => ((k = (k * 16807) % 2147483647) / 2147483647); // local rng: the same seed always grows the same hands
    this.root = new THREE.Group(); this.tilt = new THREE.Group(); this.root.add(this.tilt);
    const ms = mat(skin), black = mat(0x050505), gold = mat(0xe2b52a), sole = mat(0xd8d2c4), belt = mat(0x2a1a10), white = mat(0xf4f4f0);
    const sweater = mat(0xffffff, textures.knit("#d9a512", "#b88a0c")), front = mat(0xffffff, textures.sweaterFront()), back = mat(0xffffff, textures.sweaterBack());
    const trousers = mat(0xffffff, textures.pants()), boots = mat(shoes);
    this.faces = Object.fromEntries(["neutral", "up", "yell", "strain", "dazed", "blank"].map((x) => [x, mat(0xffffff, textures.face(x))]));
    const lx = Math.max(0.14, P.chestW * 0.25);
    this.legL = limb(this.tilt, -lx, P.legLen, 0, P.legW, P.legLen, P.legW + 0.02, trousers); this.legR = limb(this.tilt, lx, P.legLen, 0, P.legW, P.legLen, P.legW + 0.02, trousers);
    for (const l of [this.legL, this.legR]) { const fw = P.legW + 0.06, f = box(fw, 0.14, 0.52, boots); f.position.set(0, -P.legLen + 0.07, 0.08); const so = box(fw + 0.02, 0.05, 0.54, sole); so.position.set(0, -P.legLen, 0.08); l.add(f, so); }
    this.torso = new THREE.Group(); this.torso.position.y = P.legLen; this.tilt.add(this.torso); this.torso.userData.hunch = P.hunch;
    const upperH = P.torsoH * P.chestFrac, lowerH = P.torsoH - upperH;
    const chest = mesh(new THREE.BoxGeometry(P.chestW, upperH, P.chestD), [sweater, sweater, sweater, sweater, front, back]); chest.position.y = lowerH + upperH / 2; this.torso.add(chest);
    if (lowerH > 0.01) { const waist = box(P.waistW, lowerH, P.chestD * 0.6, sweater); waist.position.y = lowerH / 2; this.torso.add(waist); }
    const bellyBox = box(P.chestW * 0.92, upperH * 0.55, 0.3, front); bellyBox.position.set(0, lowerH + upperH * 0.3, P.chestD / 2 + 0.1); this.torso.add(bellyBox);
    const bl = box(P.waistW + 0.04, 0.09, P.chestD * 0.6 + 0.05, belt), bk = box(0.16, 0.12, 0.05, gold); bl.position.y = 0.04; bk.position.set(0, 0.04, P.chestD * 0.3 + 0.05); this.torso.add(bl, bk);
    this.neck = new THREE.Group(); this.neck.position.y = P.torsoH + P.neckLen * 0.5; this.torso.add(this.neck); this.neck.userData.base = P.headTilt;
    if (P.neckLen > 0) { const nk = box(0.22, P.neckLen + 0.1, 0.22, ms); nk.position.y = -P.neckLen * 0.25; this.neck.add(nk); }
    const [hx, hy, hz] = P.head;
    const collar = box(0.52 * Math.min(1.4, hx), 0.12, 0.42, sweater); collar.position.y = 0.03; this.neck.add(collar);
    this.head = mesh(new THREE.BoxGeometry(0.5 * hx, 0.5 * hy, 0.5 * hz), [ms, ms, ms, ms, this.faces.neutral, ms]); this.head.position.y = 0.05 + 0.25 * hy; this.neck.add(this.head);
    const nose = box(0.14 * hx, 0.2 * hy, 0.2 * hz, ms); nose.position.set(0, 0.05 + 0.22 * hy, 0.25 * hz + 0.09); this.neck.add(nose);
    for (const x of [-1, 1]) { const ear = box(0.07, 0.17 * hy, 0.12 * hz, ms); ear.position.set(x * (0.25 * hx + 0.04), 0.05 + 0.25 * hy, 0); this.neck.add(ear); }
    if (P.bulge) for (const [x, s] of [[-1, 1.5], [1, 0.8]]) { // one eye bigger than the other, both sticking out of the face
      const w = box(0.17 * hx * s, 0.17 * hy * s, 0.1, white), pu = box(0.07 * hx * s, 0.07 * hy * s, 0.04, black);
      w.position.set(x * 0.15 * hx, 0.05 + 0.34 * hy, 0.25 * hz + 0.05); pu.position.set(x * 0.15 * hx + 0.02 * x, 0.05 + 0.33 * hy, 0.25 * hz + 0.11); this.neck.add(w, pu);
    }
    for (let i = 0; i < 4; i++) { const c = box(0.05, 0.05, 0.04, gold); c.position.set((i - 1.5) * 0.09, P.torsoH - (i === 1 || i === 2 ? 0.1 : 0.02), P.chestD / 2 + 0.02); this.torso.add(c); }
    const sx = P.chestW / 2 + P.armW / 2 + 0.01, sy = P.torsoH - 0.07;
    this.armL = limb(this.torso, -sx, sy + P.shoulderDy, 0, P.armW, P.armLen, P.armW + 0.02, sweater); this.armR = limb(this.torso, sx, sy - P.shoulderDy, 0, P.armW, P.armLen * (P.shoulderDy ? 0.8 : 1), P.armW + 0.02, sweater);
    for (const a of [this.armL, this.armR]) {
      const len = a === this.armL ? P.armLen : P.armLen * (P.shoulderDy ? 0.8 : 1), hs = P.handS;
      const cuff = box(P.armW + 0.03, 0.08, P.armW + 0.05, mat(0x8a6a08)); cuff.position.y = -len + 0.04; a.add(cuff);
      const palm = box(hs, hs * 1.05, hs * 0.6, ms); palm.position.y = -len - hs * 0.5; a.add(palm);
      if (!P.fingers) { const th = box(0.06, 0.1, 0.08, ms); th.position.set(0, -len - hs * 0.5 + 0.04, hs * 0.38); a.add(th); continue; }
      for (let i = 0; i < P.fingers; i++) { // sausage fingers: random length, fan angle and a kink in the middle
        const u = P.fingers === 1 ? 0 : i / (P.fingers - 1) - 0.5, L = hs * (0.55 + r() * 1.1), fw = 0.05 + r() * 0.05;
        const fp = new THREE.Group(); fp.position.set(u * hs * 0.9, -len - hs, (r() - 0.5) * hs * 0.4); fp.rotation.set((r() - 0.5) * 0.5, 0, -u * 1.1 + (r() - 0.5) * 0.4);
        const s1 = box(fw, L, fw * 1.1, ms); s1.position.y = -L / 2; const mid = new THREE.Group(); mid.position.y = -L; mid.rotation.x = 0.4 + r() * 0.9; mid.rotation.z = (r() - 0.5) * 0.8;
        const s2 = box(fw * 0.9, L * 0.7, fw, ms); s2.position.y = -L * 0.35; mid.add(s2); fp.add(s1, mid); a.add(fp);
      }
    }
    this.shadow = mesh(new THREE.CircleGeometry(0.75, 8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.02;
  }
  setFace(x) { this.head.material[4] = this.faces[x] ?? this.faces.neutral; }
  // pose: reset joints, then apply a named mode
  pose(mode, phase = 0) {
    for (const j of [this.legL, this.legR, this.armL, this.armR, this.torso]) j.rotation.set(0, 0, 0);
    this.neck.rotation.set(0, 0, this.neck.userData.base ?? 0); this.torso.rotation.x = this.torso.userData.hunch ?? 0; // base lean from the body shape
    const w = Math.sin(phase), tx = this.torso.rotation.x;
    const face = { lookUp: "up", shrug: "blank", walk: "neutral", idle: "neutral", carryUp: "strain", carryFront: "strain", push: "strain", jump: "yell", ragdoll: "dazed", scratch: "blank" }[mode] ?? "neutral";
    this.setFace(face);
    if (mode === "walk") { this.legL.rotation.x = w * 0.7; this.legR.rotation.x = -w * 0.7; this.armL.rotation.x = -w * 0.5; this.armR.rotation.x = w * 0.5; this.torso.rotation.z = w * 0.04; }
    if (mode === "carryUp") { this.legL.rotation.x = w * 0.5; this.legR.rotation.x = -w * 0.5; this.armL.rotation.x = this.armR.rotation.x = -Math.PI + 0.15; this.torso.rotation.x = tx - 0.12; }
    if (mode === "carryFront") { this.legL.rotation.x = w * 0.5; this.legR.rotation.x = -w * 0.5; this.armL.rotation.x = this.armR.rotation.x = -1.2; this.torso.rotation.x = tx + 0.1; }
    if (mode === "push") { this.legL.rotation.x = w * 0.5; this.legR.rotation.x = -w * 0.5; this.armL.rotation.x = this.armR.rotation.x = -1.35; this.torso.rotation.x = tx + 0.35; }
    if (mode === "lookUp") { this.neck.rotation.x = -0.9 - 0.05 * w; this.armL.rotation.z = 0.5; this.armR.rotation.z = -0.5; }
    if (mode === "shrug") { this.armL.rotation.z = 0.9; this.armR.rotation.z = -0.9; this.neck.rotation.x = -0.3; }
    if (mode === "jump") { this.legL.rotation.x = -0.6; this.legR.rotation.x = 0.4; this.armL.rotation.x = this.armR.rotation.x = -2.6; }
    if (mode === "ragdoll") { this.armL.rotation.set(-0.4, 0, 1.2); this.armR.rotation.set(-0.2, 0, -1.2); this.legL.rotation.x = 0.4; this.legR.rotation.x = -0.3; }
    if (mode === "scratch") { this.armR.rotation.x = -2.6 + 0.25 * Math.sin(phase * 3); this.armR.rotation.z = -0.35; this.neck.rotation.z = 0.12; this.neck.rotation.x = 0.1; }
  }
}

// Scene bits shared by episodes
export function blobShadow(radius) {
  const m = mesh(new THREE.CircleGeometry(radius, 8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02; return m;
}

// Renders at low resolution, then copies to the output canvas with hard pixels (the cheap-console look).
export function makeStage({ width, height, pixel = 2.667, sky = 0x18c8f0 }) {
  const lowW = Math.round(width / pixel), lowH = Math.round(height / pixel);
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(lowW, lowH, false); renderer.setPixelRatio(1);
  const scene = new THREE.Scene(); scene.background = textures.skyGrad();
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200);
  scene.add(new THREE.AmbientLight(0xcfe0ff, 1.25)); const sun = new THREE.DirectionalLight(0xfff0cf, 1.7); sun.position.set(-6, 14, -8); scene.add(sun);
  const out = document.createElement("canvas"); out.width = width; out.height = height;
  const g = out.getContext("2d"); g.imageSmoothingEnabled = false;
  document.body.appendChild(out);
  return { THREE, renderer, scene, camera, out, present() {
    renderer.render(scene, camera);
    g.filter = "saturate(1.3) contrast(1.1) sepia(0.14)"; g.drawImage(renderer.domElement, 0, 0, width, height); g.filter = "none"; // warm, punchy console grade
    const v = g.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.78); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.38)"); g.fillStyle = v; g.fillRect(0, 0, width, height); // vignette
  } };
}

// Loads a .glb (served from this folder) and returns the scene graph; textures are switched to nearest filtering for the console look.
export async function loadGLB(url) {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.traverse((o) => { if (o.isMesh) { const m = o.material; for (const k of ["map", "emissiveMap"]) if (m[k]) { m[k].magFilter = m[k].minFilter = THREE.NearestFilter; m[k].generateMipmaps = false; } } });
  return gltf;
}
