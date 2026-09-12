import { defineApp } from "convex/server";
import shardedCounter from "@convex-dev/sharded-counter/convex.config.js";
import presence from "@convex-dev/presence/convex.config.js";

const app = defineApp();
app.use(shardedCounter);
app.use(presence);

export default app;
