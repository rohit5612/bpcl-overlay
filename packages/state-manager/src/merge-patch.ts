import type {
  DraftSlot,
  DraftState,
  HeroStatsCard,
  LeagueConfig,
  LowerThirdState,
  MatchupCard,
  OverlayEnvelope,
  OverlayPatch,
  PlayerStatsCard,
  ProductionSettings,
  SponsorRotationState,
  StatCarouselState,
  TournamentHeroAggregate,
  VisibilityMode,
} from "@bpc/shared-types";

function mergeVisibility(
  prev: Record<string, VisibilityMode>,
  incoming: OverlayPatch["overlayVisibility"],
): Record<string, VisibilityMode> {
  if (!incoming) return { ...prev };
  return { ...prev, ...incoming };
}

function mergeTeamSlots(
  prevSlots: DraftSlot[] | undefined,
  nextSlots: DraftSlot[] | undefined,
): DraftSlot[] | undefined {
  if (!nextSlots) return prevSlots;
  if (!prevSlots?.length) return nextSlots;
  const prevMap = new Map(
    prevSlots.map((s) => [`${s.type}:${s.order}`, s] as const),
  );
  return nextSlots.map((s) => {
    const prev = prevMap.get(`${s.type}:${s.order}`);
    if (!prev?.playerName && prev?.steam32 === undefined) return s;
    return {
      ...s,
      playerName: s.playerName ?? prev.playerName,
      steam32: s.steam32 ?? prev.steam32,
    };
  });
}

function mergeDraft(
  prev: DraftState | null | undefined,
  incoming: OverlayPatch["draft"],
): DraftState | null | undefined {
  if (incoming === undefined) return prev;
  if (incoming === null) return null;
  const inc = incoming as Partial<DraftState> & Record<string, unknown>;
  if (!prev) {
    return inc as DraftState;
  }

  const nextRadiant = inc.radiant
    ? ({ ...(prev.radiant ?? {}), ...inc.radiant } as DraftState["radiant"])
    : prev.radiant;
  const nextDire = inc.dire
    ? ({ ...(prev.dire ?? {}), ...inc.dire } as DraftState["dire"])
    : prev.dire;

  if (nextRadiant?.slots) {
    nextRadiant.slots = mergeTeamSlots(
      prev.radiant?.slots,
      nextRadiant.slots,
    );
  }
  if (nextDire?.slots) {
    nextDire.slots = mergeTeamSlots(prev.dire?.slots, nextDire.slots);
  }

  return {
    ...prev,
    ...inc,
    series: inc.series
      ? ({ ...prev.series, ...inc.series } as DraftState["series"])
      : prev.series,
    picksBansOrder: inc.picksBansOrder ?? prev.picksBansOrder,
    radiant: nextRadiant,
    dire: nextDire,
    lastPick: inc.lastPick ?? prev.lastPick,
  } as DraftState;
}

function mergeNullableNested<T extends Record<string, unknown>>(
  prev: T | null | undefined,
  incoming: Partial<T> | null | undefined,
): T | null | undefined {
  if (incoming === undefined) return prev;
  if (incoming === null) return null;
  if (!prev || prev === null) return { ...incoming } as T;
  return { ...prev, ...incoming };
}

function mergeLeagueConfig(
  prev: LeagueConfig | undefined,
  incoming: OverlayPatch["leagueConfig"],
): LeagueConfig | undefined {
  if (incoming === undefined) return prev;
  return {
    ...(prev ?? { leagueId: null, roster: [], aggregationStatus: "idle" }),
    ...incoming,
    roster: incoming.roster ?? prev?.roster ?? [],
    matchSetup:
      incoming.matchSetup !== undefined
        ? incoming.matchSetup
        : (prev?.matchSetup ?? null),
    teamColors:
      incoming.teamColors !== undefined
        ? { ...(prev?.teamColors ?? {}), ...incoming.teamColors }
        : prev?.teamColors,
  } as LeagueConfig;
}

function mergeProduction(
  prev: ProductionSettings | undefined,
  incoming: OverlayPatch["production"],
): ProductionSettings | undefined {
  if (incoming === undefined) return prev;
  return { ...(prev ?? {}), ...incoming } as ProductionSettings;
}

/** Mutates timestamps and seq */
export function applyOverlayPatch(
  prev: OverlayEnvelope,
  patch: OverlayPatch,
): OverlayEnvelope {
  const overlayVisibility =
    patch.overlayVisibility !== undefined
      ? mergeVisibility(
          prev.overlayVisibility as Record<string, VisibilityMode>,
          patch.overlayVisibility,
        )
      : prev.overlayVisibility;

  let nextTimers = prev.timers;
  if (patch.timers !== undefined) {
    nextTimers = {
      ...(prev.timers ?? {}),
      ...patch.timers,
    };
    if (patch.timers.gameStartCountdown !== undefined) {
      nextTimers = {
        ...nextTimers,
        gameStartCountdown: {
          ...(prev.timers?.gameStartCountdown ?? {}),
          ...patch.timers.gameStartCountdown,
        },
      };
    }
  }

  const nextDraft = mergeDraft(prev.draft, patch.draft);
  const nextLeague = mergeLeagueConfig(prev.leagueConfig, patch.leagueConfig);
  const nextProduction = mergeProduction(prev.production, patch.production);

  let tournamentHeroIndex = prev.tournamentHeroIndex;
  if (patch.tournamentHeroIndex !== undefined) {
    tournamentHeroIndex = {
      ...(prev.tournamentHeroIndex ?? {}),
      ...patch.tournamentHeroIndex,
    };
  }

  let playerHeroIndex = prev.playerHeroIndex;
  if (patch.playerHeroIndex !== undefined) {
    playerHeroIndex = {
      ...(prev.playerHeroIndex ?? {}),
      ...patch.playerHeroIndex,
    };
  }

  let nextHero = mergeNullableNested(
    prev.heroStatsCard ?? undefined,
    patch.heroStatsCard as Partial<HeroStatsCard> | null | undefined,
  );
  let nextSceneHints =
    patch.sceneHints !== undefined
      ? { ...(prev.sceneHints ?? {}), ...patch.sceneHints }
      : prev.sceneHints;

  const nextLower = mergeNullableNested(
    prev.lowerThirds ?? undefined,
    patch.lowerThirds as Partial<LowerThirdState> | null | undefined,
  );
  const nextPlayer = mergeNullableNested(
    prev.playerStatsCard ?? undefined,
    patch.playerStatsCard as Partial<PlayerStatsCard> | null | undefined,
  );
  let nextMatch = mergeNullableNested(
    prev.matchupCard ?? undefined,
    patch.matchupCard as Partial<MatchupCard> | null | undefined,
  );
  let nextSponsor = mergeNullableNested(
    prev.sponsor ?? undefined,
    patch.sponsor as Partial<SponsorRotationState> | null | undefined,
  );
  let nextCarousel = mergeNullableNested(
    prev.statCarousel ?? undefined,
    patch.statCarousel as Partial<StatCarouselState> | null | undefined,
  );

  if (
    nextHero &&
    patch.heroStatsCard &&
    typeof patch.heroStatsCard === "object"
  ) {
    const hc = patch.heroStatsCard as HeroStatsCard;
    if (hc.fetchedAt) {
      nextHero = { ...hc };
    } else {
      nextHero = {
        ...nextHero,
        ...hc,
        tournament: hc.tournament
          ? { ...(nextHero.tournament ?? {}), ...hc.tournament }
          : nextHero.tournament,
        playerHero: hc.playerHero
          ? { ...(nextHero.playerHero ?? {}), ...hc.playerHero }
          : nextHero.playerHero,
        statSlides: hc.statSlides ?? nextHero.statSlides,
      };
    }
  }

  if (
    nextMatch &&
    patch.matchupCard &&
    typeof patch.matchupCard === "object"
  ) {
    const mc = patch.matchupCard as MatchupCard;
    nextMatch = {
      ...nextMatch,
      ...mc,
      matchup: mc.matchup
        ? { ...(nextMatch.matchup ?? {}), ...mc.matchup }
        : nextMatch.matchup,
    };
  }

  return {
    ...prev,
    seq: prev.seq + 1,
    updatedAt: new Date().toISOString(),
    overlayVisibility,
    leagueConfig: nextLeague ?? prev.leagueConfig,
    tournamentHeroIndex: tournamentHeroIndex ?? prev.tournamentHeroIndex,
    playerHeroIndex: playerHeroIndex ?? prev.playerHeroIndex,
    production: nextProduction ?? prev.production,
    statCarousel:
      nextCarousel === undefined
        ? prev.statCarousel
        : (nextCarousel as StatCarouselState | null),
    draft: nextDraft === undefined ? prev.draft : nextDraft,
    lowerThirds:
      nextLower === undefined
        ? prev.lowerThirds
        : (nextLower as LowerThirdState | null),
    playerStatsCard:
      nextPlayer === undefined
        ? prev.playerStatsCard
        : (nextPlayer as PlayerStatsCard | null),
    heroStatsCard:
      nextHero === undefined
        ? prev.heroStatsCard
        : (nextHero as HeroStatsCard | null),
    matchupCard:
      nextMatch === undefined
        ? prev.matchupCard
        : (nextMatch as MatchupCard | null),
    sponsor:
      nextSponsor === undefined
        ? prev.sponsor
        : (nextSponsor as SponsorRotationState | null),
    timers: nextTimers ?? prev.timers,
    sceneHints: nextSceneHints,
  };
}

export type { TournamentHeroAggregate };
