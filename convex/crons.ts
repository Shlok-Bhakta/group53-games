import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("sweep stale and duplicate games", { minutes: 2 }, internal.matches.sweep, {});
crons.interval("forget stocks nobody is looking at", { seconds: 30 }, internal.stonks.sweepViews, {});
crons.interval("forget charts nobody has opened in two weeks", { hours: 6 }, internal.stonks.sweepSeries, {});
export default crons;
