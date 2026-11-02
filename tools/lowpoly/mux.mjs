// Adds narration and word-by-word captions to a rendered episode.
// Usage: node mux.mjs <episode> <audio-dir>   (audio-dir holds 1.mp3, 2.mp3 ... one file per narration line)
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const [ep, audioDir] = process.argv.slice(2);
if (!ep || !audioDir) { console.error("usage: node mux.mjs <episode> <audio-dir>"); process.exit(2); }
const out = join(root, "out", ep), info = JSON.parse(readFileSync(join(out, "info.json"), "utf8"));
const nar = JSON.parse(readFileSync(join(root, "episodes", `${ep}.narration.json`), "utf8"));
const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` };
const dur = (f) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { env }).stdout.toString());
const ts = (t) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;

const starts = nar.lines.map((l) => l.at ?? info.marks[l.mark] + (l.offset ?? 0));
const events = [`Dialogue: 0,${ts(0.2)},${ts(2.4)},Title,,,${nar.title}`];
const files = nar.lines.map((_, i) => join(audioDir, `${i + 1}.mp3`));
nar.lines.forEach((l, i) => { // word timing is estimated from character counts, not aligned
  const d = dur(files[i]), words = l.text.split(" "), w = words.map((x) => x.replace(/[.,!]/g, "").length + 1), tot = w.reduce((a, b) => a + b, 0);
  let t = starts[i];
  words.forEach((x, j) => { const e = t + (d * w[j]) / tot; events.push(`Dialogue: 0,${ts(t)},${ts(e)},Cap,,,{\\pos(360,1000)}${x}`); t = e; });
});
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${info.w}
PlayResY: ${info.h}

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Cap,Arial Black,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,7,2,5,40,40,0,1
Style: Title,Arial Black,64,&H0000E0FF,&H0000E0FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,6,2,8,40,40,150,1

[Events]
Format: Layer,Start,End,Style,Name,Effect,Text
${events.join("\n")}
`;
writeFileSync(join(out, "captions.ass"), ass);
const inputs = ["-i", join(out, `${ep}-silent.mp4`), ...files.flatMap((f) => ["-i", f])];
const delays = starts.map((s, i) => `[${i + 1}:a]adelay=${Math.round(s * 1000)}|${Math.round(s * 1000)},volume=1.6[a${i}]`).join(";");
const fc = `[0:v]subtitles=${join(out, "captions.ass")}[v];${delays};${starts.map((_, i) => `[a${i}]`).join("")}amix=inputs=${starts.length}:normalize=0[aout]`;
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[aout]", "-t", String(info.duration), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", join(out, `${ep}.mp4`)], { stdio: "inherit", env });
console.log(r.status === 0 ? `wrote ${join(out, `${ep}.mp4`)}` : "ffmpeg failed");
