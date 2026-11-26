import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  MODES,
  REALTIME_LOBBY_MS,
  REMINDER_MS,
  acceptPath,
  allowsDraws,
  changedSettings,
  flexibleSeats,
  isMode,
  modeDef,
  modePath,
  reasonOf,
  settingsOf,
  withSeeds,
  type ModeKey,
  type Settings,
} from "./modes";
import { isTestUser, notify, notifyMatch } from "./notify";
import { placesOf, recordResult } from "./ratings";
import { hooksFor } from "./games";
import { DEFAULT_PROFILE } from "./profileOptions";
import { awaits, isPlayer, loadMatch, opponentsOf, requireUser } from "./lib/seats";
import { displayName, namesOf } from "./lib/people";
import { scheduleReminder } from "./lib/turns";

const modeOf = (match: Doc<"matches">) => MODES[match.mode as ModeKey];
const openToCrew = (match: Doc<"matches">) => match.invited.length === 0 || match.openSeats === true;
const invitesUnanswered = (match: Doc<"matches">) => match.invited.filter((id) => !isPlayer(match, id));
const unclaimedSeats = (match: Doc<"matches">) => modeOf(match).players - match.players.length - invitesUnanswered(match).length;
const canJoin = (match: Doc<"matches">, userId: Id<"users">) =>
  !isPlayer(match, userId) && (match.invited.includes(userId) || (openToCrew(match) && unclaimedSeats(match) > 0));

export function listNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "nobody";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

async function withPeople(ctx: QueryCtx, match: Doc<"matches">) {
  const players = await Promise.all(
    match.players.map(async (p) => {
      const user = await ctx.db.get(p.userId);
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", p.userId))
        .unique();
      return {
        ...p,
        isTest: user?.isTest === true,
        name: user?.name ?? "Player",
        image: user?.image,
        frame: profile?.frame ?? DEFAULT_PROFILE.frame,
        frameColor: profile?.frameColor ?? DEFAULT_PROFILE.frameColor,
        glow: profile?.glow ?? DEFAULT_PROFILE.glow,
        badge: profile?.badge ?? DEFAULT_PROFILE.badge,
      };
    }),
  );
  const invitedPeople = await Promise.all(
    match.invited.map(async (id) => {
      const user = await ctx.db.get(id);
      return { userId: id, name: user?.name ?? "Player", image: user?.image, joined: match.players.some((p) => p.userId === id) };
    }),
  );
  return { ...match, players, invitedPeople };
}

export type MatchView = Awaited<ReturnType<typeof withPeople>>;

const settingsArg = v.optional(v.record(v.string(), v.number()));

function shuffled<T>(items: T[]) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function start(ctx: MutationCtx, match: Doc<"matches">, seating: "shuffle" | "as seated" = "shuffle") {
  const now = Date.now();
  const seats = seating === "shuffle" ? shuffled(match.players) : match.players;
  const hooks = hooksFor(match.mode);
  const colors = hooks.seats(match.mode as ModeKey, seats.length);
  const players = seats.map((p, i) => ({ ...p, color: colors[i] }));
  const patch = { status: "active" as const, players, startedAt: now, lastActivityAt: now, state: null, moveCount: 0 };
  await ctx.db.patch(match._id, patch);
  await hooks.start(ctx, { ...match, ...patch });
}

export async function finish(ctx: MutationCtx, match: Doc<"matches">, result: NonNullable<Doc<"matches">["result"]>) {
  if (match.status !== "active") return;
  const ended = {
    ...match,
    status: "finished" as const,
    result,
    endedAt: Date.now(),
    drawOffer: undefined,
    turn: undefined,
    waitingOn: undefined,
  };
  const ratingChanges = await recordResult(ctx, ended);
  await ctx.db.patch(match._id, {
    status: "finished",
    result,
    endedAt: ended.endedAt,
    drawOffer: undefined,
    turn: undefined,
    waitingOn: undefined,
    ratingChanges,
    lastActivityAt: ended.endedAt,
  });
  const mode = modeOf(match);
  const places = placesOf(ended);
  for (const p of match.players) {
    const change = ratingChanges.find((c) => c.userId === p.userId);
    const delta = change ? change.after - change.before : 0;
    const swing = change ? ` (${delta >= 0 ? "+" : ""}${delta})` : "";
    const place = places.findIndex((g) => g.includes(p.userId));
    const title =
      match.players.length > 2
        ? place === 0
          ? places[0].length > 1
            ? "You tied for first"
            : "You won"
          : `You placed ${ordinal(place + 1)}`
        : result.draw
          ? "Draw"
          : result.winners.includes(p.userId)
            ? "You won"
            : "You lost";
    const others = listNames(await namesOf(ctx, opponentsOf(match, p.userId)));
    await notifyMatch(ctx, p.userId, match, {
      title: `${title}${swing}`,
      body: `${capitalize(mode.title)} vs ${others}: ${reasonOf(result.reason, match.mode).push}.`,
    });
  }
}

export async function finishBySeats(ctx: MutationCtx, match: Doc<"matches">, groups: number[][], reason: string) {
  const places = groups.map((g) => g.map((seat) => match.players[seat].userId));
  const draw = places[0].length === match.players.length;
  await finish(ctx, match, { winners: draw ? [] : places[0], draw, reason, standings: places });
}

export const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
export const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

export const timeoutStrikes = (match: Pick<Doc<"matches">, "mode" | "settings">) =>
  Math.round(((settingsOf(match.mode, match.settings).moveTime ?? 0) * 3600_000) / REMINDER_MS);
export const TIMEOUT_STRIKES = 6;

export const remind = internalMutation({
  args: { id: v.id("matches"), moveCount: v.number(), strikes: v.optional(v.number()) },
  handler: async (ctx, { id, moveCount, strikes = 0 }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active" || match.moveCount !== moveCount || !match.turn) return;
    const multi = match.players.length > 2;
    const limit = timeoutStrikes(match);
    const hooks = hooksFor(match.mode);
    if (limit > 0 && strikes + 1 >= limit) {
      await hooks.timeout(ctx, match, match.turn);
      return;
    }
    const others = listNames(await namesOf(ctx, opponentsOf(match, match.turn)));
    const left = limit > 0 && strikes + 2 === limit ? ` Move in the next 8 hours ${hooks.timeoutWarning}.` : "";
    await notifyMatch(ctx, match.turn, match, {
      title: "Still your move",
      body: `${others} ${multi ? "are" : "is"} waiting on you in ${modeOf(match).title}.${left}`,
    });
    await scheduleReminder(ctx, id, moveCount, strikes + 1);
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;
const UNSTARTED_CALL_OFF_MS = 3 * 60 * 1000;

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const waiting = await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .collect();
    const seen = new Set<string>();
    for (const m of waiting.sort((a, b) => b._creationTime - a._creationTime)) {
      const key = `${m.createdBy}:${m.mode}:${[...m.invited].sort().join(",")}`;
      const duplicate = m.invited.length > 0 && seen.has(key);
      seen.add(key);
      const stale =
        now - m._creationTime > DAY_MS || (MODES[m.mode as ModeKey]?.kind === "realtime" && now - m._creationTime > REALTIME_LOBBY_MS);
      if (duplicate || stale) await ctx.db.patch(m._id, { status: "cancelled", lastActivityAt: now });
    }
    const active = await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    for (const m of active) {
      if (!isMode(m.mode) || !hooksFor(m.mode).unstarted?.(m)) continue;
      if (now - (m.startedAt ?? m._creationTime) > UNSTARTED_CALL_OFF_MS)
        await ctx.db.patch(m._id, { status: "cancelled", lastActivityAt: now });
    }
  },
});

export const expireLobby = internalMutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const match = await ctx.db.get(id);
    if (match?.status === "waiting") await ctx.db.patch(id, { status: "cancelled", lastActivityAt: Date.now() });
  },
});

async function create(ctx: MutationCtx, userId: Id<"users">, mode: ModeKey, invited: Id<"users">[], settings?: Settings) {
  const now = Date.now();
  const changed = changedSettings(mode, withSeeds(mode, settings));
  const leavesSeatsForCrew = invited.length > 0 && invited.length < MODES[mode].players - 1;
  const id = await ctx.db.insert("matches", {
    mode,
    status: "waiting",
    createdBy: userId,
    players: [{ userId }],
    invited,
    ...(Object.keys(changed).length ? { settings: changed } : {}),
    openSeats: leavesSeatsForCrew ? true : undefined,
    state: null,
    moveCount: 0,
    lastActivityAt: now,
  });
  if (MODES[mode].kind === "realtime") await ctx.scheduler.runAfter(REALTIME_LOBBY_MS, internal.matches.expireLobby, { id });
  return id;
}

export async function addPlayer(ctx: MutationCtx, match: Doc<"matches">, userId: Id<"users">) {
  const players = [...match.players, { userId }];
  await ctx.db.patch(match._id, { players, lastActivityAt: Date.now() });
  const updated = { ...match, players };
  const name = await displayName(ctx, userId);
  const mode = modeOf(match);
  const full = players.length >= mode.players;
  const flexible = flexibleSeats(match.mode);
  for (const p of match.players) {
    const host = p.userId === match.createdBy;
    await notifyMatch(ctx, p.userId, match, {
      title: full || flexible ? `${name} joined` : `${name} joined (${players.length}/${mode.players})`,
      body: full
        ? mode.kind === "realtime"
          ? `Your ${mode.title} game is ready. Tap to play.`
          : `Your ${mode.title} game is on.`
        : flexible
          ? host
            ? `${players.length} in. Start whenever you're ready.`
            : `${players.length} in.`
          : `Waiting for ${mode.players - players.length} more.`,
    });
  }
  if (full) await start(ctx, updated);
}

async function pingCrew(ctx: MutationCtx, match: Doc<"matches">, title: string, body: string) {
  if (await isTestUser(ctx, match.createdBy)) return;
  for (const u of await ctx.db.query("users").collect()) {
    if (isPlayer(match, u._id) || match.invited.includes(u._id)) continue;
    await notify(ctx, u._id, { title, body, url: acceptPath(match), tag: `lobby:${match._id}` });
  }
}

export const queue = mutation({
  args: { mode: v.string(), settings: settingsArg },
  handler: async (ctx, { mode, settings }) => {
    const userId = await requireUser(ctx);
    if (!isMode(mode)) throw new Error("Unknown mode.");
    const waiting = await ctx.db
      .query("matches")
      .withIndex("by_mode_status", (q) => q.eq("mode", mode).eq("status", "waiting"))
      .collect();
    const myOpenGame = waiting.find((m) => isPlayer(m, userId) && openToCrew(m));
    if (myOpenGame) return myOpenGame._id;
    const open = waiting.find((m) => openToCrew(m) && canJoin(m, userId));
    if (open) {
      await addPlayer(ctx, open, userId);
      return open._id;
    }
    const id = await create(ctx, userId, mode, [], settings);
    const name = await displayName(ctx, userId);
    const m = MODES[mode];
    const flexible = flexibleSeats(mode);
    const title = `${name} wants ${modeDef(mode).wants ?? m.title}`;
    const body = flexible
      ? m.kind === "realtime"
        ? "Jump in now, it starts when they hit Start."
        : "Tap to take a seat."
      : m.kind === "realtime"
        ? `Jump in now, it starts when ${m.players > 2 ? `all ${m.players}` : "you both"} get there.`
        : m.players > 2
          ? `${m.players - 1} seats open. Tap to take one.`
          : "Tap to take the other seat.";
    await pingCrew(ctx, (await ctx.db.get(id))!, title, body);
    return id;
  },
});

export const challenge = mutation({
  args: { mode: v.string(), opponent: v.optional(v.id("users")), opponents: v.optional(v.array(v.id("users"))), settings: settingsArg },
  handler: async (ctx, { mode, opponent, opponents, settings }) => {
    const userId = await requireUser(ctx);
    if (!isMode(mode)) throw new Error("Unknown mode.");
    const invited = [...new Set([...(opponents ?? []), ...(opponent ? [opponent] : [])])];
    if (invited.length === 0) throw new Error("Pick someone to challenge.");
    if (invited.includes(userId)) throw new Error("You can't challenge yourself.");
    if (invited.length > MODES[mode].players - 1) throw new Error(`${MODES[mode].name} has room for ${MODES[mode].players - 1} opponents.`);
    for (const id of invited) if (!(await ctx.db.get(id))) throw new Error("That player doesn't exist.");
    const mine = await ctx.db
      .query("matches")
      .withIndex("by_creator_status", (q) => q.eq("createdBy", userId).eq("status", "waiting"))
      .collect();
    const sameSet = (m: Doc<"matches">) => m.invited.length === invited.length && invited.every((id) => m.invited.includes(id));
    const alreadySent = mine.find((m) => m.mode === mode && sameSet(m));
    if (alreadySent) return alreadySent._id;
    const id = await create(ctx, userId, mode, invited, settings);
    const name = await displayName(ctx, userId);
    const m = MODES[mode];
    const flexible = flexibleSeats(mode);
    for (const who of invited) {
      const others = await namesOf(
        ctx,
        invited.filter((x) => x !== who),
      );
      const seatsForCrew = flexible ? 0 : m.players - 1 - invited.length;
      const company = others.length
        ? ` with ${listNames(seatsForCrew > 0 ? [...others, `${seatsForCrew} more`] : others)}`
        : seatsForCrew > 0
          ? ` with ${seatsForCrew} more`
          : "";
      await notifyMatch(
        ctx,
        who,
        { _id: id, mode },
        { title: `${name} challenged you`, body: `${capitalize(m.title)}${company}. Tap to accept.`, url: acceptPath({ _id: id, mode }) },
      );
    }
    const match = (await ctx.db.get(id))!;
    if (match.openSeats && !flexible) {
      const free = m.players - 1 - invited.length;
      await pingCrew(
        ctx,
        match,
        `${name} has ${free === 1 ? "a free seat" : `${free} free seats`}`,
        `${capitalize(m.title)} with ${listNames(await namesOf(ctx, invited))}. Tap to join.`,
      );
    }
    return id;
  },
});

export const join = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (isPlayer(match, userId)) return;
    if (match.status !== "waiting")
      throw new Error(match.status === "cancelled" ? "That game was called off." : "That game already started.");
    if (!canJoin(match, userId)) throw new Error(openToCrew(match) ? "That game is full." : "This game is invite-only.");
    await addPlayer(ctx, match, userId);
  },
});

export const decline = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "waiting" || !match.invited.includes(userId) || isPlayer(match, userId))
      throw new Error("There's nothing to decline.");
    const name = await displayName(ctx, userId);
    const mode = modeOf(match);
    if (mode.players === 2) {
      await ctx.db.patch(id, { status: "cancelled", lastActivityAt: Date.now() });
      await notifyMatch(ctx, match.createdBy, match, {
        title: `${name} declined`,
        body: `Your ${mode.title} challenge was turned down.`,
        url: modePath(match.mode as ModeKey),
      });
      return;
    }
    if (flexibleSeats(match.mode)) {
      await ctx.db.patch(id, { invited: match.invited.filter((x) => x !== userId), lastActivityAt: Date.now() });
      await notifyMatch(ctx, match.createdBy, match, { title: `${name} declined`, body: `They're sitting this ${mode.title} game out.` });
      return;
    }
    const invited = match.invited.filter((x) => x !== userId);
    const updated = { ...match, invited, openSeats: true };
    await ctx.db.patch(id, { invited, openSeats: true, lastActivityAt: Date.now() });
    for (const p of match.players) {
      await notifyMatch(ctx, p.userId, match, { title: `${name} declined`, body: "Their seat is open to the crew now." });
    }
    const declinerSkipped = { ...updated, invited: [...invited, userId] };
    await pingCrew(
      ctx,
      declinerSkipped,
      `A seat opened up`,
      `${capitalize(mode.title)} with ${listNames(
        await namesOf(
          ctx,
          match.players.map((p) => p.userId),
        ),
      )}. Tap to join.`,
    );
  },
});

export const leave = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "waiting") return !isPlayer(match, userId);
    if (!isPlayer(match, userId)) return true;
    if (match.createdBy === userId) throw new Error("Cancel the game instead.");
    const invited = match.invited.filter((x) => x !== userId);
    await ctx.db.patch(id, {
      players: match.players.filter((p) => p.userId !== userId),
      invited,
      openSeats: match.invited.length > 0 ? true : match.openSeats,
      lastActivityAt: Date.now(),
    });
    return true;
  },
});

export const cancel = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "waiting" || match.createdBy !== userId) throw new Error("You can only cancel a game you're waiting in.");
    await ctx.db.patch(id, { status: "cancelled", lastActivityAt: Date.now() });
    const name = await displayName(ctx, userId);
    for (const other of opponentsOf(match, userId)) {
      await notifyMatch(ctx, other, match, {
        title: `${name} called it off`,
        body: `The ${modeOf(match).title} game you joined isn't happening.`,
      });
    }
  },
});

export const startGame = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status === "active") return;
    if (match.status !== "waiting" || match.createdBy !== userId) throw new Error("Only the host can start this game.");
    const mode = modeOf(match);
    if (match.players.length < mode.minPlayers) throw new Error(`You need at least ${mode.minPlayers} players.`);
    await start(ctx, match);
  },
});

export const configure = mutation({
  args: { id: v.id("matches"), settings: v.record(v.string(), v.number()) },
  handler: async (ctx, { id, settings }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "waiting" || match.createdBy !== userId) throw new Error("Only the host can change the settings.");
    await ctx.db.patch(id, {
      settings: changedSettings(match.mode, withSeeds(match.mode, { ...settingsOf(match.mode, match.settings), ...settings })),
    });
  },
});

export const resign = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "active" || !isPlayer(match, userId)) throw new Error("You're not in an active game here.");
    await hooksFor(match.mode).resign(ctx, match, userId);
  },
});

export const offerDraw = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "active" || !isPlayer(match, userId)) throw new Error("You're not in an active game here.");
    if (!allowsDraws(match.mode)) throw new Error("There are no draws in this game.");
    if (match.drawOffer === userId) return;
    if (match.drawOffer && match.drawOffer !== userId) {
      await finish(ctx, match, { winners: [], draw: true, reason: "agreement" });
      return;
    }
    await ctx.db.patch(id, { drawOffer: userId });
    const name = await displayName(ctx, userId);
    for (const other of opponentsOf(match, userId)) {
      await notifyMatch(ctx, other, match, { title: `${name} offered a draw`, body: "Tap to accept or keep playing." });
    }
  },
});

export const declineDraw = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "active" || !isPlayer(match, userId) || !match.drawOffer || match.drawOffer === userId) return;
    await ctx.db.patch(id, { drawOffer: undefined });
  },
});

export const REMATCH_TTL_MS = 2 * 60 * 1000;

function seatsMovedOneAlong(match: Doc<"matches">) {
  const colors = hooksFor(match.mode).seats(match.mode as ModeKey, match.players.length);
  return colors.map((_, i) => ({ userId: match.players.find((p) => p.color === colors[(i + 1) % colors.length])!.userId }));
}

export const rematch = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "finished" || !isPlayer(match, userId)) throw new Error("You can only rematch a game you just played.");
    const offer = match.rematch;
    if (offer?.status === "accepted") return offer.matchId!;
    const live = offer?.status === "pending" && Date.now() - offer.at < REMATCH_TTL_MS;
    const yes = live ? (offer!.yes ?? [offer!.by]) : [];
    if (yes.includes(userId)) return null;
    const votes = [...yes, userId];
    const everyoneSaidYes = live && match.players.every((p) => votes.includes(p.userId));
    if (everyoneSaidYes) {
      const now = Date.now();
      const settings = changedSettings(match.mode, withSeeds(match.mode, match.settings, true));
      const order = seatsMovedOneAlong(match);
      const newId = await ctx.db.insert("matches", {
        mode: match.mode,
        status: "waiting",
        createdBy: offer!.by,
        players: order,
        invited: [],
        ...(Object.keys(settings).length ? { settings } : {}),
        state: null,
        moveCount: 0,
        lastActivityAt: now,
        rematchOf: id,
      });
      await start(ctx, (await ctx.db.get(newId))!, "as seated");
      await ctx.db.patch(id, { rematch: { ...offer!, yes: votes, status: "accepted", matchId: newId } });
      return newId;
    }
    await ctx.db.patch(id, { rematch: live ? { ...offer!, yes: votes } : { by: userId, yes: votes, at: Date.now(), status: "pending" } });
    return null;
  },
});

export const answerRematch = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (!isPlayer(match, userId) || match.rematch?.status !== "pending") return;
    await ctx.db.patch(id, { rematch: { ...match.rematch, status: "declined" } });
  },
});

export const get = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    if ((await getAuthUserId(ctx)) === null) return null;
    const id = ctx.db.normalizeId("matches", args.id);
    const match = id && (await ctx.db.get(id));
    return match ? await withPeople(ctx, match) : null;
  },
});

export const lobby = query({
  args: { mode: v.string() },
  handler: async (ctx, { mode }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const byStatus = (status: Doc<"matches">["status"]) =>
      ctx.db
        .query("matches")
        .withIndex("by_mode_status", (q) => q.eq("mode", mode).eq("status", status))
        .collect();
    const [waiting, active, finished] = await Promise.all([byStatus("waiting"), byStatus("active"), byStatus("finished")]);
    const recent = finished.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, 10);
    const views = async (ms: Doc<"matches">[]) => Promise.all(ms.map((m) => withPeople(ctx, m)));
    return {
      mine: await views(active.filter((m) => isPlayer(m, userId)).sort((a, b) => b.lastActivityAt - a.lastActivityAt)),
      waiting: await views(waiting.filter((m) => isPlayer(m, userId))),
      open: await views(waiting.filter((m) => !m.invited.includes(userId) && canJoin(m, userId))),
      live: await views(active.filter((m) => !isPlayer(m, userId))),
      recent: await views(recent),
    };
  },
});

export const recent = query({
  args: { game: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { game, limit }) => {
    if ((await getAuthUserId(ctx)) === null) return [];
    const finished = await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "finished"))
      .collect();
    const ofGame = finished.filter((m) => MODES[m.mode as ModeKey]?.game === game).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    return Promise.all(ofGame.slice(0, limit ?? 10).map((m) => withPeople(ctx, m)));
  },
});

export const attention = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { myTurn: 0, invites: 0 };
    const active = await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const waiting = await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .collect();
    return {
      myTurn: active.filter((m) => awaits(m, userId)).length,
      invites: waiting.filter((m) => m.invited.includes(userId) && !isPlayer(m, userId)).length,
    };
  },
});

export const inbox = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const active = await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const waiting = await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .collect();
    const views = async (ms: Doc<"matches">[]) =>
      Promise.all(ms.sort((a, b) => b.lastActivityAt - a.lastActivityAt).map((m) => withPeople(ctx, m)));
    const mineActive = active.filter((m) => isPlayer(m, userId));
    const realtime = (m: Doc<"matches">) => modeOf(m)?.kind === "realtime";
    return {
      invites: await views(waiting.filter((m) => m.invited.includes(userId) && !isPlayer(m, userId))),
      myTurn: await views(mineActive.filter((m) => !realtime(m) && awaits(m, userId))),
      live: await views(mineActive.filter(realtime)),
      theirTurn: await views(mineActive.filter((m) => !realtime(m) && !awaits(m, userId))),
      open: await views(waiting.filter((m) => !m.invited.includes(userId) && canJoin(m, userId))),
      waiting: await views(waiting.filter((m) => isPlayer(m, userId))),
      watch: await views(active.filter((m) => !isPlayer(m, userId))),
    };
  },
});
