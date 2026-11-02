// Episode: "How you invented stairs" in low-poly 3D. The whole film is update(t): no state, so any frame can be rendered alone.
import { THREE, makeStage, mat, mesh, box, textures, blobShadow, lerp, seg, smooth, arc } from "../engine.js";
import { makePsxCharacter, PSX_SHAPES } from "../psx-character.js";

export const meta = { width: 720, height: 1280, fps: 30 };

const H_ROOF = 5.35, STEPS = 6, STEP_H = H_ROOF / STEPS;
const stepZ = (k) => -3.5 + k; // step k = 1..6 centre along the wall

export async function build() {
  const st = makeStage({ width: meta.width, height: meta.height });
  const { scene, camera } = st;

  // ground, shed, props
  const ground = mesh(new THREE.PlaneGeometry(80, 80), mat(0xffffff, textures.concrete([16, 16]))); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const shed = box(6, 5, 10, mat(0xffffff, textures.brick([4, 3]))); shed.position.set(6, 2.5, 0); scene.add(shed);
  const roof = box(6.6, 0.35, 10.6, mat(0x8d8a80)); roof.position.set(6, 5.175, 0); scene.add(roof);
  const door = box(0.1, 3, 1.6, mat(0x555d66)); door.position.set(2.95, 1.5, -3); scene.add(door);
  const win = box(0.1, 1.1, 1.4, mat(0x1d2a3a)); win.position.set(2.95, 3.0, -0.4); scene.add(win);
  const fence = mesh(new THREE.PlaneGeometry(60, 3.2), new THREE.MeshBasicMaterial({ map: textures.fence(), transparent: true, side: THREE.DoubleSide })); fence.position.set(16, 1.6, 0); fence.rotation.y = Math.PI / 2; scene.add(fence);
  for (const [x, z] of [[1.0, 4.6], [-0.4, 6.4], [-1.5, 8.2]]) { const c = box(1.1, 1.1, 1.1, mat(0xffffff, textures.crate())); c.position.set(x, 0.55, z); c.rotation.y = x; scene.add(c); }
  for (const [x, z, c1, c2] of [[0.8, 5.4, "#2b5a8a", "#d9d9d9"], [1.4, 6.3, "#9a3b20", "#e0b030"], [-0.5, 7.4, "#2b5a8a", "#d9d9d9"]]) { const b = mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 8), mat(0xffffff, textures.barrel(c1, c2))); b.position.set(x, 0.6, z); scene.add(b); }
  for (const [x, y, z, w] of [[30, 16, -26, 14], [34, 20, 18, 18], [24, 13, 4, 10]]) { const c = mesh(new THREE.PlaneGeometry(w, w), new THREE.MeshBasicMaterial({ map: textures.cloud(), transparent: true })); c.position.set(x, y, z); c.lookAt(-12.5, 3.4, -4.5); scene.add(c); }

  // street dressing: graffiti on the shed, palms, a parked car, a hazy skyline behind the fence
  const gf = mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: textures.graffiti(), transparent: true })); gf.position.set(2.94, 2.2, 3.7); gf.rotation.y = -Math.PI / 2; scene.add(gf);
  for (const [x, z] of [[-4, -11], [13, 9], [-9, 12], [14, -8]]) {
    const trunk = mesh(new THREE.CylinderGeometry(0.25, 0.38, 6, 6), mat(0x7a5a38)); trunk.position.set(x, 3, z); scene.add(trunk);
    for (let i = 0; i < 6; i++) { const lf = box(3.4, 0.1, 0.8, mat(0x2f8a3a)); lf.position.set(x + Math.cos(i * 1.05) * 1.5, 6.0, z + Math.sin(i * 1.05) * 1.5); lf.rotation.y = -i * 1.05; lf.rotation.z = 0.35; scene.add(lf); }
  }
  const car = new THREE.Group(); car.position.set(-3.5, 0, -12.5); car.rotation.y = 0.5;
  const cb = box(4.4, 0.9, 1.95, mat(0xb5302a)); cb.position.y = 0.8; const cc = box(2.3, 0.8, 1.75, mat(0x23303c)); cc.position.set(-0.2, 1.6, 0); car.add(cb, cc);
  for (const [x, z] of [[-1.4, 1], [1.4, 1], [-1.4, -1], [1.4, -1]]) { const w = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8), mat(0x151515)); w.rotation.x = Math.PI / 2; w.position.set(x, 0.42, z); car.add(w); }
  scene.add(car);
  for (let i = 0; i < 12; i++) { const w = 4 + (i % 3) * 2, hh = 9 + ((i * 7) % 5) * 4, b = box(w, hh, 5, mat(0xffffff, textures.windows())); b.position.set(34 + (i % 2) * 6, hh / 2, -44 + i * 8); scene.add(b); }

  // the man
  const man = await makePsxCharacter({ index: 2, shape: PSX_SHAPES.weird }); scene.add(man.root, man.shadow); // PSX Characters Pack by Shazly, CC BY 4.0

  // boulders (5) and stair columns (6)
  const SPOTS = [[2.0, 0.85, 0], [2.0, 0.85, 1.7], [2.0, 0.85, -1.7], [2.0, 2.35, 0.85], [2.0, 2.35, -0.85]];
  const ROLL_TO = [[-3.5, 0.85, 3], [-1, 0.85, 5], [-0.5, 0.85, -4.5], [-5, 0.85, 0.5], [0, 0.85, 3.2]];
  const stone = mat(0xffffff, textures.stone());
  const boulders = SPOTS.map(() => { const b = mesh(new THREE.IcosahedronGeometry(0.85, 0), stone); const sh = blobShadow(0.9); scene.add(b, sh); return { b, sh }; });
  const cols = Array.from({ length: STEPS }, (_, i) => { const k = i + 1; const col = box(2, 1, 1, stone); const top = box(2.1, 0.3, 1.05, mat(0xa9a9ad)); scene.add(col, top); return { col, top, k }; });

  // ---- man timeline: segments chosen by time, each a function of its own progress u ----
  const segs = []; const marks = {};
  const S = (t0, t1, fn) => segs.push({ t0, t1, fn });
  let cur = { x: -3, z: 0, h: Math.PI / 2 };
  const heading = (dx, dz, fallback) => (dx === 0 && dz === 0 ? fallback : Math.atan2(dx, dz));
  const walk = (t0, t1, to, mode = "walk") => { const f = { ...cur }, h = heading(to.x - f.x, to.z - f.z, f.h), d = Math.hypot(to.x - f.x, to.z - f.z); S(t0, t1, (u) => ({ x: lerp(f.x, to.x, u), z: lerp(f.z, to.z, u), h, mode, phase: u * d * 2.6 })); cur = { x: to.x, z: to.z, h }; };
  const idle = (t0, t1, mode, h = cur.h) => { const f = { ...cur }; S(t0, t1, (u, t) => ({ x: f.x, z: f.z, h, mode, phase: t * 5 })); cur = { ...cur, h }; };

  let t = 0;
  idle(t, t += 1.3, "lookUp", Math.PI / 2); idle(t, t += 1.1, "shrug");
  marks.jump = t + 0.2; marks.walk = t;
  walk(t, t += 1.1, { x: 1.9, z: 0 });
  marks.jumpStart = t;
  S(t, t + 0.8, (u) => ({ x: lerp(1.9, 2.3, u), z: 0, y: arc(u, 1.1), h: Math.PI / 2, mode: "jump" })); t += 0.8;
  marks.slide = t;
  S(t, t + 0.8, (u) => ({ x: 2.3, z: 0, y: 0.6 * (1 - u), h: Math.PI / 2, mode: "ragdoll" })); t += 0.8;
  marks.fall = t;
  S(t, t + 0.7, (u) => ({ x: lerp(2.3, 1.2, u), z: 0, y: lerp(0, 0.4, u), tilt: -Math.PI / 2 * smooth(u), h: Math.PI / 2, mode: "ragdoll" })); t += 0.7;
  S(t, t + 1.1, () => ({ x: 1.2, z: 0, y: 0.4, tilt: -Math.PI / 2, h: Math.PI / 2, mode: "ragdoll" })); t += 1.1;
  marks.rise = t;
  S(t, t + 0.8, (u) => ({ x: 1.2, z: 0, y: lerp(0.4, 0, u), tilt: -Math.PI / 2 * (1 - smooth(u)), h: Math.PI / 2, mode: "idle" })); t += 0.8;
  cur = { x: 1.2, z: 0, h: Math.PI / 2 };

  // boulder 1: pushed in from the left
  const tPush0 = t + 0.7; walk(t, t += 0.7, { x: -2.95, z: 0 });
  marks.pile = t;
  const pushEnd = t + 1.8;
  S(t, pushEnd, (u) => ({ x: lerp(-2.95, 0.55, u), z: 0, h: Math.PI / 2, mode: "push", phase: u * 16 })); t = pushEnd; cur = { x: 0.55, z: 0, h: Math.PI / 2 };
  const carries = []; // { k, pick, drop }
  for (let k = 1; k < 5; k++) {
    const [sx, , sz] = SPOTS[k], c0 = t;
    walk(c0, c0 + 0.45, { x: -3.5, z: sz }); const pick = c0 + 0.45;
    walk(pick, pick + 0.9, { x: sx - 1.7, z: sz }, "carryUp"); const drop = pick + 0.9;
    idle(drop, drop + 0.4, "shrug", Math.PI / 2); carries.push({ k, pick, drop }); t = drop + 0.4;
  }
  // climb the pile, everything rolls away
  walk(t, t += 0.6, { x: 0.8, z: 0.85 }); marks.climb = t;
  const tJump = t, tTop = t + 0.7; S(tJump, tTop, (u) => ({ x: lerp(0.8, 1.7, u), z: 0.85, y: lerp(0, 3.2, u) + arc(u, 0.9), h: Math.PI / 2, mode: "jump" })); t = tTop;
  const tRoll = t + 0.5; S(t, tRoll, (u) => ({ x: 1.7, z: 0.85, y: 3.2, h: Math.PI / 2, mode: "ragdoll", wob: u })); t = tRoll; marks.roll = t;
  S(t, t + 0.9, (u) => ({ x: lerp(1.7, 0.4, u), z: lerp(0.85, 0.2, u), y: lerp(3.2, 0.4, u * u), tilt: -Math.PI / 2 * smooth(u), h: Math.PI / 2, mode: "ragdoll" })); const tRollEnd = t + 1.6; t += 0.9;
  marks.lie2 = t;
  S(t, t + 1.4, () => ({ x: 0.4, z: 0.2, y: 0.4, tilt: -Math.PI / 2, h: Math.PI / 2, mode: "ragdoll" })); t += 1.4;
  S(t, t + 0.8, (u) => ({ x: 0.4, z: 0.2, y: lerp(0.4, 0, u), tilt: -Math.PI / 2 * (1 - smooth(u)), h: Math.PI / 2, mode: "idle" })); t += 0.8;
  cur = { x: 0.4, z: 0.2, h: Math.PI / 2 };

  // stairs: carry a slab, place it, the column pops up under it
  marks.stairs = t;
  const places = []; // { k, pick, place }
  for (let k = 1; k <= STEPS; k++) {
    const c0 = t, z = stepZ(k);
    walk(c0, c0 + 0.35, { x: -3.5, z: -3.5 }); const pick = c0 + 0.35;
    walk(pick, pick + 0.55, { x: 0.3, z }, "carryFront"); const place = pick + 0.55;
    idle(place, place + 0.25, "shrug", Math.PI / 2); places.push({ k, pick, place }); t = place + 0.25;
  }
  // climb the stairs, step onto the roof
  marks.climbStairs = t;
  const stepY = (z) => { const f = Math.min(STEPS, Math.max(0, z + 3.0)), k = Math.floor(f), r = f - k; return Math.min(STEPS, k + smooth(Math.min(1, r / 0.3))) * STEP_H; };
  walk(t, t += 0.5, { x: 1.9, z: -3.4 });
  const zEnd = 2.5, tUp = t + 3.0;
  S(t, tUp, (u) => { const z = lerp(-3.4, zEnd, u); return { x: 1.9, z, y: stepY(z), h: Math.PI / 2 * 0 + 0, mode: "walk", phase: u * 36 }; }); t = tUp;
  S(t, t + 0.9, (u) => ({ x: lerp(1.9, 4.6, u), z: zEnd, y: H_ROOF, h: heading(1, 0, 0), mode: "walk", phase: u * 10 })); t += 0.9; marks.roof = t;
  const camH = Math.atan2(-12.5 - 4.6, -4.5 - zEnd);
  S(t, t + 0.7, (u) => ({ x: 4.6, z: zEnd, y: H_ROOF, h: lerp(heading(1, 0, 0), camH, smooth(u)), mode: "idle" })); t += 0.7;
  S(t, t + 3.0, (u, tt) => ({ x: 4.6, z: zEnd, y: H_ROOF, h: camH, mode: "scratch", phase: tt * 3 })); t += 3.0;
  const duration = t;
  void tPush0; void tRollEnd;

  const camTarget = new THREE.Vector3();
  function update(time) {
    // man
    let s = segs[0]; for (const g of segs) if (g.t0 <= time) s = g;
    const u = seg(time, s.t0, s.t1), p = s.fn(u, time);
    man.root.position.set(p.x, p.y ?? 0, p.z); man.root.rotation.y = p.h; man.tilt.rotation.x = p.tilt ?? 0;
    man.pose(p.mode, p.phase ?? 0);
    if (p.wob) { man.armL.rotation.x = Math.sin(time * 22) * 1.2 - 1; man.armR.rotation.x = Math.cos(time * 22) * 1.2 - 1; }
    man.shadow.position.set(p.x, 0.02, p.z); man.shadow.visible = (p.y ?? 0) < 1.0 || (p.tilt ?? 0) !== 0;

    // boulders
    boulders.forEach(({ b, sh }, i) => {
      const spot = SPOTS[i]; let pos = null, vis = true; const spin = [0, 0, 0];
      if (i === 0) {
        if (time < marks.pile - 0.7) vis = false;
        const uPush = seg(time, marks.pile, pushEnd); const x = lerp(-1.5, spot[0], uPush); pos = [x, 0.85, 0]; spin[2] = -x / 0.85;
      } else {
        const c = carries[i - 1];
        if (time < c.pick) vis = false;
        else if (time < c.drop) pos = [p.x, p.y + 2.2, p.z]; // overhead
        else { const d = seg(time, c.drop, c.drop + 0.3); pos = [lerp(p.x * 0 + (spot[0] - 1.7), spot[0], smooth(d)), lerp(2.2, spot[1], d * d), spot[2]]; if (time < c.drop + 0.3) pos[2] = spot[2]; }
      }
      if (vis && time >= marks.roll) { const r = seg(time, marks.roll, marks.roll + 1.6), e = 1 - (1 - r) * (1 - r); pos = [lerp(spot[0], ROLL_TO[i][0], e), 0.85 + arc(Math.min(1, r * 3), 0.5) * (r < 0.33 ? 1 : 0) + lerp(spot[1] - 0.85, 0, e), lerp(spot[2], ROLL_TO[i][2], e)]; spin[0] = e * 9; spin[2] = e * 7; }
      b.visible = sh.visible = vis; if (pos) { b.position.set(...pos); sh.position.set(pos[0], 0.02, pos[2]); sh.visible = vis && pos[1] < 1.5; }
      b.rotation.set(...spin);
    });

    // stair columns
    cols.forEach(({ col, top, k }, i) => {
      const pl = places[i], h = k * STEP_H, grow = seg(time, pl.place, pl.place + 0.25), z = stepZ(k);
      const carried = time >= pl.pick && time < pl.place;
      col.visible = grow > 0; top.visible = grow > 0 || carried;
      col.scale.set(1, Math.max(0.001, h * grow), 1); col.position.set(2.0, (h * grow) / 2, z);
      if (carried) top.position.set(p.x + 0.9, p.y + 1.1, p.z); else top.position.set(2.0, Math.max(0.15, h * grow - 0.15), z);
      col.scale.z = 1.0; col.scale.x = 1;
    });

    // camera: a shot list with hard cuts (tracking, low angle, top-down, orbit, crane) and shake on impacts
    const M = marks, T = time; let pos, tgt, fov = 50, roll = 0;
    if (T < M.walk) { const q = seg(T, 0, M.walk); pos = [lerp(-9.5, -7.2, q), lerp(0.7, 1.0, q), lerp(-4.2, -2.6, q)]; tgt = [1, lerp(3.6, 3.0, q), 0]; fov = lerp(58, 50, q); }       // low-angle dolly-in
    else if (T < M.jumpStart) { pos = [p.x - 0.5, 1.5, -7.5]; tgt = [p.x + 1.2, 1.6, 0]; fov = 46; }                                                                       // side tracking
    else if (T < M.slide + 0.9) { pos = [-6.5, 3.4, -8.5]; tgt = [2.5, 2.6, 0]; fov = 50; }                                                                                  // wide on the jump
    else if (T < M.rise) { const q = seg(T, M.slide + 0.9, M.rise); pos = [lerp(-3.2, -2.4, q), 0.55, -4.2]; tgt = [1.2, 0.5, 0]; fov = 62; }                                  // ground level
    else if (T < M.pile + 1.8) { pos = [p.x - 4.8, 2.0, -1.5]; tgt = [p.x + 3.5, 1.2, 0]; fov = 52; }                                                                        // behind him, pushing
    else if (T < M.climb) { const q = seg(T, M.pile + 1.8, M.climb); pos = [-9, 4.4, -8.2]; tgt = [1.5, 1.9, lerp(-1.2, 1.2, q)]; fov = 52; }                                  // slow pan, carrying
    else if (T < M.roll) { const q = seg(T, M.climb, M.roll); pos = [-3.2, 0.45, -3.6]; tgt = [2, lerp(1.5, 3.2, q), 0.85]; fov = 64; roll = 0.07; }                         // low angle up the pile
    else if (T < M.lie2) { pos = [-6.5, 3.8, -8]; tgt = [1.5, 1.8, 0.5]; fov = 54; }                                                                                        // wide on the avalanche
    else if (T < M.stairs) { pos = [-3, 9.5, -5]; tgt = [0.5, 0, 0]; fov = 55; }                                                                                              // top-down on the loser
    else if (T < M.climbStairs) { const q = seg(T, M.stairs, M.climbStairs), th = lerp(-0.9, -0.1, q); pos = [2 - 12.5 * Math.cos(th), 2.2 + q * 1.4, 12.5 * Math.sin(th)]; tgt = [2, 2.6, 0.2]; fov = 50; } // orbit while building
    else if (T < M.roof) { pos = [-6.8, p.y + 0.9, p.z - 4.2]; tgt = [2.2, p.y + 1.0, p.z + 0.9]; fov = 50; }                                                                 // follow up the stairs
    else { const q = seg(T, M.roof, duration); pos = [lerp(-8, -8.6, q), lerp(3.0, 2.6, q), lerp(-3.0, -3.6, q)]; tgt = [4.6, 6.4, 2.5]; fov = lerp(42, 32, q); roll = -0.04; } // hero shot from below, slow zoom
    let sx = 0, sy = 0; for (const [ti, amp] of [[M.slide, 0.28], [M.fall, 0.18], [M.roll, 0.4], [M.lie2 - 0.3, 0.12]]) if (T >= ti) { const k = amp * Math.exp(-(T - ti) * 5); sx += k * Math.sin(T * 61); sy += k * Math.cos(T * 53); }
    camera.fov = fov; camera.updateProjectionMatrix();
    camera.position.set(pos[0] + sx * 0.4, pos[1] + sy * 0.4, pos[2]); camTarget.set(tgt[0], tgt[1] + sy * 0.2, tgt[2]); camera.lookAt(camTarget); camera.rotateZ(roll + sx * 0.02);
    st.present();
  }
  return { st, update, duration, marks };
}
