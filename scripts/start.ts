/**
 * One command from a fresh clone to a running demo:
 *
 *   pnpm start        app on this computer (http://localhost:5173)
 *   pnpm start:lan    also reachable from phones on the same Wi-Fi
 *
 * Checks prerequisites, creates .env, starts the regtest stack, seeds it (safe to
 * re-run), then runs the app. Ctrl+C stops the app; `pnpm stack:stop` stops Docker.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { delimiter, dirname, join } from "node:path";

const lan = process.argv.includes("--lan");
const env: NodeJS.ProcessEnv = { ...process.env };

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function step(message: string): void {
  console.log(`\n▸ ${message}`);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.status !== 0) fail(`\`${command} ${args.join(" ")}\` failed. See the output above.`);
}

/** Docker Desktop on Windows can be installed per user and missing from PATH in older terminals. */
function findDocker(): string | null {
  const works = (bin: string) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
  if (works("docker")) return "docker";
  if (process.platform !== "win32") return null;
  const candidates = [
    join(process.env.LOCALAPPDATA ?? "", "Programs", "DockerDesktop", "resources", "bin", "docker.exe"),
    join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe"),
  ];
  return candidates.find((c) => existsSync(c) && works(c)) ?? null;
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254."))
    .map((a) => a?.address ?? "");
}

// 1. Prerequisites
step("Checking prerequisites");
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) fail(`Node 22 or newer is needed (you have ${process.versions.node}). Get it from https://nodejs.org`);

const docker = findDocker();
if (!docker) fail("Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/");
if (docker !== "docker") {
  // Windows spells it "Path"; a copied env object is case-sensitive, so reuse the existing key.
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${dirname(docker)}${delimiter}${env[pathKey] ?? ""}`;
}
if (spawnSync(docker, ["info"], { stdio: "ignore", env }).status !== 0) {
  fail("Docker is installed but not running. Start Docker Desktop, wait until it says it is running, then run this again.");
}
console.log(`  Node ${process.versions.node}, Docker running`);

// 2. Configuration
if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  step("Created .env from .env.example (regtest defaults, no secrets needed)");
}

// 3. Regtest stack
step("Starting the test network (bitcoind, Lightning nodes, Nostr relay)");
run("docker", ["compose", "-f", "infra/docker-compose.yml", "up", "-d"]);

// 4. Funds, channels, demo circle (idempotent)
step("Preparing wallets and the demo circle (first run takes a few minutes)");
run("pnpm", ["seed"]);

// 5. The app
const urls = ["http://localhost:5173"];
if (lan) {
  const lanUrls = lanAddresses().map((ip) => `http://${ip}:5173`);
  urls.push(...lanUrls);
  // Requests are signed over the URL the phone uses, so the API must accept these too.
  env.PUBLIC_API_URLS = urls.map((u) => `${u}/api`).join(",");
}
console.log(`
────────────────────────────────────────────────────────────
  Kola is starting. Open:
${urls.map((u) => `    ${u}`).join("\n")}

  Try it: tap "Khady" on the welcome screen (demo PIN 123456),
  open the Sandaga market circle and tap "Start round 1".
  Switch to Ousmane and Mariama in Settings to pay their shares.

  Ctrl+C stops the app. Before shutting down your computer,
  run "pnpm stack:stop" to stop the test network cleanly.
────────────────────────────────────────────────────────────
`);
const app = spawn("pnpm", [lan ? "dev:lan" : "dev"], { stdio: "inherit", env, shell: process.platform === "win32" });
app.on("exit", (code) => process.exit(code ?? 0));
