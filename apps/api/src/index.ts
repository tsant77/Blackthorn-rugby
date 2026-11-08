import app, { type Env } from "./app";
import { runScheduledJobs } from "./jobs";

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled(_event: unknown, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledJobs(env, Date.now()));
  },
};
