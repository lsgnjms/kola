import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";

const env = loadEnv();
const app = await buildServer(env);

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
