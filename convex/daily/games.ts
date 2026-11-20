export const SHARE_MAX = 2000;

export type Parsed = {
  game: string;
  puzzle?: number;
  date?: string;
  score: number;
  display: string;
  solved: boolean;
  grid?: string;
};

type Read = Omit<Parsed, "game">;

export type DailyGame = {
  key: string;
  name: string;
  url: string;
  blurb: string;
  read: (text: string) => Read | null;
};

const VS = /️/g;
const num = (s: string) => Number(s.replace(/[,.\s]/g, ""));
const emojiOf = (s: string, set: RegExp) => [...s.matchAll(set)].map((m) => m[0]);
const rowsMadeOf = (text: string, set: RegExp) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.replace(set, "").trim() === "");

const seconds = (clock: string) => clock.split(":").reduce((t, p) => t * 60 + Number(p), 0);
const clockText = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const FASTEST = 100_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function guessesOutOf(got: string, max: number): Pick<Read, "score" | "display" | "solved"> {
  const n = Number(got);
  if (!Number.isInteger(n) || n < 1 || n > max) return { score: 0, display: `X/${max}`, solved: false };
  return { score: max + 1 - n, display: `${n}/${max}`, solved: true };
}

const timed = (clock: string): Pick<Read, "score" | "display" | "solved"> => {
  const s = seconds(clock);
  return { score: FASTEST - s, display: clockText(s), solved: true };
};

const scrandle: DailyGame = {
  key: "scrandle",
  name: "Scrandle",
  url: "https://scrandle.com",
  blurb: "Which footy scran rated higher",
  read: (text) => {
    const m = text.match(/^([🟩🟥⬜]{10}) (\d+)\/10 \| (\d{4}-\d{2}-\d{2}) \|.*scrandle/mu);
    if (!m) return null;
    const right = Number(m[2]);
    return { date: m[3], score: right, display: `${right}/10`, solved: true, grid: m[1] };
  },
};

const KRILL = { "🫧": 10, "🤡": 15, "🐟": 30, "🦑": 60, "🏮": 85, "🌟": 100, "⬛": 0 } as const;
const krillion: DailyGame = {
  key: "krillion",
  name: "Krillion",
  url: "https://krillion.io",
  blurb: "Seven prompts, rare answers score more",
  read: (text) => {
    const m = text.replace(VS, "").match(/^Krillion #(\d+) 🦐\s+(\d+)\s+([🫧🤡🐟🦑🏮🌟⬛]+)/mu);
    if (!m) return null;
    const tiers = emojiOf(m[3], /[🫧🤡🐟🦑🏮🌟⬛]/gu);
    const score = tiers.reduce((t, e) => t + KRILL[e as keyof typeof KRILL], 0);
    return { puzzle: Number(m[1]), score, display: String(score), solved: true, grid: m[3] };
  },
};

const CONNECTIONS_SQUARES = /[🟨🟩🟦🟪]/gu;
const connections: DailyGame = {
  key: "connections",
  name: "Connections",
  url: "https://www.nytimes.com/games/connections",
  blurb: "Four groups of four",
  read: (text) => {
    if (/^Archive /m.test(text)) return null;
    const m = text.match(/^Connections\s*\n\s*Puzzle #\s*([\d,]+)/m);
    if (!m) return null;
    const rows = rowsMadeOf(text.slice(m.index), CONNECTIONS_SQUARES).filter((r) => emojiOf(r, CONNECTIONS_SQUARES).length === 4);
    if (rows.length === 0) return null;
    const groups = rows.filter((r) => new Set(emojiOf(r, CONNECTIONS_SQUARES)).size === 1).length;
    const mistakes = rows.length - groups;
    const won = groups === 4;
    return {
      puzzle: num(m[1]),
      score: won ? 10 - mistakes : groups,
      display: won ? (mistakes === 0 ? "Perfect" : `${mistakes} miss${mistakes === 1 ? "" : "es"}`) : `${groups}/4`,
      solved: won,
      grid: rows.join(" "),
    };
  },
};

const STRANDS_MARKS = /[🔵🟡💡]/gu;
const strands: DailyGame = {
  key: "strands",
  name: "Strands",
  url: "https://www.nytimes.com/games/strands",
  blurb: "Find the theme words",
  read: (text) => {
    if (/^Archive /m.test(text)) return null;
    const m = text.match(/^Strands #\s*([\d,]+)/m);
    if (!m) return null;
    const marks = emojiOf(rowsMadeOf(text.slice(m.index), STRANDS_MARKS).join(""), STRANDS_MARKS);
    if (marks.length === 0) return null;
    const hints = marks.filter((x) => x === "💡").length;
    return {
      puzzle: num(m[1]),
      score: 1000 - hints * 100 - Math.max(0, marks.indexOf("🟡")),
      display: hints === 0 ? "No hints" : `${hints} hint${hints === 1 ? "" : "s"}`,
      solved: true,
      grid: marks.join(""),
    };
  },
};

const mini: DailyGame = {
  key: "mini",
  name: "The Mini",
  url: "https://www.nytimes.com/crosswords/game/mini",
  blurb: "NYT's five-by-five crossword",
  read: (text) => {
    const m = text.match(/nytimes\.com\/badges\/games\/mini\.html\?d=(\d{4}-\d{2}-\d{2})&t=(\d+)/);
    if (!m) return null;
    const s = Number(m[2]);
    return { date: m[1], score: FASTEST - s, display: clockText(s), solved: true };
  },
};

const framed: DailyGame = {
  key: "framed",
  name: "Framed",
  url: "https://framed.wtf",
  blurb: "Name the film from its frames",
  read: (text) => {
    const m = text.match(/^Framed #(\d+)\s*\n\s*🎥((?: [🟥🟩⬛]){6})/mu);
    if (!m) return null;
    const marks = emojiOf(m[2], /[🟥🟩⬛]/gu);
    return { puzzle: Number(m[1]), ...guessesOutOf(String(marks.indexOf("🟩") + 1), 6), grid: marks.join("") };
  },
};

const globle: DailyGame = {
  key: "globle",
  name: "Globle",
  url: "https://globle-game.com",
  blurb: "Find the country, hot or cold",
  read: (text) => {
    const head = text.match(/^🌎 ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) 🌍/mu);
    const end = text.match(/= (\d+)\s*$/m);
    if (!head || !end || !MONTHS.includes(head[1])) return null;
    const n = Number(end[1]);
    return {
      date: iso(Number(head[3]), MONTHS.indexOf(head[1]) + 1, Number(head[2])),
      score: 1000 - n,
      display: String(n),
      solved: true,
      grid: emojiOf(text, /[🟩🟥🟧🟨⬜]/gu).join(""),
    };
  },
};

const worldle: DailyGame = {
  key: "worldle",
  name: "Worldle",
  url: "https://worldle.teuteuf.fr",
  blurb: "Name the country from its shape",
  read: (text) => {
    const m = text.match(/^#Worldle #(\d+) \((\d{2})\.(\d{2})\.(\d{4})\) (\S+)\/6/mu);
    if (!m) return null;
    return { puzzle: Number(m[1]), date: iso(Number(m[4]), Number(m[3]), Number(m[2])), ...guessesOutOf(m[5], 6) };
  },
};

const costcodle: DailyGame = {
  key: "costcodle",
  name: "Costcodle",
  url: "https://costcodle.com",
  blurb: "Guess the Costco price",
  read: (text) => {
    const m = text.match(/^Costcodle (?:Classic )?#(\d+) ([\dX])\/6/m);
    if (!m) return null;
    return { puzzle: Number(m[1]), ...guessesOutOf(m[2], 6) };
  },
};

const bandle: DailyGame = {
  key: "bandle",
  name: "Bandle",
  url: "https://bandle.app",
  blurb: "Name the song, one instrument at a time",
  read: (text) => {
    const m = text.match(/^Bandle #(\d+) ([\dxX])\/(\d)\s*\n\s*([⬛🟥🟨🟩⬜]+)/mu);
    if (!m) return null;
    return { puzzle: Number(m[1]), ...guessesOutOf(m[2], Number(m[3])), grid: m[4] };
  },
};

const contexto: DailyGame = {
  key: "contexto",
  name: "Contexto",
  url: "https://contexto.me",
  blurb: "Find the secret word by meaning",
  read: (text) => {
    const m = text.match(
      /I played contexto\.me (?:#(\d+)|[\d/]+) (and got it|but I gave up) in (\d+) guesses(?: and (\d+) (?:hints|tips))?/,
    );
    if (!m) return null;
    const guesses = Number(m[3]);
    const hints = Number(m[4] ?? 0);
    const solved = m[2] === "and got it";
    return {
      puzzle: m[1] ? Number(m[1]) : undefined,
      score: solved ? 10_000 - guesses - hints : 0,
      display: solved ? (hints ? `${guesses}+${hints}💡` : String(guesses)) : "Gave up",
      solved,
    };
  },
};

const nerdle: DailyGame = {
  key: "nerdle",
  name: "Nerdle",
  url: "https://nerdlegame.com",
  blurb: "Wordle, but it's maths",
  read: (text) => {
    const m = text.match(/^nerdlegame (\d+) ([\dX])\/6/m);
    if (!m) return null;
    return { puzzle: Number(m[1]), ...guessesOutOf(m[2], 6) };
  },
};

const KEYCAP = "\u20E3";
const keycapValue = (c: string) => (c === "🔟" ? 10 : c.endsWith(KEYCAP) ? Number(c[0]) : 0);
const quordle: DailyGame = {
  key: "quordle",
  name: "Quordle",
  url: "https://www.merriam-webster.com/games/quordle",
  blurb: "Four words at once",
  read: (text) => {
    const plain = text.replace(VS, "");
    const m = plain.match(/^(?:🙂 )?Daily Quordle (\d+)\s*\n\s*(\S+)\s*\n\s*(\S+)/mu);
    if (!m) return null;
    const cells = emojiOf(m[2] + m[3], /[1-9]\u20E3|🔟|🟥/gu);
    if (cells.length !== 4) return null;
    const solved = !cells.includes("🟥");
    const total = cells.reduce((t, c) => t + keycapValue(c), 0);
    return {
      puzzle: Number(m[1]),
      score: solved ? 100 - total : cells.filter((c) => c !== "🟥").length,
      display: solved ? String(total) : `${cells.filter((c) => c !== "🟥").length}/4`,
      solved,
      grid: cells.map((c) => (c === "🟥" ? "🟥" : String(keycapValue(c)))).join(" "),
    };
  },
};

const waffle: DailyGame = {
  key: "waffle",
  name: "Waffle",
  url: "https://wafflegame.net",
  blurb: "Swap letters, keep your stars",
  read: (text) => {
    const m = text.match(/^#waffle(\d+) ([0-5X])\/5/m);
    if (!m) return null;
    const solved = m[2] !== "X";
    return { puzzle: Number(m[1]), score: solved ? Number(m[2]) + 1 : 0, display: `${m[2]}/5`, solved };
  },
};

const travle: DailyGame = {
  key: "travle",
  name: "Travle",
  url: "https://travle.earth",
  blurb: "Connect two countries by land",
  read: (text) => {
    const m = text.match(/^#travle #(\d+) (?:\+(\d+)|\((\d+) [^)]+\))/m);
    if (!m) return null;
    const solved = m[2] !== undefined;
    return {
      puzzle: Number(m[1]),
      score: solved ? 100 - Number(m[2]) : 0,
      display: solved ? `+${m[2]}` : `${m[3]} away`,
      solved,
    };
  },
};

const timeguessr: DailyGame = {
  key: "timeguessr",
  name: "TimeGuessr",
  url: "https://timeguessr.com",
  blurb: "Place the photo in time and space",
  read: (text) => {
    const m = text.match(/^TimeGuessr #(\d+)(?: —)? ([\d,.]+)\/50[,.]000/m);
    if (!m) return null;
    const score = num(m[2]);
    return { puzzle: Number(m[1]), score, display: score.toLocaleString("en-US"), solved: true };
  },
};

const linkedIn = (key: string, name: string, blurb: string): DailyGame => ({
  key,
  name,
  url: `https://www.linkedin.com/games/${key}`,
  blurb,
  read: (text) => {
    const m = text.match(new RegExp(`^${name} #(\\d+) \\| (\\d+:\\d{2})`, "m"));
    if (!m) return null;
    return { puzzle: Number(m[1]), ...timed(m[2]) };
  },
});

const pinpoint: DailyGame = {
  key: "pinpoint",
  name: "Pinpoint",
  url: "https://www.linkedin.com/games/pinpoint",
  blurb: "Guess the category from five clues",
  read: (text) => {
    const m = text.match(/^Pinpoint #(\d+)(?: +\| +(\d) guess)?/m);
    if (!m) return null;
    return { puzzle: Number(m[1]), ...guessesOutOf(m[2] ?? "X", 5) };
  },
};

export const DAILY_GAMES: readonly DailyGame[] = [
  scrandle,
  krillion,
  connections,
  strands,
  mini,
  framed,
  globle,
  worldle,
  costcodle,
  bandle,
  contexto,
  nerdle,
  quordle,
  waffle,
  travle,
  timeguessr,
  linkedIn("queens", "Queens", "One crown per row, column and colour"),
  linkedIn("tango", "Tango", "Suns and moons, balanced"),
  linkedIn("zip", "Zip", "One line through every cell"),
  pinpoint,
];

export const findDailyGame = (key: string) => DAILY_GAMES.find((g) => g.key === key);

export function dailyGame(key: string) {
  const game = findDailyGame(key);
  if (!game) throw new Error(`Unknown daily ${key}.`);
  return game;
}

export const dailyPath = (key: string) => `/daily/${key}`;

export function parseShare(text: string): Parsed | null {
  const share = text.trim();
  if (share.length === 0 || share.length > SHARE_MAX) return null;
  for (const g of DAILY_GAMES) {
    const read = g.read(share);
    if (read) return { game: g.key, ...read };
  }
  return null;
}
