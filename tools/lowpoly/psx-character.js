// Puppet from the static "PSX Characters Pack" (Shazly, CC BY 4.0): the T-pose mesh is cut into head, torso, arms and legs by triangle position,
// and each part hangs on a joint, so the same pose() calls as the box character work. Stiff, cracking joints are the point.
import { THREE, loadGLB } from "./engine.js";

let packPromise = null;
const pack = () => (packPromise ??= loadGLB("/assets/psx_characters_pack.glb"));

// proportions (all optional): head/chest [x,y,z] scales, armLen/legLen multipliers, armThick
export const PSX_SHAPES = {
  normal: {},
  weird: { head: [1.7, 1.5, 1.6], headTilt: 0.25, chest: [1.45, 1.0, 1.5], armLen: 1.5, armThick: 1.35, legLen: 0.7, legThick: 0.85, hunch: 0.3 },
};

export async function makePsxCharacter({ index = 4, shape = {} } = {}) {
  const gltf = await pack(), meshes = []; gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const src = meshes[index]; src.updateWorldMatrix(true, false);
  const P = { head: [1, 1, 1], headTilt: 0, chest: [1, 1, 1], armLen: 1, armThick: 1, legLen: 1, legThick: 1, hunch: 0, ...shape };

  // bake world transform, feet on y=0, 1.8 m tall, centred; the pack is Z-up in cm with a rotated root node
  let g = src.geometry.clone(); if (g.index) g = g.toNonIndexed(); g.applyMatrix4(src.matrixWorld); g.computeBoundingBox();
  const bb = g.boundingBox, k = 1.8 / (bb.max.y - bb.min.y); g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); g.scale(k, k, k);
  const pos = g.attributes.position, tris = pos.count / 3;
  const HIP = 0.88, NECK = 1.5, SHOULDER = 1.42, SHX = 0.2;
  const buckets = { head: [], torso: [], armL: [], armR: [], legL: [], legR: [] };
  for (let t = 0; t < tris; t++) {
    let cx = 0, cy = 0; for (let v = 0; v < 3; v++) { cx += pos.getX(t * 3 + v) / 3; cy += pos.getY(t * 3 + v) / 3; }
    const part = cy < HIP ? (cx < 0 ? "legL" : "legR") : Math.abs(cx) > SHX && cy > 1.15 ? (cx < 0 ? "armL" : "armR") : cy > NECK ? "head" : "torso";
    buckets[part].push(t);
  }
  const mat = new THREE.MeshLambertMaterial({ map: src.material.map, flatShading: true });
  const partMesh = (name, origin) => {
    const idx = buckets[name], out = new THREE.BufferGeometry();
    for (const attr of ["position", "normal", "uv"]) { const a = g.attributes[attr]; if (!a) continue; const arr = new Float32Array(idx.length * 3 * a.itemSize); idx.forEach((t, i) => { for (let v = 0; v < 3; v++) for (let c = 0; c < a.itemSize; c++) arr[(i * 3 + v) * a.itemSize + c] = a.array[(t * 3 + v) * a.itemSize + c]; }); out.setAttribute(attr, new THREE.BufferAttribute(arr, a.itemSize)); }
    out.translate(-origin[0], -origin[1], -origin[2]); return new THREE.Mesh(out, mat);
  };

  const ch = {}; ch.root = new THREE.Group(); ch.tilt = new THREE.Group(); ch.root.add(ch.tilt);
  const legY = HIP * P.legLen; // shorter legs lower the whole upper body
  const mkLeg = (name, x) => { const piv = new THREE.Group(); piv.position.set(x, legY, 0); const m = partMesh(name, [x, HIP, 0]); m.scale.set(P.legThick, P.legLen, P.legThick); piv.add(m); ch.tilt.add(piv); return piv; };
  ch.legL = mkLeg("legL", -0.1); ch.legR = mkLeg("legR", 0.1);
  ch.torso = new THREE.Group(); ch.torso.position.y = legY; ch.tilt.add(ch.torso); ch.torso.userData.hunch = P.hunch;
  const body = partMesh("torso", [0, HIP, 0]); body.scale.set(...P.chest); ch.torso.add(body);
  const topY = (NECK - HIP) * P.chest[1]; // where the neck sits on the (scaled) torso
  ch.neck = new THREE.Group(); ch.neck.position.y = topY; ch.neck.userData.base = P.headTilt; ch.torso.add(ch.neck);
  const head = partMesh("head", [0, NECK, 0]); head.scale.set(...P.head); ch.neck.add(head);
  const mkArm = (name, side) => { // pivot at the shoulder; the child is turned from T-pose to hanging
    const piv = new THREE.Group(); piv.position.set(side * SHX * P.chest[0], (SHOULDER - HIP) * P.chest[1], 0);
    const rest = new THREE.Group(); rest.rotation.z = -side * Math.PI / 2; piv.add(rest);
    const m = partMesh(name, [side * SHX, SHOULDER, 0]); m.scale.set(P.armLen, P.armThick, P.armThick); rest.add(m); ch.torso.add(piv); return piv;
  };
  ch.armL = mkArm("armL", -1); ch.armR = mkArm("armR", 1);
  ch.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })); ch.shadow.rotation.x = -Math.PI / 2; ch.shadow.position.y = 0.02;
  ch.setFace = () => {};
  ch.pose = (mode, phase = 0) => { // same vocabulary as the box Character
    for (const j of [ch.legL, ch.legR, ch.armL, ch.armR]) j.rotation.set(0, 0, 0);
    ch.neck.rotation.set(0, 0, ch.neck.userData.base ?? 0); ch.torso.rotation.set(ch.torso.userData.hunch ?? 0, 0, 0);
    const w = Math.sin(phase), tx = ch.torso.rotation.x;
    if (mode === "walk") { ch.legL.rotation.x = w * 0.7; ch.legR.rotation.x = -w * 0.7; ch.armL.rotation.x = -w * 0.5; ch.armR.rotation.x = w * 0.5; ch.torso.rotation.z = w * 0.04; }
    if (mode === "carryUp") { ch.legL.rotation.x = w * 0.5; ch.legR.rotation.x = -w * 0.5; ch.armL.rotation.x = ch.armR.rotation.x = -Math.PI + 0.15; ch.torso.rotation.x = tx - 0.12; }
    if (mode === "carryFront") { ch.legL.rotation.x = w * 0.5; ch.legR.rotation.x = -w * 0.5; ch.armL.rotation.x = ch.armR.rotation.x = -1.2; ch.torso.rotation.x = tx + 0.1; }
    if (mode === "push") { ch.legL.rotation.x = w * 0.5; ch.legR.rotation.x = -w * 0.5; ch.armL.rotation.x = ch.armR.rotation.x = -1.35; ch.torso.rotation.x = tx + 0.35; }
    if (mode === "lookUp") { ch.neck.rotation.x = -0.7 - 0.05 * w; ch.armL.rotation.z = 0.5; ch.armR.rotation.z = -0.5; }
    if (mode === "shrug") { ch.armL.rotation.z = 0.9; ch.armR.rotation.z = -0.9; ch.neck.rotation.x = -0.3; }
    if (mode === "jump") { ch.legL.rotation.x = -0.6; ch.legR.rotation.x = 0.4; ch.armL.rotation.x = ch.armR.rotation.x = -2.6; }
    if (mode === "ragdoll") { ch.armL.rotation.set(-0.4, 0, 1.2); ch.armR.rotation.set(-0.2, 0, -1.2); ch.legL.rotation.x = 0.4; ch.legR.rotation.x = -0.3; }
    if (mode === "scratch") { ch.armR.rotation.x = -2.6 + 0.25 * Math.sin(phase * 3); ch.armR.rotation.z = -0.35; ch.neck.rotation.z = 0.12; ch.neck.rotation.x = 0.1; }
  };
  return ch;
}
