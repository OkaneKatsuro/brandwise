// CLI of the style library: `bb brandwise style list|show`. Read-only. The styles and their rules live in packages/core/src/styles;
// this file parses arguments and prints.
import type { Core } from "./core/index.ts";
import type { Style } from "./core/styles/index.ts";

type Io = { val: (argv: string[], name: string) => string | undefined; positional: (argv: string[]) => string[]; reply: (value: unknown, text: string) => { exitCode: number; stdout: string }; usage: string };

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

/** `bb brandwise style list [--kind image|video] [--channel <c>] | show <id>` */
export async function styleCli(c: Core, action: string | undefined, args: string[], { val, positional, reply, usage }: Io) {
  if (action === "list") {
    const styles = await c.styles.list({ kind: val(args, "--kind"), channel: val(args, "--channel") });
    const width = Math.max(20, ...styles.map((s) => s.id.length));
    return reply(styles, styles.map((s) => summary(s, width)).join("\n") || "No style matches. bb brandwise style list shows them all.");
  }
  if (action === "show") {
    const id = positional(args.slice(2))[0];
    if (!id) return { exitCode: 1, stderr: usage };
    const style = await c.styles.byId(id);
    return reply(style, describe(style));
  }
  return { exitCode: 1, stderr: usage };
}
