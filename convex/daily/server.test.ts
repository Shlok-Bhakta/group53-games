import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { setup, signedIn } from "../test.setup";
import { board, ranked, streakOf } from "./standings";

type T = ReturnType<typeof setup>;
const pushes = async (t: T) =>
  (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()))
    .filter((s) => s.name === "push:sendToUser" && s.state.kind === "pending")
    .map((s) => s.args[0] as { userId: string; title: string; body: string; url: string; tag: string });

const DAY = "2026-11-20";
const scrandle = (right: number, date = DAY) =>
  `${"🟩".repeat(right)}${"🟥".repeat(10 - right)} ${right}/10 | ${date} | https://scrandle.com`;
const framed = (n: number, guess: number) =>
  `Framed #${n}\n🎥 ${["🟥", "🟥", "🟥", "🟥", "🟥", "🟥"].map((s, i) => (i === guess - 1 ? "🟩" : s)).join(" ")}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${DAY}T18:00:00Z`));
});
afterEach(() => vi.useRealTimers());

describe("posting", () => {
  test("a result shows on today's board, ranked, and pushes only the people it beat", async () => {
    const t = setup();
    const shlok = await signedIn(t, "Shlok");
    const chris = await signedIn(t, "Chris");
    const sam = await signedIn(t, "Sam");
    await chris.as.mutation(api.daily.post, { text: scrandle(6), day: DAY });
    await sam.as.mutation(api.daily.post, { text: scrandle(9), day: DAY });
    expect((await pushes(t)).map((p) => p.userId)).toEqual([chris.userId]);
    const r = await shlok.as.mutation(api.daily.post, { text: scrandle(8), day: DAY });
    expect(r).toMatchObject({ game: "scrandle", display: "8/10" });
    expect((await pushes(t)).filter((p) => p.title === "Shlok beat your Scrandle")).toEqual([
      expect.objectContaining({ userId: chris.userId, body: "8/10 vs your 6/10", url: "/daily/scrandle", tag: `daily:scrandle:${DAY}` }),
    ]);
    const [round] = await shlok.as.query(api.daily.today, { day: DAY });
    expect(round.entries.map((e) => [e.display, e.place])).toEqual([
      ["9/10", 1],
      ["8/10", 2],
      ["6/10", 3],
    ]);
  });

  test("a double tap posts once, a second result for today is refused, and so is a puzzle already posted", async () => {
    const t = setup();
    const me = await signedIn(t);
    const a = await me.as.mutation(api.daily.post, { text: framed(1715, 2), day: DAY });
    const b = await me.as.mutation(api.daily.post, { text: framed(1715, 2), day: DAY });
    expect(b.id).toBe(a.id);
    await expect(me.as.mutation(api.daily.post, { text: framed(1715, 1), day: DAY })).rejects.toThrow("already posted today's Framed");
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    await expect(me.as.mutation(api.daily.post, { text: framed(1715, 1), day: "2026-11-21" })).rejects.toThrow(
      "already posted Framed #1715",
    );
    await me.as.mutation(api.daily.post, { text: framed(1716, 4), day: "2026-11-21" });
  });

  test("an old puzzle, a far-off date, a stranger's text and a signed-out post are refused", async () => {
    const t = setup();
    const me = await signedIn(t);
    await expect(me.as.mutation(api.daily.post, { text: scrandle(10, "2026-11-11"), day: DAY })).rejects.toThrow(
      "That's Scrandle for 2026-11-11",
    );
    await expect(me.as.mutation(api.daily.post, { text: scrandle(7), day: "2026-11-25" })).rejects.toThrow("date looks off");
    await expect(me.as.mutation(api.daily.post, { text: "Wordle 1,250 3/6", day: DAY })).rejects.toThrow("daily we know");
    await expect(t.mutation(api.daily.post, { text: scrandle(7), day: DAY })).rejects.toThrow("Sign in");
  });

  test("you can remove your own result and nobody else's", async () => {
    const t = setup();
    const me = await signedIn(t, "Shlok");
    const them = await signedIn(t, "Chris");
    const { id } = await me.as.mutation(api.daily.post, { text: scrandle(7), day: DAY });
    await expect(them.as.mutation(api.daily.remove, { id })).rejects.toThrow("someone else's");
    await me.as.mutation(api.daily.remove, { id });
    expect(await me.as.query(api.daily.today, { day: DAY })).toEqual([]);
    await me.as.mutation(api.daily.post, { text: scrandle(9), day: DAY });
  });
});

describe("boards", () => {
  test("the week counts crowns only where someone else played, and history lists each day", async () => {
    const t = setup();
    const shlok = await signedIn(t, "Shlok");
    const chris = await signedIn(t, "Chris");
    const earlier = (userId: typeof shlok.userId, right: number, day: string) =>
      t.run((ctx) =>
        ctx.db.insert("dailyResults", {
          userId,
          game: "scrandle",
          day,
          score: right,
          display: `${right}/10`,
          solved: true,
          text: scrandle(right, day),
          at: Date.parse(day),
        }),
      );
    await earlier(shlok.userId, 8, "2026-11-18");
    await earlier(shlok.userId, 8, "2026-11-19");
    await earlier(chris.userId, 9, "2026-11-19");
    await shlok.as.mutation(api.daily.post, { text: scrandle(8), day: DAY });
    await chris.as.mutation(api.daily.post, { text: scrandle(5), day: DAY });
    const week = await shlok.as.query(api.daily.week, { day: DAY });
    expect(week).toEqual([
      { userId: shlok.userId, crowns: 1, played: 3, streak: 3 },
      { userId: chris.userId, crowns: 1, played: 2, streak: 2 },
    ]);
    const history = await shlok.as.query(api.daily.history, { game: "scrandle", day: DAY });
    expect(history!.days.map((d) => [d.day, d.entries.length])).toEqual([
      [DAY, 2],
      ["2026-11-19", 2],
      ["2026-11-18", 1],
    ]);
    expect(await t.query(api.daily.today, { day: DAY })).toEqual([]);
  });

  test("ties share a place, and a streak survives until you miss a whole day", () => {
    expect(
      ranked([
        { score: 5, at: 1 },
        { score: 7, at: 2 },
        { score: 5, at: 3 },
      ]).map((r) => r.place),
    ).toEqual([1, 2, 2]);
    const days = new Set(["2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(streakOf(days, "2026-11-20")).toBe(3);
    expect(streakOf(days, "2026-11-21")).toBe(0);
    expect(board([], DAY, DAY)).toEqual([]);
  });
});
