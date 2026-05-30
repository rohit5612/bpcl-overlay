import {
  NAMESPACES,
  SOCKET_EVENTS,
  createDefaultEnvelope,
  type OverlayEnvelope,
  type OverlayPatch,
} from "@bpc/shared-types";
import type { StateManager } from "@bpc/state-manager";
import type { Express, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import { z } from "zod";
import { requireBroadcastAuth } from "./auth-middleware.js";
import { logger } from "./logger.js";
import type { OBSController } from "./obs-controller.js";
import type { OpenDotaClient } from "./opendota-client.js";
import { parseOverlayPatch } from "./state-setup.js";

export type BroadcastFns = {
  broadcastFull(envelope?: OverlayEnvelope): Promise<void>;
};

export function attachRestRoutes(opts: {
  app: Express;
  state: StateManager;
  io: IOServer;
  broadcast: BroadcastFns;
  obs: OBSController;
  opendota: OpenDotaClient;
}): void {
  const { app, state, io, broadcast, obs, opendota } = opts;

  app.get("/health/live", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "broadcast-api",
      /** Bump when deploying; used to confirm apply-player-mapping route is live */
      build: "2026-05-30",
      routes: {
        applyPlayerMapping: "POST /api/match/apply-player-mapping",
        matchSetup: "POST /api/match/setup",
      },
    });
  });

  app.get("/health/ready", async (_req: Request, res: Response) => {
    try {
      await state.getState();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.get("/api/state", requireBroadcastAuth, async (_req, res) => {
    const s = await state.getState();
    res.json(s);
  });

  app.patch("/api/state", requireBroadcastAuth, async (req, res) => {
    try {
      const patch = parseOverlayPatch(req.body) as OverlayPatch;
      const next = await state.patchState(patch);
      await broadcast.broadcastFull(next);
      res.json(next);
    } catch (err) {
      logger.error(err, "state patch failed");
      res.status(400).json({
        error: err instanceof Error ? err.message : "invalid patch",
      });
    }
  });

  app.post("/api/state/reset", requireBroadcastAuth, async (_req, res) => {
    const fresh = createDefaultEnvelope();
    const saved = await state.replaceState(fresh);
    await broadcast.broadcastFull(saved);
    res.json(saved);
  });

  const obsCfgSchema = z.object({
    host: z.string(),
    port: z.coerce.number(),
    password: z.string(),
  });

  app.post("/api/obs/config", requireBroadcastAuth, (req, res) => {
    const parsed = obsCfgSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    obs.configure(parsed.data);
    void io.of(NAMESPACES.PRODUCER).emit(SOCKET_EVENTS.ACK, {
      kind: "obs:config",
      ok: true,
    });
    res.json({ ok: true });
  });

  app.post("/api/obs/connect", requireBroadcastAuth, async (req, res) => {
    const body = req.body as unknown;
    if (body && typeof body === "object" && Object.keys(body).length) {
      const parsed = obsCfgSchema.safeParse(body);
      if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
      obs.configure(parsed.data);
    }
    const result = await obs.connect();
    void io.of(NAMESPACES.PRODUCER).emit(SOCKET_EVENTS.ACK, {
      kind: "obs:connect",
      ok: result.ok,
      error: result.error,
    });
    res.json(result);
  });

  app.post("/api/obs/disconnect", requireBroadcastAuth, async (_req, res) => {
    await obs.disconnect();
    void io.of(NAMESPACES.PRODUCER).emit(SOCKET_EVENTS.ACK, {
      kind: "obs:disconnect",
      ok: true,
    });
    res.json({ ok: true });
  });

  app.get("/api/obs/scenes", requireBroadcastAuth, async (_req, res) => {
    try {
      const scenes = await obs.listScenes();
      res.json({ ok: true, scenes });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/obs/program-scene", requireBroadcastAuth, async (req, res) => {
    const schema = z.object({ sceneName: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    const result = await obs.setProgramScene(parsed.data.sceneName);

    void io.of(NAMESPACES.PRODUCER).emit(SOCKET_EVENTS.ACK, {
      kind: "obs:setProgramScene",
      ok: result.ok,
      sceneName: parsed.data.sceneName,
      error: result.error,
    });

    await state.patchState({
      sceneHints: { desiredSceneName: parsed.data.sceneName },
    });
    const envelope = await state.getState();
    await broadcast.broadcastFull(envelope);

    res.json(result);
  });

  app.post(
    "/api/obs/scene-source",
    requireBroadcastAuth,
    async (req, res) => {
      const schema = z.object({
        sceneName: z.string(),
        sourceName: z.string(),
        visible: z.boolean(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
      const result = await obs.setSourceVisible(parsed.data);
      res.json(result);
    },
  );

  app.post(
    "/api/opendota/heroes/constants",
    requireBroadcastAuth,
    async (_req, res) => {
      const heroes = await opendota.heroesConstants();
      res.json(heroes);
    },
  );

  app.post(
    "/api/opendota/player/:accountId/heroes",
    requireBroadcastAuth,
    async (req, res) => {
      const heroes = await opendota.playerHeroStats(req.params.accountId);
      res.json(heroes);
    },
  );

  app.post(
    "/api/opendota/hero/:heroId/matchups",
    requireBroadcastAuth,
    async (req, res) => {
      const matchups = await opendota.heroMatchups(Number(req.params.heroId));
      res.json(matchups);
    },
  );

  app.post(
    "/api/opendota/matchups/between",
    requireBroadcastAuth,
    async (req, res) => {
      const schema = z.object({
        heroA: z.number(),
        heroB: z.number(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
      const result = await opendota.matchupBetween(
        parsed.data.heroA,
        parsed.data.heroB,
      );
      res.json(result);
    },
  );

  /** Producer-triggered aggregation that writes overlay cards */
  app.post("/api/opendota/compose/hero-card", requireBroadcastAuth, async (req, res) => {
    const schema = z.object({
      accountId: z.number().optional(),
      heroId: z.number(),
      playerLabel: z.string(),
      persist: z.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    let playerHeroAgg: Record<string, unknown> | undefined;
    let source: "opendota_cached" | "stale" = "opendota_cached";

    if (parsed.data.accountId !== undefined) {
      const ph = await opendota.playerHeroStats(parsed.data.accountId);
      if (ph.ok && Array.isArray(ph.data)) {
        playerHeroAgg = ph.data.find(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            (entry as { hero_id?: unknown }).hero_id === parsed.data.heroId,
        ) as Record<string, unknown> | undefined;
      }
      if (!ph.ok) source = "stale";
    }

    const card = {
      playerLabel: parsed.data.playerLabel,
      heroId: parsed.data.heroId,
      playerHero:
        typeof playerHeroAgg === "object" && playerHeroAgg
          ? {
              games: typeof playerHeroAgg.games === "number" ? playerHeroAgg.games : undefined,
              wins: typeof playerHeroAgg.win === "number" ? playerHeroAgg.win : undefined,
            }
          : undefined,
      tournament: {},
      matchup: {},
      fetchedAt: new Date().toISOString(),
      source,
    };

    if (parsed.data.persist) {
      const next = await state.patchState({ heroStatsCard: card });
      await broadcast.broadcastFull(next);
      return res.json({ ok: true, card, persisted: next });
    }

    return res.json({ ok: true, card });
  });

  /** Pairwise matchup persisted into matchupCard */
  app.post("/api/opendota/compose/matchup-card", requireBroadcastAuth, async (req, res) => {
    const schema = z.object({
      heroAId: z.number(),
      heroBId: z.number(),
      persist: z.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const data = await opendota.matchupBetween(
      parsed.data.heroAId,
      parsed.data.heroBId,
    );

    const card = {
      heroAId: parsed.data.heroAId,
      heroBId: parsed.data.heroBId,
      matchup: data.ok ? (data.data as Record<string, unknown>) ?? {} : {},
      fetchedAt: new Date().toISOString(),
      source: data.ok ? ("opendota_cached" as const) : ("stale" as const),
    };

    if (parsed.data.persist) {
      const next = await state.patchState({ matchupCard: card });
      await broadcast.broadcastFull(next);
      return res.json({ ok: true, upstream: data, matchupCard: card, persisted: next });
    }

    return res.json({ ok: true, upstream: data, matchupCard: card });
  });

  app.post("/api/opendota/cache/clear-memory", requireBroadcastAuth, (_req, res) => {
    opendota.purgeMemory();
    res.json({ ok: true });
  });
}
