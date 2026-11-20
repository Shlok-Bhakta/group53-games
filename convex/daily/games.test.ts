import { describe, expect, test } from "vitest";
import { DAILY_GAMES, parseShare } from "./games";

const parsed = (text: string) => {
  const p = parseShare(text);
  return p && { game: p.game, puzzle: p.puzzle, date: p.date, display: p.display, solved: p.solved, score: p.score };
};

describe("share texts", () => {
  test.each([
    ["🟩🟩🟥🟥🟩🟩🟩🟥🟥🟩 6/10 | 2026-11-20 | https://scrandle.com", { game: "scrandle", date: "2026-11-20", display: "6/10", score: 6 }],
    ["Krillion #128 🦐\n375\n\n🐟🏮🐟🐟🐟🏮🏮", { game: "krillion", puzzle: 128, display: "375", score: 375 }],
    ["Krillion #126 🦐\n165\n\n⬛⬛🏮🫧🫧🐟🐟\n\nhttps://krillion.io", { game: "krillion", puzzle: 126, score: 165 }],
    [
      "Connections\nPuzzle #1258\n🟪🟪🟪🟪\n🟦🟦🟦🟦\n🟨🟨🟨🟨\n🟩🟩🟩🟩",
      { game: "connections", puzzle: 1258, display: "Perfect", solved: true },
    ],
    [
      "Connections\nPuzzle #1174\n🟪🟪🟪🟪\n🟨🟨🟨🟨\n🟦🟦🟩🟦\n🟦🟩🟦🟦\n🟩🟦🟩🟦\n🟦🟩🟩🟦",
      { game: "connections", display: "2/4", solved: false },
    ],
    ["Strands #155\n“Rolling in it”\n🔵💡🔵🔵\n🔵🟡🔵", { game: "strands", puzzle: 155, display: "1 hint" }],
    [
      "https://www.nytimes.com/badges/games/mini.html?d=2023-09-20&t=45&c=331dae2547479cf84166f5902ed02fbf&smid=url-share",
      { game: "mini", date: "2023-09-20", display: "0:45" },
    ],
    ["Framed #1018\n🎥 🟥 🟥 🟩 ⬛ ⬛ ⬛\n\nhttps://framed.wtf", { game: "framed", puzzle: 1018, display: "3/6", solved: true }],
    ["Framed #1476\n🎥 🟥 🟥 🟥 🟥 🟥 🟥\n\nhttps://framed.wtf", { game: "framed", display: "X/6", solved: false }],
    [
      "🌎 Nov 14, 2026 🌍\n🔥 3 | Avg. Guesses: 10.26\n⬜🟨🟨🟨🟥🟧🟧🟥\n🟥🟥🟥🟥🟩 = 13\n\nhttps://globle-game.com/\n#globle",
      { game: "globle", date: "2026-11-14", display: "13" },
    ],
    [
      "#Worldle #1762 (18.11.2026) 1/6 (100%)\n🔥 Current Win Streak: 3 days\n🟩🟩🟩🟩🟩🎉\n\nhttps://worldle.teuteuf.fr/share",
      { game: "worldle", puzzle: 1762, date: "2026-11-18", display: "1/6" },
    ],
    ["#Worldle #1761 (17.11.2026) X/6 (93%)\n🟩🟩🟨⬜⬜↘️", { game: "worldle", display: "X/6", solved: false }],
    ["Costcodle #1147 4/6\n⬇️🟨\n⬇️🟨\n⬆️🟨\n✅\nhttps://costcodle.com", { game: "costcodle", puzzle: 1147, display: "4/6" }],
    ["Costcodle Classic #1158 3/6\n⬇️🟥\n⬆️🟨\n✅\n\nPlay now at https://www.costcodle.com", { game: "costcodle", display: "3/6" }],
    [
      "Bandle #1555 5/6\n⬛⬛🟥🟥🟩⬜\nFound: 207/207 (100%)\nCurrent Streak: 191 (max 191)\n#Bandle \nhttps://bandle.app",
      { game: "bandle", puzzle: 1555, display: "5/6" },
    ],
    ["Bandle #1449 x/6\n⬛🟥⬛⬛⬛🟥\nFound: 823/848 (97.1%)", { game: "bandle", display: "X/6", solved: false }],
    [
      "I played contexto.me 11/19/2026 and got it in 19 guesses and 2 hints.\n\n🟩🟩 10\n🟨 4\n🟥🟥 7",
      { game: "contexto", display: "19+2💡", solved: true },
    ],
    ["I played contexto.me 11/03/2026 but I gave up in 72 guesses and 10 hints.", { game: "contexto", display: "Gave up", solved: false }],
    ["nerdlegame 1766 3/6\n\n⬛🟪⬛⬛🟪🟪⬛🟩\n🟩🟩🟩🟩🟩🟩🟩🟩", { game: "nerdle", puzzle: 1766, display: "3/6" }],
    ["🙂 Daily Quordle 1760\n4️⃣6️⃣\n7️⃣8️⃣\nm-w.com/games/quordle/", { game: "quordle", puzzle: 1760, display: "25", solved: true }],
    ["🙂 Daily Quordle 1584\n🟥7️⃣\n8️⃣5️⃣\nm-w.com/games/quordle/", { game: "quordle", display: "3/4", solved: false }],
    ["#waffle1763 5/5\n\n🟩🟩🟩🟩🟩\n\n🔥 streak: 12\nwafflegame.net", { game: "waffle", puzzle: 1763, display: "5/5", score: 6 }],
    ["#waffle1694 X/5\n\n🟩⬛🟩⬛🟩", { game: "waffle", display: "X/5", solved: false, score: 0 }],
    ["#travle #1437 +1\n✅✅🟧✅✅✅✅\nhttps://travle.earth", { game: "travle", puzzle: 1437, display: "+1" }],
    ["#travle #1436 (3 away)\n✅🟧🟧\nhttps://travle.earth", { game: "travle", display: "3 away", solved: false }],
    ["TimeGuessr #1171 — 46,873/50,000\n\n1️⃣ 🏆9,853 · 📅 0y · 🌍 7.3mi", { game: "timeguessr", display: "46,873", score: 46873 }],
    ["TimeGuessr #1179 41.943/50.000\n🌎🟩🟩🟨 📅🟩🟩🟩", { game: "timeguessr", score: 41943 }],
    ["Queens #476 | 0:30 and flawless\nFirst 👑s: 🟫 🟦 ⬜ \nlnkd.in/queens.", { game: "queens", puzzle: 476, display: "0:30" }],
    ["Tango #548 | 4:04\nFirst 5 placements:\nlnkd.in/tango.", { game: "tango", display: "4:04" }],
    ["Zip #418 | 0:52 🏁\nWith 5 backtracks 🛑\nlnkd.in/zip.", { game: "zip", display: "0:52" }],
    ["Pinpoint #448 | 2 guesses\n1️⃣  | 58% match\n2️⃣  | 100% match 📌\nlnkd.in/pinpoint.", { game: "pinpoint", display: "2/5" }],
    ["Pinpoint #832\n1️⃣ | 34% match\n5️⃣ | 3% match\nlnkd.in/pinpoint.", { game: "pinpoint", display: "X/5", solved: false }],
  ])("%s", (text, want) => {
    expect(parsed(text)).toMatchObject(want);
  });

  test("text around the result doesn't matter", () => {
    expect(parsed("easy one today\n\nKrillion #128 🦐\n375\n\n🐟🏮🐟🐟🐟🏮🏮\n\nbeat that")).toMatchObject({
      game: "krillion",
      score: 375,
    });
  });

  test("Wordle, practice rounds and archives aren't dailies we track", () => {
    expect(parseShare("Wordle 1,250 3/6\n\n⬛🟨⬛⬛⬛\n🟩🟩🟩🟩🟩")).toBeNull();
    expect(parseShare("🟩🟩🟥🟥🟩🟩🟩🟥🟥🟩 6/10 | Practice | https://scrandle.com")).toBeNull();
    expect(parseShare("Archive November 19, 2026\nConnections\nPuzzle #1257\n🟪🟪🟪🟪")).toBeNull();
    expect(parseShare("Krillion ⟲ #12 🦐\n375\n\n🐟🏮🐟🐟🐟🏮🏮")).toBeNull();
    expect(parseShare("hello")).toBeNull();
  });

  test("a better result always scores higher", () => {
    const score = (t: string) => parseShare(t)!.score;
    expect(score("Framed #1\n🎥 🟩 ⬛ ⬛ ⬛ ⬛ ⬛")).toBeGreaterThan(score("Framed #1\n🎥 🟥 🟩 ⬛ ⬛ ⬛ ⬛"));
    expect(score("Framed #1\n🎥 🟥 🟥 🟥 🟥 🟥 🟩")).toBeGreaterThan(score("Framed #1\n🎥 🟥 🟥 🟥 🟥 🟥 🟥"));
    expect(score("Zip #1 | 0:12 🏁")).toBeGreaterThan(score("Zip #1 | 1:02 🏁"));
    expect(score("Connections\nPuzzle #1\n🟪🟦🟪🟪\n🟪🟪🟪🟪\n🟦🟦🟦🟦\n🟨🟨🟨🟨\n🟩🟩🟩🟩")).toBeGreaterThan(
      score("Connections\nPuzzle #1\n🟪🟪🟪🟪\n🟨🟨🟨🟨\n🟦🟦🟩🟦\n🟦🟩🟦🟦\n🟩🟦🟩🟦\n🟦🟩🟩🟦"),
    );
  });

  test("every daily has its own key and an https link", () => {
    expect(new Set(DAILY_GAMES.map((g) => g.key)).size).toBe(DAILY_GAMES.length);
    for (const g of DAILY_GAMES) expect(g.url).toMatch(/^https:\/\//);
  });
});
