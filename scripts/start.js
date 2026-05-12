/**
 * Container entrypoint. Runs `prisma generate + migrate deploy`, then launches
 * the React Router web tier and the pg-boss worker in parallel. If either
 * child exits, the other is terminated and the container exits with the same
 * code so Docker's restart policy can recycle the whole stack.
 *
 * Used in production via `npm run docker-start` (called by the Dockerfile's
 * CMD). Plain Node — no shell quirks, works on Alpine.
 */
import { spawn } from "node:child_process";
import process from "node:process";

const children = [];
let shuttingDown = false;

function logPrefix(name) {
  return `[start:${name}]`;
}

function runSetup() {
  return new Promise((resolve, reject) => {
    console.log(`${logPrefix("setup")} prisma generate + migrate deploy`);
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const setup = spawn(npmCmd, ["run", "setup"], { stdio: "inherit" });
    setup.on("error", reject);
    setup.on("exit", (code, signal) => {
      if (code === 0) {
        console.log(`${logPrefix("setup")} complete`);
        resolve();
      } else {
        reject(new Error(`setup exited with code=${code} signal=${signal}`));
      }
    });
  });
}

function launch(name, command, args) {
  console.log(`${logPrefix(name)} launching: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, { stdio: "inherit" });
  children.push({ name, child });
  child.on("exit", (code, signal) => {
    console.log(
      `${logPrefix(name)} exited (code=${code} signal=${signal})`,
    );
    // Treat any child's exit as fatal: tear the rest down so Docker recycles.
    shutdown(code ?? 1);
  });
  child.on("error", (err) => {
    console.error(`${logPrefix(name)} spawn error:`, err);
    shutdown(1);
  });
  return child;
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { name, child } of children) {
    if (child.exitCode === null && !child.killed) {
      console.log(`${logPrefix(name)} sending SIGTERM`);
      try {
        child.kill("SIGTERM");
      } catch (err) {
        console.error(`${logPrefix(name)} kill error:`, err);
      }
    }
  }
  // Give children a grace period to drain before forcing exit.
  setTimeout(() => process.exit(exitCode), 5000).unref();
}

process.on("SIGTERM", () => {
  console.log("[start] received SIGTERM");
  shutdown(0);
});
process.on("SIGINT", () => {
  console.log("[start] received SIGINT");
  shutdown(0);
});

try {
  await runSetup();
} catch (err) {
  console.error("[start] setup failed:", err);
  process.exit(1);
}

// Invoke react-router-serve via its package bin so its NODE_ENV default + any
// future bootstrap logic stays in sync with `npm run start`.
const rrServeBin = "./node_modules/@react-router/serve/bin.js";
launch("web", "node", [rrServeBin, "./build/server/index.js"]);
launch("worker", "node", ["./build/worker/index.js"]);

console.log("[start] both processes launched");
