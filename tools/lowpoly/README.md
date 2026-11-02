# lowpoly

A tiny 3D film engine for short comedy videos. An episode is a pure function of time (`update(t)` in `episodes/<name>.js`), so any frame can be rendered alone and the result is identical every run. No AI video model is involved, no credits are spent.

```
npm install --cache "$TMPDIR/npm-cache"                    # three.js
node render.mjs stairs --still 3,12,30                     # PNG stills in out/stairs/ (check framing first)
node render.mjs stairs                                     # all frames + silent MP4 (out/stairs/stairs-silent.mp4)
node mux.mjs stairs <audio-dir>                            # narration + word captions -> out/stairs/stairs.mp4
```

- `engine.js`: flat-shaded boxes, nearest-filtered procedural textures, a jointed `Character`, and a stage that renders small and scales up with hard pixels (the cheap-console look).
- `episodes/<name>.js`: exports `meta` and `build()`; `build()` returns `{ update(t), duration, marks }`. `marks` are named moments that the narration file (`episodes/<name>.narration.json`) refers to.
- `render.mjs`: static server + headless Chrome (the Chrome Headless Shell from `packages/video-remotion`, so run a Remotion render once first) driven over the DevTools protocol, WebGL through SwiftShader. Run it unsandboxed.
- `mux.mjs`: expects one `N.mp3` per narration line (for example from `higgsfield generate create text2speech_v2`). Word timing is estimated from character counts, not aligned.

Characters: `psx-character.js` cuts the static PSX Characters Pack (Shazly, CC BY 4.0, see `assets/ATTRIBUTION.md`) into head, torso, arms and legs and hangs them on joints; `PSX_SHAPES.weird` deforms them. `engine.js` also has a box `Character` with a textured face and `SHAPES` presets.

Known limits: stairs "pop" up as columns when a slab is placed (no physics), characters are blocky puppets with a handful of poses, and captions are not force-aligned to the voice.
