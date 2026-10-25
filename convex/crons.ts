import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("sweep stale and duplicate games", { minutes: 2 }, internal.matches.sweep, {});
export default crons;
