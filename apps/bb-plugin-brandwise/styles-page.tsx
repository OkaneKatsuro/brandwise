// The Styles page: the styles a creative can be generated in, as cards, and the style packs in the page's sidebar (docs/styles.md).
// A pack is somebody else's text that becomes prompts, so this is where a person reads it: a pack opens as a review of what is
// stored, and "Switch on" sends the digest of the text that review showed. What a style is, what a pack may hold and when its
// styles count is decided in packages/core/src/styles; this file shows them. Every word of a pack is a stranger's: it is rendered
// as text, never as markup.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactNode } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { PackReviewView, PackView, StyleView } from "./styles";
import { CopyBlock } from "@/components/copy-block";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CHANNELS, ConfirmButton } from "./calendar";
import { Facts, Note, Placeholder } from "./map-page";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const stamp = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** A pack's own words about itself, quoted as `bb brandwise style packs` quotes them: nothing in them can pass for ours. */
const quoted = (text: string) => JSON.stringify(text);
/** Since when a pack is on and who switched it on; null for a pack that is off. */
const onSince = (p: PackView) => (p.enabledAt === null ? null : `since ${stamp(p.enabledAt)} by ${p.enabledBy}`);

const KIND: Record<StyleView["kind"], string> = { image: "Image", video: "Video" };
const SELECT = "h-8 max-w-64 rounded-md border border-input bg-background px-2 text-sm";
const DIALOG = "max-h-[90vh] w-[96vw] max-w-3xl overflow-y-auto";
const NOTICE = "rounded-md border border-border p-3 text-sm";

// --- state shared by the page and its sidebar (two separate React trees in bb's slots) ---

/** The pack whose review is open on the page; the sidebar opens it. */
let openPackName: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const useOpenPack = () => useSyncExternalStore(subscribe, () => openPackName);
function openPack(name: string | null) {
  openPackName = name;
  listeners.forEach((l) => l());
}

// --- a style ---

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

/** A style in full, as `bb brandwise style show` has it. `usable` is false for a style of a pack that is not on. */
function StyleFull({ style, usable }: { style: StyleView; usable: boolean }) {
  const models = Object.entries(style.models ?? {}).map(([provider, model]) => `${model} on ${provider}`);
  const params = Object.entries(style.params ?? {}).map(([name, value]) => `${name}=${value}`);
  return (
    <div className="space-y-4">
      <p className="break-words text-sm">{style.use}</p>
      <Facts rows={[
        ["Kind", KIND[style.kind]],
        ["Aspects", style.aspects.map((aspect, i) => (i === 0 ? `${aspect} (default)` : aspect)).join(", ")],
        ["Channels", style.channels.join(", ")],
        ["Model", models.length > 0 ? `${models.join(", ")}; any other provider needs --model <id>` : "None named: give --model <id>"],
        ["Parameters", params.length > 0 ? params.join(", ") : "None"],
        ["Version", style.version],
        ["From", style.pack === null ? "Built-in" : `Pack ${style.pack}`],
      ]} />
      <Section title="Slots (fill every one)">
        <dl className="divide-y divide-border rounded-md border border-border text-sm">
          {Object.entries(style.slots).map(([name, holds]) => (
            <div key={name} className="grid grid-cols-[8rem_1fr] gap-x-3 px-2.5 py-1.5">
              <dt className="break-words font-mono text-xs leading-5">{name}</dt>
              <dd className="min-w-0 break-words">{holds}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Post text"><p className="break-words text-sm">{style.copy}</p></Section>
      <Section title="Avoid"><p className="break-words text-sm">{style.avoid}</p></Section>
      <Section title="Template">
        <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed">{style.prompt}</pre>
        <Note>Code fills the template from the slots. Never copy it into <code>--prompt</code>.</Note>
      </Section>
      <CopyBlock label="Generate" text={style.command} note={usable ? "Put a value in every slot and name the campaign." : "Works once the pack is switched on."} />
    </div>
  );
}

/** One style among the others: enough to choose by goal and channel; a click opens it in full. */
function StyleCard({ style, onOpen }: { style: StyleView; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition hover:border-foreground/30 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex w-full items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" title={style.title}>{style.title}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground" title={style.id}>{style.id}</span>
        </span>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">{KIND[style.kind]}</span>
      </span>
      <span className="line-clamp-4 break-words text-sm text-muted-foreground">{style.use}</span>
      <span className="mt-auto pt-1 text-xs text-muted-foreground">
        <span className="block truncate">{style.aspects.join(" · ")}</span>
        <span className="line-clamp-2">{style.channels.join(", ")}</span>
      </span>
    </button>
  );
}

// --- a pack, read before it is switched on ---

/**
 * A pack as it is stored, opened from the sidebar: every style in full and, at the end of the text, the switch. The text on the
 * screen is the one read when the review opened, and it stays until the person asks for another: when the pack is added again
 * meanwhile the page says so, and never puts other text above the same button. "Switch on" sends the digest of the text on the
 * screen, so the core switches on what was read or refuses.
 */
function PackDialog() {
  const rpc = useRpc<typeof rpcContract>();
  const name = useOpenPack();
  /** The text on the screen, and the pack as it is stored now: the same until the pack is added again. */
  const [read, setRead] = useState<PackReviewView | null>(null);
  const [stored, setStored] = useState<PackReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  // the answer about a pack the user has since closed must not show under another pack's name
  const wanted = useRef(name);
  wanted.current = name;

  /** Reads what is stored now. `show` puts that text on the screen, from its top; without it only the comparison is renewed. */
  const load = useCallback((show: boolean) => {
    const pack = wanted.current;
    if (pack === null) return Promise.resolve();
    return rpc.call("styles_review", { name: pack }).then((review) => {
      if (wanted.current !== pack) return;
      setStored(review);
      if (!show) return;
      setRead(review);
      content.current?.scrollTo({ top: 0 });
    }, (cause) => {
      if (wanted.current !== pack) return;
      setRead(null);
      setStored(null);
      setError(message(cause));
    });
  }, [rpc]);
  useEffect(() => {
    setRead(null);
    setStored(null);
    setError(null);
    void load(true);
  }, [name, load]);
  // server.ts publishes after every write to the packs (page, CLI or agent): what is stored is compared again, the text stays
  const compare = useCallback(() => void load(false), [load]);
  useRealtime("styles-changed", compare);

  const act = (call: Promise<unknown>, refused: (cause: unknown) => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    void call.then(() => load(false), refused).finally(() => setBusy(false));
  };
  const switchOn = ({ name: pack, digest }: PackView) =>
    // refused: the pack was added again since this text was read, so the new text is shown, to be read before another try
    act(rpc.call("styles_enable", { name: pack, digest }), (cause) => {
      setError(message(cause));
      return load(true);
    });
  const switchOff = (pack: string) => act(rpc.call("styles_disable", { name: pack }), (cause) => setError(message(cause)));

  let body: ReactNode = null;
  if (read !== null && stored !== null) {
    const pack = stored.pack;
    const since = onSince(pack);
    const stale = pack.digest !== read.pack.digest;
    const usable = since !== null && !stale;
    const addedAgain = (
      <div role="status" className={cn(NOTICE, "space-y-2 text-warning-text")}>
        <p>This pack was added again after you opened it. The text shown here is the earlier one: it is no longer stored and cannot be switched on.</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => { setError(null); void load(true); }}>Read the new text</Button>
      </div>
    );
    body = (
      <>
        <Facts rows={[
          ["Author", quoted(pack.author)],
          ["Licence", quoted(pack.licence)],
          ["Source", <span className="break-all">{pack.source}</span>],
          ["Revision", pack.revision === null ? "None: read from a folder" : <span className="break-all font-mono text-xs">{pack.revision}</span>],
          ["Added", `${stamp(pack.installedAt)} by ${pack.installedBy}`],
          ["State", since === null ? <span className="text-warning-text">Off</span> : <span className="text-success">On {since}</span>],
        ]} />
        {stale ? addedAgain : since === null ? (
          <p role="status" className={cn(NOTICE, "border-dashed border-foreground/40")}>
            <strong className="font-medium">Not yet usable.</strong> This is the text that would become prompts: {plural(read.styles.length, "style")}, in full. Read each one; if it is what you want, switch on exactly this text at the end.
          </p>
        ) : (
          <p role="status" className={NOTICE}>This pack is on: its styles are listed and can be used. Switched off, they are no longer listed; creatives made in them keep their record.</p>
        )}
        {read.styles.map((style) => (
          <section key={style.id} className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-sm font-semibold">{style.title}</h3>
                <p className="break-all font-mono text-xs text-muted-foreground">{style.id}</p>
              </div>
              {usable ? null : <span className="shrink-0 rounded-full border border-dashed border-foreground/40 px-2 py-0.5 text-[11px] font-medium text-warning-text">Not yet usable</span>}
            </div>
            <StyleFull style={style} usable={usable} />
          </section>
        ))}
        <div className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Digest of this text</h3>
          <p className="break-all font-mono text-xs">{read.pack.digest}</p>
        </div>
        {stale ? addedAgain : since === null ? (
          <div><Button disabled={busy} onClick={() => switchOn(read.pack)}>Switch on this text</Button></div>
        ) : (
          <div><Button variant="outline" disabled={busy} onClick={() => switchOff(pack.name)}>Switch off</Button></div>
        )}
      </>
    );
  }
  return (
    <Dialog open={name !== null} onOpenChange={(open) => !open && openPack(null)}>
      <DialogContent ref={content} className={DIALOG}>
        <DialogTitle className="pr-6 leading-snug">Style pack {name}</DialogTitle>
        <DialogDescription>Styles written outside this project. What a pack says becomes prompts, so its styles count only after a person has read them and switched the pack on.</DialogDescription>
        {error === null ? null : <pre role="alert" className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 p-3 font-sans text-sm text-destructive">{error}</pre>}
        {body ?? (error === null ? <p className="text-sm text-muted-foreground">Reading the pack…</p> : null)}
      </DialogContent>
    </Dialog>
  );
}

// --- the page and its sidebar ---

export function StylesPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [kind, setKind] = useState<StyleView["kind"] | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [styles, setStyles] = useState<StyleView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // the answer for a filter the user has since changed must not replace the styles of the one that is set
  const filter = `${kind}/${channel}`;
  const wanted = useRef(filter);
  wanted.current = filter;

  const refetch = useCallback(() => {
    rpc.call("styles_list", { kind, channel }).then((r) => {
      if (wanted.current !== filter) return;
      setStyles(r.styles);
      setError(null);
    }, (cause) => setError(message(cause)));
  }, [rpc, kind, channel, filter]);
  useEffect(refetch, [refetch]);
  // server.ts publishes after every write to the packs (page, CLI or agent): a pack switched on or off changes which styles there are
  useRealtime("styles-changed", refetch);

  // a style that is no longer listed (its pack was switched off) closes
  const open = styles?.find((s) => s.id === openId) ?? null;
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="mr-1 text-base font-semibold">Styles</h1>
        <select className={SELECT} value={kind ?? ""} onChange={(e) => setKind(e.target.value === "" ? null : (e.target.value as StyleView["kind"]))} aria-label="Filter by kind">
          <option value="">All kinds</option>
          {Object.entries(KIND).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select className={SELECT} value={channel ?? ""} onChange={(e) => setChannel(e.target.value === "" ? null : e.target.value)} aria-label="Filter by channel">
          <option value="">All channels</option>
          {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{styles === null ? (error === null ? "Loading…" : null) : plural(styles.length, "style")}</span>
      </header>
      {error === null ? null : <p role="alert" className="border-b border-border px-4 py-2 text-sm text-destructive">{error}</p>}
      {styles === null ? null : styles.length === 0 ? (
        <Placeholder>
          <span>No style is made for this kind and channel. Choose another, or press Start agent in the side panel: the agent proposes a new style when none fits.</span>
        </Placeholder>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
            {styles.map((style) => <StyleCard key={style.id} style={style} onOpen={() => setOpenId(style.id)} />)}
          </div>
        </div>
      )}
      <Dialog open={open !== null} onOpenChange={(isOpen) => !isOpen && setOpenId(null)}>
        <DialogContent className={DIALOG}>
          {open === null ? null : (
            <>
              <div className="space-y-1 pr-6">
                <DialogTitle className="leading-snug">{open.title}</DialogTitle>
                <p className="break-all font-mono text-xs text-muted-foreground">{open.id}</p>
              </div>
              <DialogDescription className="sr-only">The style in full</DialogDescription>
              <StyleFull style={open} usable />
            </>
          )}
        </DialogContent>
      </Dialog>
      <PackDialog />
    </div>
  );
}

/**
 * The style packs, in the page's sidebar: each with where it came from and whether it is on, the field that adds one, and the way
 * into a pack's review. A pack is never switched on from here: that button stands at the end of the text it switches on.
 */
export function StylesSidebar() {
  const rpc = useRpc<typeof rpcContract>();
  const [packs, setPacks] = useState<PackView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [adding, setAdding] = useState(false);
  /** What the last add was answered with: the pack that arrived, or why it was refused, as the core's check lists it. */
  const [answer, setAnswer] = useState<{ refused: boolean; text: string } | null>(null);
  const report = useCallback((cause: unknown) => setError(message(cause)), []);
  const refetch = useCallback(() => {
    rpc.call("styles_packs").then((r) => {
      setPacks(r.packs);
      setError(null);
    }, report);
  }, [rpc, report]);
  useEffect(refetch, [refetch]);
  // server.ts publishes after every write to the packs (page, CLI or agent), so the list never goes stale
  useRealtime("styles-changed", refetch);

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAdding(true);
    setAnswer(null);
    try {
      const pack = await rpc.call("styles_add", { source });
      setSource("");
      setAnswer({ refused: false, text: `${pack.replaced ? "Replaced" : "Added"} ${pack.name}. It is off until you have read it and switched it on.` });
      refetch();
      openPack(pack.name);
    } catch (cause) {
      setAnswer({ refused: true, text: message(cause) });
    } finally {
      setAdding(false);
    }
  };

  return (
    <nav aria-label="Style packs" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2 text-sm">
      <h2 className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Style packs
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">{packs?.length ?? 0}</span>
      </h2>
      <form onSubmit={add} className="flex flex-col gap-1.5">
        <Input className="h-8" value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://… or /full/path/of/a/folder" aria-label="Where the pack is: an https git address or the full path of a folder" spellCheck={false} />
        <Button type="submit" size="sm" disabled={adding || source.trim() === ""}>{adding ? "Checking the pack…" : "Add pack"}</Button>
      </form>
      {answer === null ? (
        <p className="px-1 text-xs text-muted-foreground">The https address of a pack's git repository, or the full path of its folder on the machine BrandWise runs on. The pack is checked whole and arrives switched off.</p>
      ) : answer.refused ? (
        <pre role="alert" className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 p-2 font-sans text-xs text-destructive">{answer.text}</pre>
      ) : (
        <p role="status" className="px-1 text-xs text-muted-foreground">{answer.text}</p>
      )}
      {error === null ? null : <p role="alert" className="px-1 text-xs text-destructive">{error}</p>}
      {packs === null ? (
        error === null ? <p className="px-1 text-xs text-muted-foreground">Loading…</p> : null
      ) : packs.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          No packs yet: the styles on the page are the built-in ones. Add a pack above, or with <code>bb brandwise style add</code>. To write one, start from <code>examples/style-pack/README.md</code>.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {packs.map((p) => {
            const since = onSince(p);
            return (
              <li key={p.name} className={cn("rounded-lg border bg-card p-2", since === null ? "border-dashed border-foreground/40" : "border-border")}>
                <button
                  type="button"
                  onClick={() => openPack(p.name)}
                  className="block w-full min-w-0 rounded text-left text-xs text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{p.name}</span>
                    <span className={cn("shrink-0 text-xs", since === null ? "text-warning-text" : "text-success")}>{since === null ? "Off" : "On"}</span>
                  </span>
                  <span className="block break-words">by {quoted(p.author)}, licence {quoted(p.licence)}</span>
                  <span className="block break-all">from {p.source}{p.revision === null ? "" : ` at commit ${p.revision.slice(0, 12)}`}</span>
                  <span className="block">added {stamp(p.installedAt)} by {p.installedBy}</span>
                  <span className="block">{since === null ? "off: not usable until you have read it" : `on ${since}`} · {plural(p.styles.length, "style")}</span>
                </button>
                <div className="mt-2 flex gap-1.5">
                  {since === null ? (
                    <Button size="sm" className="flex-1" onClick={() => openPack(p.name)}>Review…</Button>
                  ) : (
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => rpc.call("styles_disable", { name: p.name }).then(refetch, report)}>Switch off</Button>
                  )}
                  <ConfirmButton label="Remove" onConfirm={() => rpc.call("styles_remove", { name: p.name }).then(refetch, report)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
