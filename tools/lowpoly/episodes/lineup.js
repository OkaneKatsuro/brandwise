// Character lineup: the same man with different body shapes side by side, wobbling in an idle, for choosing a model.
import { THREE, Character, SHAPES, makeStage, mat, mesh, textures, seg } from "../engine.js";
export const meta = { width: 1280, height: 720, fps: 30 };
export function build() {
  const st = makeStage({ width: meta.width, height: meta.height, pixel: 2 });
  const { scene, camera } = st;
  const ground = mesh(new THREE.PlaneGeometry(60, 60), mat(0xffffff, textures.concrete([14, 14]))); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const names = ["normal", "bigHead", "combo", "extreme"], men = names.map((n, i) => {
    const m = new Character({ shape: SHAPES[n], seed: 11 + i }); m.root.position.set(0, 0, (1.5 - i) * 2.7); m.root.rotation.y = -Math.PI / 2; scene.add(m.root, m.shadow); m.shadow.position.set(0, 0.02, (1.5 - i) * 2.7); return m;
  });
  const duration = 6;
  function update(t) {
    men.forEach((m, i) => { m.root.rotation.y = -Math.PI / 2 + 0.55 * Math.sin(t * 0.9 + i * 1.3); m.pose(i % 2 ? "idle" : "idle", t * 4); m.armL.rotation.x = 0.12 * Math.sin(t * 2.2 + i); m.armR.rotation.x = -0.12 * Math.sin(t * 2.2 + i); });
    if (t < 3) { camera.fov = 40; camera.position.set(-10.5, 2.4, 0); camera.lookAt(0, 1.7, 0); } // wide lineup
    else { camera.fov = 40; camera.position.set(-6.2, 1.5, -2.7); camera.lookAt(0, 1.3, -2.7); }                                  // close-up on the two weirdest
    camera.updateProjectionMatrix();
    st.present();
  }
  return { st, update, duration, marks: {} };
}
