import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { MODES, REALTIME_LOBBY_MS, REMINDER_MS, acceptPath, isMode, matchPath, modePath, type ModeKey } from "./modes";
import { displayName, isTestUser, notify } from "./notify";
import { placesOf, recordResult } from "./ratings";
import { initialState, onStart, resignRealtime4, retireFour, seatColors } from "./chess";
import { DEFAULT_PROFILE } from "./profileOptions";

async function me(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in first.");
  return userId;
}

export async function loadMatch(ctx: QueryCtx, id: Id<"matches">) {
  const match = await ctx.db.get(id);
  if (!match) throw new Error("That game doesn't exist.");
  return match;
}

const modeOf = (match: Doc<"matches">) => MODES[match.mode as ModeKey];
const isPlayer = (match: Doc<"matches">, userId: Id<"users">) => match.players.some((p) => p.userId === userId);
const opponentsOf = (match: Doc<"matches">, userId: Id<"users">) => match.players.filter((p) => p.userId !== userId).map((p) => p.userId);
// Anyone may take a seat: an open lobby, or a challenge with seats left over for the crew.
const isOpen = (match: Doc<"matches">) => match.invited.length === 0 || match.openSeats === true;
// Seats nobody has claimed: invited players who haven't answered yet keep theirs.
const freeSeats = (match: Doc<"matches">) => modeOf(match).players - match.players.length - match.invited.filter((id) => !isPlayer(match, id)).length;
const canJoin = (match: Doc<"matches">, userId: Id<"users">) =>
  !isPlayer(match, userId) && (match.invited.includes(userId) || (isOpen(match) && freeSeats(match) > 0));

// "Chris", "Chris and Sam", "Chris, Sam and Alex".
export function listNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "nobody";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
const namesOf = async (ctx: QueryCtx, ids: Id<"users">[]) => Promise.all(ids.map(async (id) => (await ctx.db.get(id))?.name ?? "Someone"));

// Players with their Discord name, avatar, and card cosmetics, for rendering a match.
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

// --- Lifecycle ---

// `keepOrder` keeps seat order (seat 0 moves first); otherwise colors are shuffled.
async function start(ctx: MutationCtx, match: Doc<"matches">, keepOrder = false) {
  const now = Date.now();
  const seats = [...match.players];
  if (!keepOrder) {
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seats[i], seats[j]] = [seats[j], seats[i]];
    }
  }
  const colors = seatColors(match.mode as ModeKey);
  const players = seats.map((p, i) => ({ ...p, color: colors[i] }));
  const patch = { status: "active" as const, players, startedAt: now, lastActivityAt: now, state: initialState(match.mode as ModeKey), moveCount: 0 };
  await ctx.db.patch(match._id, patch);
  const started = { ...match, ...patch };
  await onStart(ctx, started);
}

export async function finish(ctx: MutationCtx, match: Doc<"matches">, result: NonNullable<Doc<"matches">["result"]>) {
  if (match.status !== "active") return;
  const ended = { ...match, status: "finished" as const, result, endedAt: Date.now(), drawOffer: undefined, turn: undefined };
  const ratingChanges = await recordResult(ctx, ended);
  await ctx.db.patch(match._id, { status: "finished", result, endedAt: ended.endedAt, drawOffer: undefined, turn: undefined, ratingChanges, lastActivityAt: ended.endedAt });
  const mode = modeOf(match);
  const places = placesOf(ended);
  for (const p of match.players) {
    const change = ratingChanges.find((c) => c.userId === p.userId);
    const delta = change ? change.after - change.before : 0;
    const swing = change ? ` (${delta >= 0 ? "+" : ""}${delta})` : "";
    const place = places.findIndex((g) => g.includes(p.userId));
    const title =
      match.players.length > 2
        ? place === 0 ? (places[0].length > 1 ? "You tied for first" : "You won") : `You placed ${ordinal(place + 1)}`
        : result.draw ? "Draw" : result.winners.includes(p.userId) ? "You won" : "You lost";
    const others = listNames(await namesOf(ctx, opponentsOf(match, p.userId)));
    await notify(ctx, p.userId, {
      title: `${title}${swing}`,
      body: `${capitalize(mode.title)} vs ${others}: ${describeReason(result.reason, match.mode)}.`,
      url: matchPath(match._id),
      tag: `match:${match._id}`,
    });
  }
}

export const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

export function describeReason(reason: string, mode?: string) {
  if (reason === "fifty" && mode === "chess:four") return "fifty quiet rounds";
  return (
    {
      last_player: "last one standing",
      last_king: "last king standing",
      timeout: "timed out",
      checkmate: "checkmate",
      resign: "resignation",
      stalemate: "stalemate",
      repetition: "threefold repetition",
      insufficient: "insufficient material",
      fifty: "fifty-move rule",
      agreement: "draw agreed",
      king: "king captured",
      both_kings: "both kings fell at once",
      no_progress: "90 seconds with no captures or pawn moves",
    }[reason] ?? reason
  );
}

// Re-arms the "it's your move" reminder. Each reminder checks the move count it was set for, so old ones
// fizzle out on their own instead of needing to be cancelled.
export async function scheduleReminder(ctx: MutationCtx, matchId: Id<"matches">, moveCount: number, strikes = 0) {
  await ctx.scheduler.runAfter(REMINDER_MS, internal.matches.remind, { id: matchId, moveCount, strikes });
}

// In four-player, one player sitting on their move holds up three others, so after this many reminders
// (two days) they time out and the game moves on.
export const TIMEOUT_STRIKES = 6;

export const remind = internalMutation({
  args: { id: v.id("matches"), moveCount: v.number(), strikes: v.optional(v.number()) },
  handler: async (ctx, { id, moveCount, strikes = 0 }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active" || match.moveCount !== moveCount || !match.turn) return;
    const multi = match.players.length > 2;
    if (multi && strikes + 1 >= TIMEOUT_STRIKES) {
      await retireFour(ctx, match, match.turn, "timeout");
      return;
    }
    const others = listNames(await namesOf(ctx, opponentsOf(match, match.turn)));
    const left = multi && strikes + 2 === TIMEOUT_STRIKES ? " Move in the next 8 hours or you time out." : "";
    await notify(ctx, match.turn, {
      title: "Still your move",
      body: `${others} ${multi ? "are" : "is"} waiting on you in ${modeOf(match).title}.${left}`,
      url: matchPath(id),
      tag: `match:${id}`,
    });
    await scheduleReminder(ctx, id, moveCount, strikes + 1);
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;
// A real-time game whose board nobody opened within this long after both seats filled is called off.
const UNSTARTED_MS = 3 * 60 * 1000;

// Tidies up every few minutes (see crons.ts): duplicate and stale challenges, and real-time games that
// never started.
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const waiting = await ctx.db.query("matches").withIndex("by_status", (q) => q.eq("status", "waiting")).collect();
    const seen = new Set<string>();
    for (const m of waiting.sort((a, b) => b._creationTime - a._creationTime)) {
      const key = `${m.createdBy}:${m.mode}:${[...m.invited].sort().join(",")}`;
      const duplicate = m.invited.length > 0 && seen.has(key);
      seen.add(key);
      const stale = now - m._creationTime > DAY_MS || (MODES[m.mode as ModeKey]?.kind === "realtime" && now - m._creationTime > REALTIME_LOBBY_MS);
      if (duplicate || stale) await ctx.db.patch(m._id, { status: "cancelled", lastActivityAt: now });
    }
    const active = await ctx.db.query("matches").withIndex("by_status", (q) => q.eq("status", "active")).collect();
    for (const m of active) {
      if (MODES[m.mode as ModeKey]?.kind !== "realtime" || m.state?.startAt !== null) continue;
      if (now - (m.startedAt ?? m._creationTime) > UNSTARTED_MS) await ctx.db.patch(m._id, { status: "cancelled", lastActivityAt: now });
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

async function create(ctx: MutationCtx, userId: Id<"users">, mode: ModeKey, invited: Id<"users">[], rematchOf?: Id<"matches">) {
  const now = Date.now();
  const id = await ctx.db.insert("matches", {
    mode,
    status: "waiting",
    createdBy: userId,
    players: [{ userId }],
    invited,
    // Invite fewer players than there are seats and the rest are open to the crew.
    openSeats: invited.length > 0 && invited.length < MODES[mode].players - 1 ? true : undefined,
    state: null,
    moveCount: 0,
    lastActivityAt: now,
    rematchOf,
  });
  if (MODES[mode].kind === "realtime") await ctx.scheduler.runAfter(REALTIME_LOBBY_MS, internal.matches.expireLobby, { id });
  return id;
}

async function addPlayer(ctx: MutationCtx, match: Doc<"matches">, userId: Id<"users">) {
  const players = [...match.players, { userId }];
  await ctx.db.patch(match._id, { players, lastActivityAt: Date.now() });
  const updated = { ...match, players };
  const name = await displayName(ctx, userId);
  const mode = modeOf(match);
  const full = players.length >= mode.players;
  for (const p of match.players) {
    await notify(ctx, p.userId, {
      title: full ? `${name} joined` : `${name} joined (${players.length}/${mode.players})`,
      body: !full ? `Waiting for ${mode.players - players.length} more.` : mode.kind === "realtime" ? `Your ${mode.title} game is ready. Tap to play.` : `Your ${mode.title} game is on.`,
      url: matchPath(match._id),
      tag: `match:${match._id}`,
    });
  }
  if (full) await start(ctx, updated);
}

// Tells everyone not already in or invited that there's a seat for them.
async function pingCrew(ctx: MutationCtx, match: Doc<"matches">, title: string, body: string) {
  // Test players never ping the crew.
  if (await isTestUser(ctx, match.createdBy)) return;
  for (const u of await ctx.db.query("users").collect()) {
    if (isPlayer(match, u._id) || match.invited.includes(u._id)) continue;
    await notify(ctx, u._id, { title, body, url: acceptPath(match._id), tag: `lobby:${match._id}` });
  }
}

// --- Lobby ---

// Joins the oldest open game of this mode someone else is waiting in, or opens a new one and tells the crew.
export const queue = mutation({
  args: { mode: v.string() },
  handler: async (ctx, { mode }) => {
    const userId = await me(ctx);
    if (!isMode(mode)) throw new Error("Unknown mode.");
    const waiting = await ctx.db
      .query("matches")
      .withIndex("by_mode_status", (q) => q.eq("mode", mode).eq("status", "waiting"))
      .collect();
    const mine = waiting.find((m) => isPlayer(m, userId));
    if (mine) return mine._id;
    const open = waiting.find((m) => isOpen(m) && canJoin(m, userId));
    if (open) {
      await addPlayer(ctx, open, userId);
      return open._id;
    }
    const id = await create(ctx, userId, mode, []);
    const name = await displayName(ctx, userId);
    const m = MODES[mode];
    const title = mode === "chess:classic" ? `${name} wants a game of chess` : `${name} wants ${m.title}`;
    const body =
      m.kind === "realtime"
        ? `Jump in now, it starts when ${m.players > 2 ? `all ${m.players}` : "you both"} get there.`
        : m.players > 2 ? `${m.players - 1} seats open. Tap to take one.` : "Tap to take the other seat.";
    await pingCrew(ctx, (await ctx.db.get(id))!, title, body);
    return id;
  },
});

// Invites specific players. Four-player games can invite fewer than three; the leftover seats are open to
// the crew.
export const challenge = mutation({
  args: { mode: v.string(), opponent: v.optional(v.id("users")), opponents: v.optional(v.array(v.id("users"))), rematchOf: v.optional(v.id("matches")) },
  handler: async (ctx, { mode, opponent, opponents, rematchOf }) => {
    const userId = await me(ctx);
    if (!isMode(mode)) throw new Error("Unknown mode.");
    const invited = [...new Set([...(opponents ?? []), ...(opponent ? [opponent] : [])])];
    if (invited.length === 0) throw new Error("Pick someone to challenge.");
    if (invited.includes(userId)) throw new Error("You can't challenge yourself.");
    if (invited.length > MODES[mode].players - 1) throw new Error(`${MODES[mode].name} has room for ${MODES[mode].players - 1} opponents.`);
    for (const id of invited) if (!(await ctx.db.get(id))) throw new Error("That player doesn't exist.");
    // Asking twice (a double tap, a slow network) returns the challenge that's already waiting.
    // Only my own waiting games, so challenges between other players can't conflict with this one.
    const mine = await ctx.db
      .query("matches")
      .withIndex("by_creator_status", (q) => q.eq("createdBy", userId).eq("status", "waiting"))
      .collect();
    const sameSet = (m: Doc<"matches">) => m.invited.length === invited.length && invited.every((id) => m.invited.includes(id));
    const existing = mine.find((m) => m.mode === mode && sameSet(m));
    if (existing) return existing._id;
    const id = await create(ctx, userId, mode, invited, rematchOf);
    const name = await displayName(ctx, userId);
    const m = MODES[mode];
    for (const who of invited) {
      const others = await namesOf(ctx, invited.filter((x) => x !== who));
      const free = m.players - 1 - invited.length;
      const with_ = others.length ? ` with ${listNames(free > 0 ? [...others, `${free} more`] : others)}` : free > 0 ? ` with ${free} more` : "";
      await notify(ctx, who, {
        title: `${name} challenged you`,
        body: `${capitalize(m.title)}${with_}. Tap to accept.`,
        url: acceptPath(id),
        tag: `match:${id}`,
      });
    }
    const match = (await ctx.db.get(id))!;
    if (match.openSeats) {
      const free = m.players - 1 - invited.length;
      await pingCrew(ctx, match, `${name} has ${free === 1 ? "a free seat" : `${free} free seats`}`, `${capitalize(m.title)} with ${listNames(await namesOf(ctx, invited))}. Tap to join.`);
    }
    return id;
  },
});

export const join = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await me(ctx);
    const match = await loadMatch(ctx, id);
    if (isPlayer(match, userId)) return;
    if (match.status !== "waiting") throw new Error(match.status === "cancelled" ? "That game was called off." : "That game already started.");
    if (!canJoin(match, userId)) throw new Error(isOpen(match) ? "That game is full." : "This game is invite-only.");
    await addPlayer(ctx, match, userId);
  },
});

export const decline = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await me(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "waiting" || !match.invited.includes(userId) || isPlayer(match, userId)) throw new Error("There's nothing to decline.");
    const name = await displayName(ctx, userId);
    const mode = modeOf(match);
    if (mode.players === 2) {
      await ctx.db.patch(id, { status: "cancelled", lastActivityAt: Date.now() });
      await notify(ctx, match.createdBy, { title: `${name} declined`, body: `Your ${mode.title} challenge was turned down.`, url: modePath(match.mode as ModeKey), tag: `match:${id}` });
      return;
    }
    // In a bigger game one "no" doesn't sink it: their seat opens up to the crew.
    const invited = match.invited.filter((x) => x !== userId);
    const updated = { ...match, invited, openSeats: true };
    await ctx.db.patch(id, { invited, openSeats: true, lastActivityAt: Date.now() });
    for (const p of match.players) {
      await notify(ctx, p.userId, { title: `${name} declined`, body: "Their seat is open to the crew now.", url: matchPath(id), tag: `match:${id}` });
    }
    await pingCrew(ctx, { ...updated, invited: [...invited, userId] }, `A seat opened up`, `${capitalize(mode.title)} with ${listNames(await namesOf(ctx, match.players.map((p) => p.userId)))}. Tap to join.`);
  },
});

// Give up a seat you took in someone else's lobby before it fills.
export const leave = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await me(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "waiting" || !isPlayer(match, userId)) return;
    if (match.createdBy === userId) throw new Error("Cancel the game instead.");
    // Leaving an invite you'd accepted counts as declining it, so your seat opens up.
    const invited = match.invited.filter((x) => x !== userId);
    await ctx.db.patch(id, {
      players: match.players.filter((p) => p.userId !== userId),
      invited,
      openSeats: match.invited.length > 0 ? true : match.openSeats,
      lastActivityAt: Date.now(),
    });
  },
});

// Leave a lobby you opened before it fills. Everyone who joined is let go.
export const cancel = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await me(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "waiting" || match.createdBy !== userId) throw new Error("You can only cancel a game you're waiting in.");
    await ctx.db.patch(id, { status: "cancelled", lastActivityAt: Date.now() });
    const name = await displayName(ctx, userId);
    for (const other of opponentsOf(match, userId)) {
      await notify(ctx, other, { title: `${name} called it off`, body: `The ${modeOf(match).title} game you joined isn't happening.`, url: matchPath(id), tag: `match:${id}` });
    }
  },
});

export const resign = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await me(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "active" || !isPlayer(match, userId)) throw new Error("You're not in an active game here.");
    if (match.mode === "chess:four") return await retireFour(ctx, match, userId, "resign");
    if (match.mode === "chess:realtime4") {
      // Before the clock starts there's no game to leave behind, so it's called off for everyone.
      if (!(await resignRealtime4(ctx, match, userId))) await ctx.db.patch(id, { status: "cancelled", lastActivityAt: Date.now() });
      return;
    }
    await finish(ctx, match, { winners: opponentsOf(match, userId), draw: false, reason: "resign" });
  },
});

export const offerDraw = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await me(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "active" || !isPlayer(match, userId)) throw new Error("You're not in an active game here.");
    if (match.players.length > 2) throw new Error("There are no draws in 4-player chess.");
    if (match.drawOffer && match.drawOffer !== userId) {
      await finish(ctx, match, { winners: [], draw: true, reason: "agreement" });
      return;
    }
    await ctx.db.patch(id, { drawOffer: userId });
    const name = await displayName(ctx, userId);
    for (const other of opponentsOf(match, userId)) {
      await notify(ctx, other, { title: `${name} offered a draw`, body: "Tap to accept or keep playing.", url: matchPath(id), tag: `match:${id}` });
    }
  },
});

export const declineDraw = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await me(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "active" || !isPlayer(match, userId) || !match.drawOffer || match.drawOffer === userId) return;
    await ctx.db.patch(id, { drawOffer: undefined });
  },
});

// --- Rematches ---
//
// Rematches happen in place on the finished game, with everyone still looking at it, so there are no
// pushes. Every player has to say yes. Leaving the page declines (the client calls answerRematch on the
// way out), and an offer that sits too long lapses.

export const REMATCH_TTL_MS = 2 * 60 * 1000;

export const rematch = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await me(ctx);
    const match = await loadMatch(ctx, id);
    if (match.status !== "finished" || !isPlayer(match, userId)) throw new Error("You can only rematch a game you just played.");
    const offer = match.rematch;
    if (offer?.status === "accepted") return offer.matchId!;
    const live = offer?.status === "pending" && Date.now() - offer.at < REMATCH_TTL_MS;
    const yes = live ? (offer!.yes ?? [offer!.by]) : [];
    if (yes.includes(userId)) return null;
    const votes = [...yes, userId];
    if (live && match.players.every((p) => votes.includes(p.userId))) {
      // Everyone's in: same players, colors moved one seat along (in two-player, swapped).
      const now = Date.now();
      const colors = seatColors(match.mode as ModeKey);
      const order = colors.map((_, i) => ({ userId: match.players.find((p) => p.color === colors[(i + 1) % colors.length])!.userId }));
      const newId = await ctx.db.insert("matches", {
        mode: match.mode,
        status: "waiting",
        createdBy: offer!.by,
        players: order,
        invited: [],
        state: null,
        moveCount: 0,
        lastActivityAt: now,
        rematchOf: id,
      });
      await start(ctx, (await ctx.db.get(newId))!, true);
      await ctx.db.patch(id, { rematch: { ...offer!, yes: votes, status: "accepted", matchId: newId } });
      return newId;
    }
    await ctx.db.patch(id, { rematch: live ? { ...offer!, yes: votes } : { by: userId, yes: votes, at: Date.now(), status: "pending" } });
    return null;
  },
});

// "No thanks", leaving the page, or the asker cancelling.
export const answerRematch = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await me(ctx);
    const match = await loadMatch(ctx, id);
    if (!isPlayer(match, userId) || match.rematch?.status !== "pending") return;
    await ctx.db.patch(id, { rematch: { ...match.rematch, status: "declined" } });
  },
});

// --- Queries ---

export const get = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    if ((await getAuthUserId(ctx)) === null) return null;
    const match = await ctx.db.get(id);
    return match ? await withPeople(ctx, match) : null;
  },
});

// Everything the Chess screen needs for one mode.
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
      invites: await views(waiting.filter((m) => m.invited.includes(userId) && !isPlayer(m, userId))),
      open: await views(waiting.filter((m) => !m.invited.includes(userId) && canJoin(m, userId))),
      live: await views(active.filter((m) => !isPlayer(m, userId))),
      recent: await views(recent),
    };
  },
});

// For badges: async games waiting on me, plus challenges and lobbies I could join.
export const attention = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { myTurn: 0, invites: 0, open: 0 };
    const active = await ctx.db.query("matches").withIndex("by_status", (q) => q.eq("status", "active")).collect();
    const waiting = await ctx.db.query("matches").withIndex("by_status", (q) => q.eq("status", "waiting")).collect();
    return {
      myTurn: active.filter((m) => m.turn === userId).length,
      invites: waiting.filter((m) => m.invited.includes(userId) && !isPlayer(m, userId)).length,
      open: waiting.filter((m) => !m.invited.includes(userId) && canJoin(m, userId)).length,
    };
  },
});

// Everything that wants me, across every mode, for the home screen: challenges to answer, games where
// it's my move, real-time games about to start, lobbies with a free seat, and games I'm waiting on.
export const inbox = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const active = await ctx.db.query("matches").withIndex("by_status", (q) => q.eq("status", "active")).collect();
    const waiting = await ctx.db.query("matches").withIndex("by_status", (q) => q.eq("status", "waiting")).collect();
    const views = async (ms: Doc<"matches">[]) => Promise.all(ms.sort((a, b) => b.lastActivityAt - a.lastActivityAt).map((m) => withPeople(ctx, m)));
    const mineActive = active.filter((m) => isPlayer(m, userId));
    const realtime = (m: Doc<"matches">) => modeOf(m)?.kind === "realtime";
    return {
      invites: await views(waiting.filter((m) => m.invited.includes(userId) && !isPlayer(m, userId))),
      myTurn: await views(mineActive.filter((m) => m.turn === userId)),
      live: await views(mineActive.filter(realtime)),
      theirTurn: await views(mineActive.filter((m) => !realtime(m) && m.turn !== userId)),
      open: await views(waiting.filter((m) => !m.invited.includes(userId) && canJoin(m, userId))),
      waiting: await views(waiting.filter((m) => isPlayer(m, userId))),
    };
  },
});

