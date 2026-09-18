// Per-repo job lock, shared across route handlers. At most one auto job per repo
// (key = repo name). globalThis keeps the Map alive across dev HMR reloads.
const g = globalThis;
if (!g.__aiRunningJobs) g.__aiRunningJobs = new Map(); // key -> { child, label }
export const running = g.__aiRunningJobs;

export function cancel(key) {
  if (key) {
    const j = running.get(key);
    if (j && j.child && j.child.exitCode === null) j.child.kill("SIGTERM");
    return;
  }
  for (const j of running.values()) if (j.child && j.child.exitCode === null) j.child.kill("SIGTERM");
}
