/* eslint-disable @typescript-eslint/no-misused-promises */
import {
  NAMESPACES,
  OVERLAY_ROUTES,
  SOCKET_EVENTS,
  type OverlayEnvelope,
  type VisibilityMode,
} from "@bpc/shared-types";
import {
  ButtonHTMLAttributes,
  useCallback,
  useEffect,
  useState,
} from "react";
import io from "socket.io-client";

import { apiFetch, loadConnection, saveConnection } from "./api";
import { GsiDraftControls, StatsWorkspace } from "./StatsWorkspace";
import { GameStartTimerPanel } from "./GameStartTimerPanel";
import { MatchSetupPanel } from "./MatchSetupPanel";
import { routeVisible } from "./visibility";

/** Overlay routes exposed in the producer visibility panel */
const ADMIN_VIS_ROUTES = [
  "draft",
  "startingsoon",
  "herostats",
  "sponsors",
  "matchup",
  "playerstats",
  "lowerthird",
] as const;

const ROUTE_LABELS: Record<(typeof ADMIN_VIS_ROUTES)[number], string> = {
  draft: "Draft",
  startingsoon: "Game start timer",
  herostats: "Hero stats",
  sponsors: "Sponsors",
  matchup: "Matchup",
  playerstats: "Player stats",
  lowerthird: "Lower third",
};

export function ProducerDashboard() {
  const persisted = loadConnection();
  const [origin, setOrigin] = useState(persisted.origin);
  const [token, setToken] = useState(persisted.token);
  const [state, setState] = useState<OverlayEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sock, setSock] = useState("idle");

  const persist = () => saveConnection(origin, token);

  const refresh = useCallback(async () => {
    if (!token.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch(origin, token, "/api/state");
      if (!r.ok) throw new Error(await r.text());
      setState(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [origin, token]);

  useEffect(() => {
    persist();
  }, [origin, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!token.trim()) return undefined;
    const s = io(`${origin}${NAMESPACES.PRODUCER}`, {
      transports: ["websocket"],
      auth: { token },
    });
    s.on(SOCKET_EVENTS.STATE_FULL, (snap: OverlayEnvelope) => setState(snap));
    s.on("connect", () => setSock("connected"));
    s.on("disconnect", () => setSock("disconnected"));
    s.on("connect_error", () => setSock("handshake_failed"));
    return () => void s.disconnect();
  }, [origin, token]);

  const patch = useCallback(
    async (body: Record<string, unknown>): Promise<void> => {
      if (!token.trim()) return;
      setBusy(true);
      setErr(null);
      try {
        const r = await apiFetch(origin, token, "/api/state", {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(await r.text());
        setState(await r.json());
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [origin, token],
  );

  async function resetEnv(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch(origin, token, "/api/state/reset", {
        method: "POST",
      });
      if (!r.ok) throw new Error(await r.text());
      setState(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function hideAll(): Promise<void> {
    const overlayVisibility = Object.fromEntries(
      OVERLAY_ROUTES.map((k) => [k, "hidden" as VisibilityMode]),
    );
    await patch({ overlayVisibility });
  }

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <Header busy={busy} sock={sock} />
      {err ? <ErrBox text={err} /> : null}
      <div className="grid gap-10 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ConnectCard origin={origin} token={token} setO={setOrigin} setT={setToken} onSave={() => { persist(); void refresh(); }} />
        <div className="space-y-10">
          <EmergencyRow onHide={() => void hideAll()} onReset={() => void resetEnv()} onSnap={() => void refresh()} />
          <GameStartTimerPanel
            state={state}
            busy={busy}
            setBusy={setBusy}
            setErr={setErr}
            origin={origin}
            token={token}
            onVisibility={(visible) =>
              patch({
                overlayVisibility: { startingsoon: visible ? "visible" : "hidden" },
              })
            }
          />
          <ObsBlock origin={origin} token={token} />
          <MatchSetupPanel
            origin={origin}
            token={token}
            state={state}
            setErr={setErr}
          />
          <GsiDraftControls origin={origin} token={token} state={state} setErr={setErr} />
          <StatsWorkspace
            origin={origin}
            token={token}
            state={state}
            setErr={setErr}
            onShowOverlay={(route, seconds) =>
              patch({
                overlayVisibility: {
                  [route]: {
                    mode: "timed",
                    until: Date.now() + (seconds ?? 8) * 1000,
                  },
                },
              })
            }
          />
          <VisMatrix state={state} on={(r, m) => patch({ overlayVisibility: { [r]: m } })} />
          <SponsorBlock
            state={state}
            on={(sponsor) => patch({ sponsor })}
            onToggleSponsors={(visible) =>
              patch({ overlayVisibility: { sponsors: visible ? "visible" : "hidden" } })
            }
          />
        </div>
      </div>
    </div>
  );
}

function Header({ busy, sock }: { busy: boolean; sock: string }) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-8">
      <div>
        <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">producer</p>
        <h1 className="text-4xl font-bold tracking-tight">BPC Broadcast Admin</h1>
      </div>
      <div className="text-sm text-slate-400">
        socket <span className="text-white">{sock}</span>
        {busy ? <span className="ml-4 text-orange-300"> syncing… </span> : null}
      </div>
    </header>
  );
}

function ErrBox({ text }: { text: string }) {
  return (
    <pre className="mb-8 whitespace-pre-wrap rounded-xl border border-rose-500/40 bg-rose-950/40 p-4 text-rose-100">
      {text}
    </pre>
  );
}

function Btn(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" },
) {
  const { variant = "primary", className = "", type = "button", ...rest } = props;
  const palette =
    variant === "danger"
      ? "bg-orange-600 hover:bg-orange-500 border border-transparent"
      : variant === "ghost"
        ? "border border-white/20 bg-transparent text-white hover:bg-white/5"
        : "bg-emerald-500 text-emerald-950 hover:bg-emerald-400 border border-transparent font-semibold";
  return (
    <button type={type} className={`rounded-lg px-4 py-2 text-sm uppercase tracking-wide ${palette} ${className}`} {...rest} />
  );
}

function ConnectCard(props: {
  origin: string;
  token: string;
  setO(v: string): void;
  setT(v: string): void;
  onSave(): void;
}) {
  return (
    <section className="h-fit rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-6">
      <h2 className="text-lg font-semibold text-emerald-200">API link</h2>
      <label className="mt-4 block text-xs uppercase text-slate-500">Origin</label>
      <input className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={props.origin} onChange={(e) => props.setO(e.target.value)} />
      <label className="mt-4 block text-xs uppercase text-slate-500">Bearer</label>
      <input type="password" className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm" value={props.token} onChange={(e) => props.setT(e.target.value)} />
      <Btn className="mt-6 w-full" onClick={props.onSave}>
        Save + refresh
      </Btn>
    </section>
  );
}

function EmergencyRow(props: { onHide(): void; onReset(): void; onSnap(): void }) {
  return (
    <section className="rounded-2xl border border-orange-500/40 bg-orange-950/30 p-6">
      <h2 className="text-lg font-semibold text-orange-200">Emergency</h2>
      <div className="mt-4 flex flex-wrap gap-4">
        <Btn variant="danger" onClick={props.onHide}>
          blackout overlays
        </Btn>
        <Btn variant="ghost" onClick={props.onSnap}>
          resync envelope
        </Btn>
        <Btn variant="ghost" onClick={props.onReset}>
          reset envelope
        </Btn>
      </div>
    </section>
  );
}

function ObsBlock(props: { origin: string; token: string }) {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(4455);
  const [pass, setPass] = useState("");
  const [scenes, setScenes] = useState<string[]>([]);
  const [pick, setPick] = useState("");

  const post = async (path: string, body: Record<string, unknown>) => {
    const r = await apiFetch(props.origin, props.token, path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(t);
    return t ? JSON.parse(t) : {};
  };

  async function reloadScenes() {
    const r = await apiFetch(props.origin, props.token, "/api/obs/scenes");
    const j = (await r.json()) as { scenes?: string[] };
    setScenes(j.scenes ?? []);
  }

  return (
    <section className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <h2 className="text-lg font-semibold text-cyan-300">OBS</h2>
        <Btn variant="ghost" className="!py-1 !text-xs" onClick={() => void reloadScenes()}>
          list scenes
        </Btn>
      </div>
      <p className="mt-2 text-xs text-slate-500">Use VPN/Tailscale so this API reach caster websocket.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <label className="text-xs uppercase text-slate-500">host</label>
          <input className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={host} onChange={(e) => setHost(e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase text-slate-500">port</label>
          <input className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={String(port)} onChange={(e) => setPort(Number(e.target.value))} />
        </div>
        <div>
          <label className="text-xs uppercase text-slate-500">secret</label>
          <input type="password" className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={pass} onChange={(e) => setPass(e.target.value)} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Btn variant="ghost" onClick={() => void post("/api/obs/connect", { host, port, password: pass })}>
          connect
        </Btn>
        <Btn variant="ghost" onClick={() => void post("/api/obs/disconnect", {})}>
          disconnect
        </Btn>
        <Btn variant="ghost" onClick={() => void post("/api/obs/config", { host, port, password: pass })}>
          store config
        </Btn>
      </div>
      <div className="mt-6 flex flex-wrap items-end gap-4">
        <div className="min-w-[200px]">
          <label className="text-xs uppercase text-slate-500">program scene</label>
          <select className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">—</option>
            {scenes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Btn disabled={!pick} onClick={() => pick && void post("/api/obs/program-scene", { sceneName: pick })}>
          cut
        </Btn>
      </div>
      <ObsSourceMini origin={props.origin} token={props.token} />
    </section>
  );
}

function ObsSourceMini({ origin, token }: { origin: string; token: string }) {
  const [scene, setScene] = useState("MAIN");
  const [source, setSource] = useState("GRAPHICS_BROWSER");
  const [enabled, setEnabled] = useState(true);

  const push = () =>
    void apiFetch(origin, token, "/api/obs/scene-source", {
      method: "POST",
      body: JSON.stringify({ sceneName: scene, sourceName: source, visible: enabled }),
    });

  return (
    <details className="mt-6 rounded-xl border border-white/5 bg-black/40 p-4">
      <summary className="cursor-pointer text-sm text-slate-300">OBS source toggle</summary>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div>
          <label className="text-xs uppercase text-slate-600">scene</label>
          <input className="mt-1 w-full rounded border border-white/10 bg-transparent px-2 py-2" value={scene} onChange={(e) => setScene(e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase text-slate-600">source name</label>
          <input className="mt-1 w-full rounded border border-white/10 bg-transparent px-2 py-2" value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
        <label className="mt-9 flex gap-3 text-xs text-slate-500">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> enabled
        </label>
      </div>
      <Btn variant="ghost" className="mt-4" onClick={push}>
        apply
      </Btn>
    </details>
  );
}

function stringifyMode(mode?: VisibilityMode) {
  if (!mode || mode === "visible" || mode === "hidden") return String(mode ?? "unset");
  if (typeof mode === "object") return `timed ${new Date(mode.until).toISOString()}`;
  return "?";
}

function VisToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle(): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      className={`relative inline-flex h-9 w-[5.5rem] shrink-0 items-center rounded-full transition-colors ${
        active
          ? "bg-emerald-500"
          : "bg-slate-800 ring-1 ring-white/10"
      }`}
    >
      <span
        className={`inline-block h-7 w-7 rounded-full bg-white shadow transition-transform ${
          active ? "translate-x-[3.25rem]" : "translate-x-1"
        }`}
      />
      <span
        className={`pointer-events-none absolute text-[10px] font-bold uppercase ${
          active ? "left-2 text-emerald-950" : "right-2 text-slate-400"
        }`}
      >
        {active ? "On" : "Off"}
      </span>
    </button>
  );
}

function VisMatrix(props: {
  state: OverlayEnvelope | null;
  on(r: string, m: VisibilityMode): void | Promise<void>;
}) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="rounded-2xl border border-yellow-500/40 bg-yellow-950/25 p-6">
      <h2 className="mb-2 text-lg font-semibold text-yellow-200">Overlay visibility</h2>
      <p className="mb-6 text-xs text-slate-400">
        Toggle each overlay route on or off. Timed shows from stats actions expire automatically.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {ADMIN_VIS_ROUTES.map((route) => {
          const mv = props.state?.overlayVisibility as Record<string, VisibilityMode> | undefined;
          const active = routeVisible(route, props.state);
          return (
            <div
              key={route}
              className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-950/80 p-4"
            >
              <div>
                <p className="text-sm font-semibold">{ROUTE_LABELS[route]}</p>
                <p className="text-xs font-mono text-slate-500">/{route}</p>
                <p className="mt-1 text-[10px] text-slate-600">{stringifyMode(mv?.[route])}</p>
              </div>
              <VisToggle
                active={active}
                onToggle={() => props.on(route, active ? "hidden" : "visible")}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SponsorBlock({
  state,
  on,
  onToggleSponsors,
}: {
  state: OverlayEnvelope | null;
  on(s: NonNullable<OverlayEnvelope["sponsor"]>): Promise<void>;
  onToggleSponsors(visible: boolean): void;
}) {
  const [a, setA] = useState("Partner Alpha");
  const [b, setB] = useState("Partner Beta");
  const sponsorsVisible = routeVisible("sponsors", state);

  const push = () =>
    on({
      banners: [
        { title: a, subtitle: "tier 1", durationSeconds: 8 },
        { title: b, subtitle: "tier 2", durationSeconds: 8 },
      ],
      activeIndex: 0,
      startedAt: Date.now(),
    });

  return (
    <section className="rounded-2xl border border-pink-500/40 bg-pink-950/30 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-pink-200">Sponsors</h2>
        <VisToggle
          active={sponsorsVisible}
          onToggle={() => onToggleSponsors(!sponsorsVisible)}
        />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-xs uppercase text-slate-500">banner a</label>
          <input className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={a} onChange={(e) => setA(e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase text-slate-500">banner b</label>
          <input className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={b} onChange={(e) => setB(e.target.value)} />
        </div>
      </div>
      <Btn className="mt-4" onClick={push}>
        stage carousel
      </Btn>
    </section>
  );
}
