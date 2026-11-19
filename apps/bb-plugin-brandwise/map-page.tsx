// The Map page: one company on a board, from the sites its pack was read from to what its posts brought (docs/map.md). It only
// shows: code places the cards in columns, nothing is dragged, connected or run. What is on the map and which links are edges is
// decided in packages/core/src/map; this file places the cards, draws them and shows the details of the selected one.
import "@xyflow/react/dist/style.css";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Controls, Handle, Position, ReactFlow, ReactFlowProvider, useViewport, type Edge, type Node, type NodeProps, type OnInit } from "@xyflow/react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { chain, COLUMNS, type Column } from "./core/map/domain";
import { BASELINE_MEANING, VERDICT_MEANING, type Verdict } from "./core/metrics/virality";
import type { CompanyMapView, MapNodeView, PostDetailsView } from "./map";
import type { Campaign, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { CreativeMedia, Dot, EntryText, Thumb, openEntry, statusOf, useCreatives, whenOf } from "./calendar";

type NodeOf<C extends Column> = Extract<MapNodeView, { column: C }>;

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const dayOf = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const hostOf = (site: string) => site.replace(/^[a-z]+:\/\//, "");

const TITLE: Record<Column, string> = { source: "Sources", pack: "Context", campaign: "Campaigns", creative: "Creatives", post: "Posts", result: "Results" };
const KIND: Record<Campaign["kind"], string> = { always_on: "Company, always-on", campaign: "Campaign" };
const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  viral: { label: "Viral", tone: "text-success" },
  above: { label: "Above usual", tone: "text-success" },
  typical: { label: "Typical", tone: "text-foreground" },
  below: { label: "Below usual", tone: "text-warning-text" },
  unknown: { label: "Not judged", tone: "text-muted-foreground" },
};
/** How many times the account's usual views: "4.0× usual". */
const timesUsual = (ratio: number | null) => (ratio === null ? null : `${ratio.toFixed(1)}× usual`);
const numbersOf = (r: NodeOf<"result">) =>
  `${r.exposures === null ? "views unknown" : plural(r.exposures, "view")} · ${r.clicks === null ? "clicks unknown" : plural(r.clicks, "click")}`;
const leftOut = (hidden: NodeOf<"campaign">["hidden"]) =>
  [hidden.posts > 0 ? plural(hidden.posts, "older post") : null, hidden.creatives > 0 ? plural(hidden.creatives, "more creative") : null].filter(Boolean).join(", ");

// --- layout: the board's own pixels. Every card of a column has one size, so a column is a plain stack from the top ---

const CARD_W = 208, COLUMN_GAP = 72, ROW_GAP = 12, HINT_H = 112, MARGIN = 24;
const CARD_H: Record<Column, number> = { source: 60, pack: 80, campaign: 80, creative: 68, post: 68, result: 68 };
const BOARD_W = COLUMNS.length * CARD_W + (COLUMNS.length - 1) * COLUMN_GAP;
const MIN_ZOOM = 0.2;
/** The first look is never smaller than this, so that the cards can be read; in a narrow window the last columns are a scroll to the right. */
const FIRST_LOOK_MIN_ZOOM = 0.6;
const columnX = (column: Column) => COLUMNS.indexOf(column) * (CARD_W + COLUMN_GAP);
const rowY = (column: Column, row: number) => row * (CARD_H[column] + ROW_GAP);

/** What to do about a column that has nothing to show; the pack's column always has its card, so its hint stands under it. */
const HINT: Record<Exclude<Column, "campaign">, ReactNode> = {
  source: <>No site read yet. <code>bb brandwise research site &lt;url&gt;</code> reads the company's site for its pack.</>,
  pack: <>No pack yet. Read the site with <code>bb brandwise research site &lt;url&gt;</code>, or press Start agent in the side panel for the guided setup.</>,
  creative: <>No creatives yet. Generate one with <code>bb brandwise creative generate</code>, or upload on the Creatives page.</>,
  post: <>No posts yet. Add one on the Calendar page, or with <code>bb brandwise calendar add</code>.</>,
  result: <>No results yet. Numbers appear once a post is published and measured.</>,
};
type HintColumn = keyof typeof HINT;

type CardNode = Node<{ node: MapNodeView }, "card">;
type HintNode = Node<{ column: HintColumn }, "hint">;
type BoardNode = CardNode | HintNode;

/** The cards of a map where they stand: columns left to right, newest on top, a result beside its post, a hint where a column is empty. */
function boardNodes(map: CompanyMapView): BoardNode[] {
  const rowOfPost = new Map(map.nodes.flatMap((n) => (n.column === "post" ? [[n.entryId, n.order] as const] : [])));
  // "nopan": a press on a card is a click on it, not the start of a pan
  const cards = map.nodes.map((node): CardNode => ({
    id: node.id, type: "card", className: "nopan", width: CARD_W, height: CARD_H[node.column], data: { node },
    position: { x: columnX(node.column), y: rowY(node.column, node.column === "result" ? (rowOfPost.get(node.entryId) ?? node.order) : node.order) },
  }));
  const packIsEmpty = map.nodes.some((n) => n.column === "pack" && n.files.length === 0);
  const empty = (Object.keys(HINT) as HintColumn[]).filter((column) => (column === "pack" ? packIsEmpty : !map.nodes.some((n) => n.column === column)));
  const hints = empty.map((column): HintNode => ({
    id: `hint:${column}`, type: "hint", width: CARD_W, height: HINT_H, data: { column },
    position: { x: columnX(column), y: column === "pack" ? rowY("pack", 1) : 0 },
  }));
  return [...cards, ...hints];
}

/** What a selection lights up: the node, everything it came from and everything that came from it, and the edges between those. */
function litBy(map: CompanyMapView, id: string | null) {
  if (id === null) return null;
  const { upstream, downstream } = chain(map.nodes, map.edges, id);
  const before = new Set([id, ...upstream]), after = new Set([id, ...downstream]);
  return {
    node: (nodeId: string) => before.has(nodeId) || after.has(nodeId),
    edge: (e: { from: string; to: string }) => (before.has(e.from) && before.has(e.to)) || (after.has(e.from) && after.has(e.to)),
  };
}

/**
 * Edges run left to right. A campaign under another and a creative derived from another stand in the column of what they came
 * from, so those links are dashed brackets beside the column.
 */
function boardEdges(map: CompanyMapView, lit: ReturnType<typeof litBy>): Edge[] {
  const columnOf = new Map(map.nodes.map((n) => [n.id, n.column]));
  return map.edges.map((e) => {
    const sameColumn = columnOf.get(e.from) === columnOf.get(e.to), on = lit?.edge(e) ?? false;
    return {
      id: `${e.from}->${e.to}`, source: e.from, target: e.to, sourceHandle: sameColumn ? "down" : "out", targetHandle: "in",
      type: sameColumn ? "smoothstep" : "default", zIndex: on ? 1 : 0,
      style: { stroke: on ? "var(--foreground)" : "var(--muted-foreground)", strokeWidth: on ? 1.75 : 1, opacity: lit === null ? 0.5 : on ? 1 : 0.12, strokeDasharray: sameColumn ? "4 3" : undefined },
    };
  });
}

// --- cards ---

/** The selection, handed to the cards beside the board: the board's nodes then stay the same objects while the selection changes. */
const SelectionContext = createContext<{ selectedId: string | null; lit: ReturnType<typeof litBy> }>({ selectedId: null, lit: null });

function Lines({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium" title={title}>{title}</span>
      {children}
    </span>
  );
}
const Sub = ({ children, className }: { children: ReactNode; className?: string }) => <span className={cn("block truncate text-muted-foreground", className)}>{children}</span>;

function CardBody({ node }: { node: MapNodeView }) {
  switch (node.column) {
    case "source":
      return (
        <>
          <Icon name="Globe" fallback="FileText" className="size-4 shrink-0 text-muted-foreground" />
          <Lines title={hostOf(node.site)}><Sub>{plural(node.pages, "page")} · read {dayOf(node.readAt)}</Sub></Lines>
        </>
      );
    case "pack": {
      const confirmed = node.files.filter((f) => f.confirmed).length;
      return (
        <>
          <Icon name="FileText" className="size-4 shrink-0 text-muted-foreground" />
          <Lines title="Product pack">
            <Sub>{node.files.length === 0 ? "No files yet" : `${plural(node.files.length, "file")} · ${confirmed} confirmed`}</Sub>
            {node.missing.length > 0 ? <Sub className="text-warning-text">Missing {node.missing.length} of the five files</Sub> : null}
          </Lines>
        </>
      );
    }
    case "campaign": {
      const more = leftOut(node.hidden);
      return (
        <>
          <Icon name="brandwise/campaign" className="size-4 shrink-0 text-muted-foreground" />
          <Lines title={node.name}>
            <Sub>{KIND[node.kind]}</Sub>
            {more === "" ? null : <Sub>and {more}</Sub>}
          </Lines>
        </>
      );
    }
    case "creative":
      return (
        <>
          <Thumb src={node.thumb} />
          <Lines title={node.name}><Sub>{node.style ?? "No style"}{node.kind === "video" ? " · video" : ""}</Sub></Lines>
        </>
      );
    case "post":
      return (
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <Dot status={node.status} />
            <span className={cn("truncate", statusOf(node.status).tone)}>{statusOf(node.status).label}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">{node.channel}</span>
          </span>
          <span className="block truncate text-sm font-medium" title={node.title}>{node.title}</span>
          <Sub>{whenOf(node.scheduledAt)}</Sub>
        </span>
      );
    case "result":
      return (
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn("text-sm font-medium", VERDICT[node.verdict].tone)}>{VERDICT[node.verdict].label}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">{timesUsual(node.ratio)}</span>
          </span>
          <Sub>{numbersOf(node)}</Sub>
        </span>
      );
  }
}

/**
 * A card: a button, so it is reached and chosen with the keyboard as well; the board takes the click (`onNodeClick`). Its handles
 * are only where edges end ("down" for a link to a card of its own column); nothing can be connected to them.
 */
const Card = memo(function Card({ data: { node } }: NodeProps<CardNode>) {
  const { selectedId, lit } = useContext(SelectionContext);
  return (
    <>
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} className="opacity-0" />
      <Handle id="down" type="source" position={Position.Left} isConnectable={false} className="opacity-0" />
      <button
        type="button"
        aria-pressed={selectedId === node.id}
        className={cn(
          "flex size-full min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-border bg-card px-2.5 text-left text-xs transition-opacity hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
          selectedId === node.id && "ring-2 ring-ring",
          lit !== null && !lit.node(node.id) && "opacity-30",
        )}
      >
        <CardBody node={node} />
      </button>
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} className="opacity-0" />
    </>
  );
});

const Hint = memo(function Hint({ data: { column } }: NodeProps<HintNode>) {
  return (
    <p role="status" className="size-full overflow-hidden rounded-lg border border-dashed border-border p-2.5 text-xs text-muted-foreground">
      {HINT[column]}
    </p>
  );
});

const NODE_TYPES = { card: Card, hint: Hint };

/** The column names above the board. They follow the board sideways and stay put when it is scrolled down. */
function ColumnHeaders({ map }: { map: CompanyMapView }) {
  const { x, zoom } = useViewport();
  const hidden = map.nodes.reduce((sum, n) => (n.column === "campaign" ? { creatives: sum.creatives + n.hidden.creatives, posts: sum.posts + n.hidden.posts } : sum), { creatives: 0, posts: 0 });
  const more: Partial<Record<Column, string>> = {
    creative: hidden.creatives > 0 ? `and ${hidden.creatives.toLocaleString()} more` : undefined,
    post: hidden.posts > 0 ? `and ${hidden.posts.toLocaleString()} older` : undefined,
  };
  return (
    <div className="relative h-8 shrink-0 overflow-hidden border-b border-border text-xs text-muted-foreground">
      {COLUMNS.map((column) => (
        <div key={column} className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap" style={{ left: x + columnX(column) * zoom, width: CARD_W * zoom }}>
          <span className="font-medium uppercase tracking-wide">{TITLE[column]}</span>
          <span>{map.nodes.filter((n) => n.column === column).length}</span>
          {more[column] ? <span className="truncate">{more[column]}</span> : null}
        </div>
      ))}
    </div>
  );
}

// React Flow's own parts (the zoom buttons, the canvas) are drawn with the host's colours, so the board follows the theme like the rest of the page
const FLOW_THEME =
  "[--xy-background-color:transparent] [--xy-attribution-background-color:transparent] [--xy-controls-button-background-color:var(--card)] [--xy-controls-button-background-color-hover:var(--accent)] [--xy-controls-button-color:var(--foreground)] [--xy-controls-button-color-hover:var(--foreground)] [--xy-controls-button-border-color:var(--border)]";

function Board({ map, selectedId, onSelect }: { map: CompanyMapView; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const nodes = useMemo(() => boardNodes(map), [map]);
  const lit = useMemo(() => litBy(map, selectedId), [map, selectedId]);
  const edges = useMemo(() => boardEdges(map, lit), [map, lit]);
  const selection = useMemo(() => ({ selectedId, lit }), [selectedId, lit]);
  const frame = useRef<HTMLDivElement>(null);
  // the first look: the columns side by side, as large as fits and no larger than life, the newest rows at the top
  const showTop = useCallback<OnInit<BoardNode>>((flow) => {
    const width = frame.current?.clientWidth ?? 0;
    const zoom = Math.max(FIRST_LOOK_MIN_ZOOM, Math.min(1, width / (BOARD_W + 2 * MARGIN)));
    void flow.setViewport({ x: Math.max(MARGIN * zoom, (width - BOARD_W * zoom) / 2), y: MARGIN * zoom, zoom });
  }, []);
  return (
    <SelectionContext.Provider value={selection}>
      <ReactFlowProvider>
        <ColumnHeaders map={map} />
        <div ref={frame} className="min-h-0 flex-1">
          <ReactFlow
            className={FLOW_THEME}
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            deleteKeyCode={null}
            panOnScroll
            minZoom={MIN_ZOOM}
            maxZoom={1.5}
            onInit={showTop}
            // a handler here is also what makes React Flow pass clicks to nodes that can be neither dragged nor selected
            onNodeClick={(_, node) => node.type === "card" && onSelect(node.id === selectedId ? null : node.id)}
            onPaneClick={() => onSelect(null)}
            aria-label="Company map"
          >
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </ReactFlowProvider>
    </SelectionContext.Provider>
  );
}

// --- details of the selected card ---

export function Facts({ rows }: { rows: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PackFiles({ files }: { files: NodeOf<"pack">["files"] }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border text-sm">
      {files.map((f) => (
        <li key={f.name} className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">v{f.version}</span>
          <span className={cn("shrink-0 text-xs", f.confirmed ? "text-success" : "text-warning-text")}>{f.confirmed ? "confirmed" : "draft"}</span>
        </li>
      ))}
    </ul>
  );
}

export const Note = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;

function CreativeDetails({ node, campaign }: { node: NodeOf<"creative">; campaign: string }) {
  const creative = useCreatives([node.assetId])[node.assetId];
  return (
    <>
      {creative === undefined ? null : <CreativeMedia creative={creative} />}
      <Facts rows={[["Style", node.style ?? "None: not generated from a style"], ["Campaign", campaign]]} />
      {node.prompt === null ? <Note>No prompt on record: the creative was uploaded, or made before prompts were kept.</Note> : (
        <div className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prompt</h3>
          <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm">{node.prompt}</p>
        </div>
      )}
    </>
  );
}

/** A post's text and the pack it was written from; both are fetched when the post is opened, the map itself does not carry them. */
function PostDetails({ node, campaign }: { node: NodeOf<"post">; campaign: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [details, setDetails] = useState<PostDetailsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    rpc.call("map_post", { entryId: node.entryId }).then((d) => live && setDetails(d), (cause) => live && setError(message(cause)));
    return () => { live = false; };
  }, [rpc, node.entryId]);
  return (
    <>
      <Facts rows={[
        ["Status", <span className={statusOf(node.status).tone}>{statusOf(node.status).label}</span>],
        ["Channel", <span className="capitalize">{node.channel}</span>],
        ["When", whenOf(node.scheduledAt)],
        ["Campaign", campaign],
      ]} />
      {error !== null ? <p role="alert" className="text-sm text-destructive">{error}</p> : details === null ? <Note>Loading the text…</Note> : (
        <>
          <EntryText text={details.text} />
          <div className="space-y-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Written from this pack</h3>
            {details.pack.length === 0 ? <Note>The company had no pack when this entry was created.</Note> : <PackFiles files={details.pack} />}
            <Note>The versions in force when the entry was created; a file confirmed only later counts as the draft it was.</Note>
          </div>
        </>
      )}
    </>
  );
}

/** The selected card in the page's sidebar: what it is, what the map knows about it, and a way to where it lives. */
function Details({ node, map, onClose }: { node: MapNodeView; map: CompanyMapView; onClose: () => void }) {
  const nav = useBbNavigate();
  const campaignName = (id: string) => map.nodes.find((n): n is NodeOf<"campaign"> => n.column === "campaign" && n.campaignId === id)?.name ?? id;
  const postOf = (entryId: string) => map.nodes.find((n): n is NodeOf<"post"> => n.column === "post" && n.entryId === entryId);
  const inCalendar = (post: NodeOf<"post"> | undefined) => post && (
    <Button variant="outline" size="sm" onClick={() => { openEntry({ id: post.entryId, scheduledAt: post.scheduledAt }, "view", true); nav.toPluginPanel("calendar"); }}>Open in Calendar</Button>
  );
  const inCampaigns = (campaignId: string, label = "Open in Campaigns") => <Button variant="outline" size="sm" onClick={() => nav.toPluginPanel("campaigns", { subPath: campaignId })}>{label}</Button>;

  let title: string, body: ReactNode, link: ReactNode;
  switch (node.column) {
    case "source":
      title = hostOf(node.site);
      body = (
        <>
          <Facts rows={[["Pages read", node.pages], ["Last read", whenOf(node.readAt)]]} />
          <Note>Each page is kept as a reference asset of the company. Read the site again with <code>bb brandwise research site {node.site}</code>.</Note>
        </>
      );
      link = <Button asChild variant="outline" size="sm"><a href={node.site} target="_blank" rel="noreferrer">Open the site</a></Button>;
      break;
    case "pack":
      title = "Product pack";
      body = (
        <>
          {node.files.length === 0 ? <Note>{HINT.pack}</Note> : <PackFiles files={node.files} />}
          {node.missing.length > 0 ? <p className="text-sm text-warning-text">Missing: {node.missing.join(", ")}</p> : null}
          <Note>Read a file with <code>bb brandwise product get &lt;file&gt;</code>; a person confirms the pack with <code>bb brandwise product confirm</code>.</Note>
        </>
      );
      link = inCampaigns(map.rootId, "Open the company in Campaigns");
      break;
    case "campaign": {
      const more = leftOut(node.hidden);
      title = node.name;
      body = (
        <>
          <Facts rows={[["Kind", KIND[node.kind]]]} />
          {more === "" ? null : <Note>Not on the map: {more}. The map shows the newest posts, the creatives they use and the newest creatives no post uses.</Note>}
        </>
      );
      link = inCampaigns(node.campaignId);
      break;
    }
    case "creative":
      title = node.name;
      body = <CreativeDetails key={node.assetId} node={node} campaign={campaignName(node.campaignId)} />;
      link = <Button variant="outline" size="sm" onClick={() => nav.toPluginPanel("creatives")}>Open Creatives</Button>;
      break;
    case "post":
      title = node.title;
      body = <PostDetails key={node.entryId} node={node} campaign={campaignName(node.campaignId)} />;
      link = inCalendar(node);
      break;
    case "result":
      title = postOf(node.entryId)?.title ?? "Result";
      body = (
        <>
          <Facts rows={[
            ["Views", node.exposures === null ? "not measured" : node.exposures.toLocaleString()],
            ["Clicks", node.clicks === null ? "not measured" : node.clicks.toLocaleString()],
            ["Verdict", <span className={VERDICT[node.verdict].tone}>{VERDICT[node.verdict].label}{node.ratio === null ? "" : `, ${timesUsual(node.ratio)}`}</span>],
          ]} />
          <p className="text-sm">{VERDICT_MEANING[node.verdict]}</p>
          <Note>{BASELINE_MEANING}</Note>
        </>
      );
      link = inCalendar(postOf(node.entryId));
      break;
  }
  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{TITLE[node.column]}</p>
          <h2 className="break-words text-base font-semibold leading-snug">{title}</h2>
        </div>
        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-foreground" aria-label="Close details" onClick={onClose}>
          <Icon name="X" className="size-4" />
        </Button>
      </div>
      {body}
      <div className="mt-auto pt-2">{link}</div>
    </>
  );
}

// --- state shared by the page and its sidebar (two separate React trees in bb's slots) ---

/** What the sidebar shows of the page: the map that is drawn and the card that is selected on it. */
type Shared = { map: CompanyMapView | null; selectedId: string | null };
let shared: Shared = { map: null, selectedId: null };
const listeners = new Set<() => void>();
function setShared(patch: Partial<Shared>) {
  shared = { ...shared, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const useShared = () => useSyncExternalStore(subscribe, () => shared);
const select = (selectedId: string | null) => setShared({ selectedId });

// --- the page and its sidebar ---

export const Placeholder = ({ children }: { children: ReactNode }) => (
  <div role="status" className="m-4 flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</div>
);

/** The company on the map lives in the route (`map/<campaign id>`): links work, and the agent in the side panel reads the same route. */
export function MapPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const { map, selectedId } = useShared();
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => setError(message(cause)), []);
  const routeId = decodeURIComponent(subPath.split("/")[0]);
  // the answer for a company the user has since left must not replace the map of the one they are on
  const wanted = useRef(routeId);
  wanted.current = routeId;

  const listCampaigns = useCallback(() => {
    rpc.call("campaigns_list").then((r) => setCampaigns(r.campaigns), report);
  }, [rpc, report]);
  useEffect(listCampaigns, [listCampaigns]);
  const companies = useMemo(() => (campaigns ?? []).filter((c) => c.parentId === null), [campaigns]);
  // without a company in the route the first one is shown, in place of this history entry
  useEffect(() => {
    if (routeId === "" && companies.length > 0) nav.toPluginPanel("map", { subPath: companies[0].id, replace: true });
  }, [routeId, companies, nav]);

  const refetch = useCallback(() => {
    if (routeId === "") return;
    rpc.call("map_company", { campaignId: routeId }).then((m) => {
      if (wanted.current !== routeId) return;
      setShared({ map: m });
      setError(null);
    }, report);
  }, [rpc, routeId, report]);
  useEffect(() => {
    setShared({ map: null, selectedId: null });
    setError(null);
    refetch();
  }, [refetch]);
  const refetchAll = useCallback(() => {
    listCampaigns();
    refetch();
  }, [listCampaigns, refetch]);
  // server.ts publishes after every write (UI, CLI or agent), so the map follows the calendar, the creatives and the campaigns
  useRealtime("calendar-changed", refetch);
  useRealtime("assets-changed", refetch);
  useRealtime("campaigns-changed", refetchAll);

  const companyId = map?.rootId ?? campaigns?.find((c) => c.id === routeId)?.rootId ?? routeId;
  const selected = map?.nodes.find((n) => n.id === selectedId) ?? null;
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="mr-1 text-base font-semibold">Map</h1>
        <select className="h-8 max-w-64 rounded-md border border-input bg-background px-2 text-sm" value={companyId} onChange={(e) => nav.toPluginPanel("map", { subPath: e.target.value })} aria-label="Company" disabled={companies.length === 0}>
          {companies.length === 0 ? <option value="">No company yet</option> : null}
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {routeId !== "" && map === null && error === null ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
      </header>
      {error === null ? null : <p role="alert" className="border-b border-border px-4 py-2 text-sm text-destructive">{error}</p>}
      {campaigns !== null && companies.length === 0 ? (
        <Placeholder>
          <span>No company yet. Add an always-on base on the Campaigns page, or run <code>bb brandwise campaign add "&lt;name&gt;" --kind always_on</code>: the map shows one company at a time.</span>
        </Placeholder>
      ) : map === null ? null : (
        <div className="flex min-h-0 flex-1 flex-col">
          <Board key={map.rootId} map={map} selectedId={selected?.id ?? null} onSelect={select} />
        </div>
      )}
    </div>
  );
}

/**
 * The details of the selected card, in the page's sidebar: there the board keeps the page's whole width, so all six columns are in
 * sight, and a selection never pushes one out.
 */
export function MapSidebar() {
  const { map, selectedId } = useShared();
  const selected = map?.nodes.find((n) => n.id === selectedId) ?? null;
  return (
    <aside aria-label="Details" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
      {map === null || selected === null ? (
        <>
          <p className="text-sm text-muted-foreground">Click a card to see its details. Its chain lights up: everything it came from, back to the sites the pack was read from, and everything that came from it.</p>
          <Note>A dashed line links two cards of one column: a campaign under another, a creative derived from another. Scroll to move around; pinch, or use the buttons, to zoom.</Note>
        </>
      ) : <Details node={selected} map={map} onClose={() => select(null)} />}
    </aside>
  );
}
