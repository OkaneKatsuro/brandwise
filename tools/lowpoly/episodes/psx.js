// Viewer: the five characters of the PSX Characters Pack (Shazly, CC BY 4.0) side by side, to check size, facing and textures.
import { THREE, makeStage, mat, mesh, textures } from "../engine.js";
export const meta = { width: 1280, height: 720, fps: 30 };
export async function build() {
  const st = makeStage({ width: meta.width, height: meta.height, pixel: 2 });
  const { scene, camera } = st;
  const ground = mesh(new THREE.PlaneGeometry(60, 60), mat(0xffffff, textures.concrete([14, 14]))); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const { makePsxCharacter, PSX_SHAPES } = await import("../psx-character.js");
  const men = [];
  for (const [shape, z, index] of [["normal", 1.6, 4], ["weird", -0.6, 4], ["weird", -2.8, 2]]) { const c = await makePsxCharacter({ index, shape: PSX_SHAPES[shape] }); c.root.position.set(0, 0, z); c.shadow.position.set(0, 0.02, z); c.root.rotation.y = -Math.PI / 2; men.push({ c }); scene.add(c.root, c.shadow); }
  function update(t) { men.forEach(({ c }, i) => c.pose(t > 1.5 ? "walk" : "idle", t * 6 + i)); camera.fov = 40; camera.updateProjectionMatrix(); camera.position.set(-6.2, 1.5, -0.6); camera.lookAt(0, 0.95, -0.6); st.present(); }
  return { st, update, duration: 3, marks: {} };
}
