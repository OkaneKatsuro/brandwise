// The Styles page's server side: the styles a creative can be generated in and the style packs, over RPC. What a style is, what a
// pack may hold and when its styles count live in packages/core/src/styles; this file declares the contract, adds to each style
// the pack it is of and the command that generates from it, calls the core and says when the packs changed.
import { z } from "zod";
import type { Core } from "./core/index.ts";
import { packOf, STYLE_KINDS, type Style } from "./core/styles/domain.ts";
import { generateCommand } from "./style-cli.ts";

/** Who did it, as a pack records it: a person on the page, as for an approval on the Calendar page. */
const ACTOR = "ui";

const texts = z.record(z.string(), z.string());
const style = z.object({
  id: z.string(), title: z.string(), kind: z.enum(STYLE_KINDS), aspects: z.array(z.string()), channels: z.array(z.string()), slots: texts, prompt: z.string(),
  models: texts.optional(), params: texts.optional(), version: z.number(), use: z.string(), copy: z.string(), avoid: z.string(),
  /** The pack the style is of; null for a built-in style. */
  pack: z.string().nullable(),
  /** The command line that generates a creative in the style. */
  command: z.string(),
});
const pack = z.object({
  name: z.string(), source: z.string(), revision: z.string().nullable(), author: z.string(), licence: z.string(), digest: z.string(), styles: z.array(z.string()),
  installedAt: z.string(), installedBy: z.string(), enabledAt: z.string().nullable(), enabledBy: z.string().nullable(),
});
const review = z.object({ pack, styles: z.array(style) });
const named = z.object({ name: z.string() });
export type StyleView = z.infer<typeof style>;
export type PackView = z.infer<typeof pack>;
export type PackReviewView = z.infer<typeof review>;

export const stylesContract = {
  /** The styles that can be used now, of a kind and for a channel (null: any): the built-in ones, then those of the packs that are on. */
  styles_list: { input: z.object({ kind: z.enum(STYLE_KINDS).nullable(), channel: z.string().nullable() }), output: z.object({ styles: z.array(style) }) },
  /** Every pack, switched on or not. */
  styles_packs: { input: z.null(), output: z.object({ packs: z.array(pack) }) },
  /** A pack as it is stored, for the person who decides about it: every style in full and the digest of that text. */
  styles_review: { input: named, output: review },
  /** Add a pack from the full path of a folder or the https address of a git repository. It is checked whole and arrives off. */
  styles_add: { input: z.object({ source: z.string().trim().min(1).max(2000) }), output: pack.extend({ replaced: z.boolean() }) },
  /** Switch a pack on. `digest` is the one of the review the person read: a pack that was added again since is refused. */
  styles_enable: { input: named.extend({ digest: z.string() }), output: pack },
  styles_disable: { input: named, output: pack },
  styles_remove: { input: named, output: z.object({ removed: z.string() }) },
};
type In<K extends keyof typeof stylesContract> = z.infer<(typeof stylesContract)[K]["input"]>;

export function createStylesRpc(deps: { need: () => Core; changed: () => void }) {
  const view = (s: Style): StyleView => ({ ...s, pack: packOf(s.id), command: generateCommand(s) });
  /** A write to the packs that went through: every open Styles page hears of it. */
  const written = <T>(out: T): T => {
    deps.changed();
    return out;
  };
  return {
    styles_list: async ({ kind, channel }: In<"styles_list">) => ({ styles: (await deps.need().styles.list({ kind: kind ?? undefined, channel: channel ?? undefined })).map(view) }),
    styles_packs: async () => ({ packs: await deps.need().styles.packs() }),
    styles_review: async ({ name }: In<"styles_review">): Promise<PackReviewView> => {
      const { pack: stored, styles } = await deps.need().styles.review(name);
      return { pack: stored, styles: styles.map(view) };
    },
    styles_add: async ({ source }: In<"styles_add">) => written(await deps.need().styles.addPack(source, ACTOR)),
    styles_enable: async ({ name, digest }: In<"styles_enable">) => written(await deps.need().styles.enablePack(name, ACTOR, digest)),
    styles_disable: async ({ name }: In<"styles_disable">) => written(await deps.need().styles.disablePack(name)),
    styles_remove: async ({ name }: In<"styles_remove">) => {
      await deps.need().styles.removePack(name);
      return written({ removed: name });
    },
  };
}
