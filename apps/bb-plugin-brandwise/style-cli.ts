// CLI of the style library: `bb brandwise style list|show` for the styles and `style packs|add|review|enable|disable|remove` for
// the style packs. The styles, the packs and their rules live in packages/core/src/styles; this file parses arguments and prints.
// Agents read styles; a person adds a pack, reads what was stored (`style review`) and switches on that text by its digest
// (`style enable`), as skills/creative-styles tells the agents.
import type { Core } from "./core/index.ts";
import type { InstalledPack, Style } from "./core/styles/index.ts";

type Io = { val: (argv: string[], name: string) => string | undefined; positional: (argv: string[]) => string[]; reply: (value: unknown, text: string) => { exitCode: number; stdout: string }; usage: string; actor: (argv: string[]) => string };

/** One style among others: enough to choose by goal and channel. */
const summary = (s: Style, width: number) => `${s.id.padEnd(width)} ${s.kind.padEnd(6)} ${s.aspects.join(", ").padEnd(21)} ${s.channels.join(", ")}\n    ${s.title}. ${s.use}`;

/** Everything needed to use a style: when it fits, what to fill in, the post text that goes with it and what to avoid. */
const describe = (s: Style) => {
  const models = Object.entries(s.models ?? {}).map(([provider, model]) => `${model} on ${provider}`);
  return [
    `${s.id}  ${s.title}  (${s.kind}, version ${s.version})`,
    `Use: ${s.use}`,
    `Aspects: ${s.aspects.map((a, i) => (i === 0 ? `${a} (default)` : a)).join(", ")}`,
    `Channels: ${s.channels.join(", ")}`,
    `Model: ${models.length > 0 ? `${models.join(", ")}; any other provider needs --model <id>` : "none named, give --model <id>"}`,
    ...(s.params ? [`Parameters: ${Object.entries(s.params).map(([name, value]) => `${name}=${value}`).join(", ")}`] : []),
    "Slots (fill every one):",
    ...Object.entries(s.slots).map(([name, holds]) => `  ${name}: ${holds}`),
    `Post text: ${s.copy}`,
    `Avoid: ${s.avoid}`,
    `Template (code fills it from the slots; never copy it into --prompt): ${s.prompt}`,
    `Generate: bb brandwise creative generate --style ${s.id} ${Object.keys(s.slots).map((name) => `--slot ${name}="..."`).join(" ")} --campaign <c>`,
  ].join("\n");
};

/** Where a pack came from: the folder, or the repository and the commit that was stored. */
const origin = (p: InstalledPack) => `${p.source}${p.revision ? ` at commit ${p.revision.slice(0, 12)}` : ""}`;

/**
 * One pack: whether its styles can be used and who said so, whose it is and where it came from, then its styles. Author and
 * licence are the pack's own words about itself, so they are quoted: nothing in them can pass for ours.
 */
const packLines = (p: InstalledPack) => [
  `${p.name}  ${p.enabledAt ? `on since ${p.enabledAt.slice(0, 16)} by ${p.enabledBy}` : "off"}`,
  `    by ${JSON.stringify(p.author)}, licence ${JSON.stringify(p.licence)}; from ${origin(p)}, added ${p.installedAt.slice(0, 16)} by ${p.installedBy}`,
  `    digest ${p.digest}`,
  `    ${p.styles.join(", ")}`,
].join("\n");

/** `bb brandwise style list [--kind image|video] [--channel <c>] | show <id> | packs | add <folder | https git address> | review <pack> | enable <pack> --digest <digest> | disable <pack> | remove <pack>` */
export async function styleCli(c: Core, action: string | undefined, args: string[], { val, positional, reply, usage, actor }: Io) {
  if (action === "list") {
    const styles = await c.styles.list({ kind: val(args, "--kind"), channel: val(args, "--channel") });
    const width = Math.max(20, ...styles.map((s) => s.id.length));
    return reply(styles, styles.map((s) => summary(s, width)).join("\n") || "No style matches. bb brandwise style list shows them all.");
  }
  if (action === "packs") {
    const packs = await c.styles.packs();
    return reply(packs, packs.map(packLines).join("\n") || "No style packs. A person adds one with: bb brandwise style add <folder | https git address>");
  }
  const [name] = positional(args.slice(2));
  if (!name) return { exitCode: 1, stderr: usage };
  if (action === "show") {
    const style = await c.styles.byId(name);
    return reply(style, describe(style));
  }
  if (action === "add") {
    const pack = await c.styles.addPack(name, actor(args));
    return reply(pack, `${pack.replaced ? "Replaced" : "Added"} pack ${pack.name}: ${pack.styles.join(", ")}\nIt is off: its styles are not listed and cannot be used. A person reads what was stored with: bb brandwise style review ${pack.name}`);
  }
  if (action === "review") {
    const { pack, styles } = await c.styles.review(name);
    const next = pack.enabledAt ? "" : `\n\nThis is the text that would become prompts. If it is what you want, switch on exactly this text: bb brandwise style enable ${pack.name} --digest ${pack.digest}`;
    return reply({ pack, styles }, `${packLines(pack)}\n\n${styles.map(describe).join("\n\n")}${next}`);
  }
  if (action === "enable") {
    const digest = val(args, "--digest");
    if (digest === undefined) return { exitCode: 1, stderr: `Give --digest <digest>: read the pack first with bb brandwise style review ${name}, which shows its styles and the digest of that text` };
    const pack = await c.styles.enablePack(name, actor(args), digest);
    return reply(pack, `Pack ${pack.name} is on since ${pack.enabledAt?.slice(0, 16)} by ${pack.enabledBy}: ${pack.styles.join(", ")}`);
  }
  if (action === "disable") {
    const pack = await c.styles.disablePack(name);
    return reply(pack, `Pack ${pack.name} is off: its styles are not listed and cannot be used`);
  }
  if (action === "remove") {
    await c.styles.removePack(name);
    return reply({ removed: name }, `Removed pack ${name} and its styles`);
  }
  return { exitCode: 1, stderr: usage };
}
