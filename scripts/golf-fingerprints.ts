// Prints the golf world's fingerprints for the scripted games in convex/golf/scenarios.ts. Run it under
// another JavaScript engine (bun is JavaScriptCore, the engine in iPhones) and compare with Node's.
import { allFingerprints } from "../convex/golf/scenarios";
console.log(JSON.stringify(allFingerprints()));
