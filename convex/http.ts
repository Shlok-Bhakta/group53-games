import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { serve } from "./hosted";

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ pathPrefix: "/games/", method: "GET", handler: serve });

export default http;
