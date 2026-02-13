import { createServer } from "http";
import { createYoga } from "graphql-yoga";
import { schema } from "./graphql/schema.js";
import { createContext } from "./graphql/context.js";
import { env } from "./env.js";
import { startOfferIndexWorker } from "./jobs/eligibility/queue.js";
import { startBackstopCron } from "./jobs/eligibility/cron.js";


const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  context: ({ request }) => createContext(request),
});

const server = createServer(yoga);

server.listen(env.PORT, () => {
  console.log(`GraphQL server running on http://localhost:${env.PORT}/graphql`);
});

// Start background worker + cron if Redis is configured.
if (env.REDIS_URL) {
  startOfferIndexWorker();
  startBackstopCron();
} else {
  console.log("Redis not configured: skipping BullMQ worker + cron");
}
