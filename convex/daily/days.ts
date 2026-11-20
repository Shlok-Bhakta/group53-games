const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const noonOf = (day: string) => Date.parse(`${day}T12:00:00Z`);

export const isDay = (day: string) => DAY.test(day) && !Number.isNaN(noonOf(day));

export const addDays = (day: string, n: number) => new Date(noonOf(day) + n * DAY_MS).toISOString().slice(0, 10);

export const localDay = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

export const plausibleToday = (day: string, now: number) => isDay(day) && Math.abs(noonOf(day) - now) <= 1.5 * DAY_MS;

export const lastDays = (today: string, n: number) => Array.from({ length: n }, (_, i) => addDays(today, -i));
