// Shared config access for route handlers. Reads the same config/*.json as ui/server.js.
// ROOT is the repo root (parent of ui-next/), where `config/` lives.
import fs from "fs";
import path from "path";
import os from "os";

export const ROOT = path.resolve(process.cwd(), "..");

// Where the sibling project repos (rezil-esms*…) live. Defaults to the parent
// of this repo (they're checked out side-by-side); override with REZIL_ROOT to relocate on another
// machine WITHOUT editing config/*.json. Config files store repo paths as bare folder names relative
// to this; absolute paths in config are honored as-is (loadConfig resolves them — see below).
export function rezilRoot() {
  return process.env.REZIL_ROOT || path.resolve(ROOT, "..");
}

// A configured repo path → absolute: absolute stays, relative resolves under REZIL_ROOT.
function absRepoPath(p) {
  return path.isAbsolute(p) ? p : path.resolve(rezilRoot(), p);
}

// Claude config dir for the account this app actually spawns `claude` with, so /usage, /cost and
// /context read THAT account's credentials/transcripts. pm2 sets CLAUDE_CONFIG_DIR from
// CLAUDE_ACCOUNT in .env (see ecosystem.config.js): account2/account3 → that dir; default account →
// the var stays UNSET (the CLI must read ~/.claude.json, not the ~/.claude/.claude.json stub) and
// the ~/.claude fallback below is correct because transcripts live in ~/.claude/projects anyway.
// Comma-separated CLAUDE_CONFIG_DIR → first entry, for runs started from a per-account terminal.
export function claudeHome() {
  const env = (process.env.CLAUDE_CONFIG_DIR || "").split(",")[0].trim();
  return env || path.join(os.homedir(), ".claude");
}

// ─── Nhiều account Claude trên cùng máy ────────────────────────────────────────────────────────
// Mỗi account là 1 CLAUDE_CONFIG_DIR riêng (credentials + transcripts riêng). Dùng để chạy tiếp
// một phiên chat bằng account khác khi account đang dùng hết quota (xem lib/sessions.js
// ensureSessionInAccount + app/api/chat/route.js).
//
// ⚠️ Account mặc định (acct1) KHÔNG được set CLAUDE_CONFIG_DIR=~/.claude: biến đó đổi luôn chỗ CLI
// đọc file config thành $CLAUDE_CONFIG_DIR/.claude.json, mà config THẬT của account mặc định nằm ở
// ~/.claude.json → set vào sẽ đọc file stub và mất hết MCP server. Vì vậy accountEnv() XOÁ biến
// thay vì set, đúng như ecosystem.config.js đang làm.
// Thêm account mới = thêm 1 dòng ở đây (dir = CLAUDE_CONFIG_DIR của account đó).
// acct2 (~/.claude-account2) từng bị bỏ vì org disable subscription (2026-08-17), nay đã đăng nhập
// lại và dùng được → bật lại từ 2026-08-19.
export const ACCOUNTS = {
  acct1: { label: "acct1", dir: path.join(os.homedir(), ".claude"), isDefault: true },
  acct2: { label: "acct2", dir: path.join(os.homedir(), ".claude-account2") },
  acct3: { label: "acct3", dir: path.join(os.homedir(), ".claude-account3") },
};

// Các account thực sự có trên máy này (đã đăng nhập → có .credentials.json).
export function listAccounts() {
  return Object.keys(ACCOUNTS).filter((k) => fs.existsSync(path.join(ACCOUNTS[k].dir, ".credentials.json")));
}

export function accountHome(key) {
  return (ACCOUNTS[key] || ACCOUNTS.acct1).dir;
}

// Account mà process này đang chạy dưới (theo CLAUDE_CONFIG_DIR pm2 đặt). Không khớp dir nào → acct1.
export function currentAccountKey() {
  const home = claudeHome();
  return Object.keys(ACCOUNTS).find((k) => ACCOUNTS[k].dir === home) || "acct1";
}

// Env để spawn `claude` dưới 1 account cụ thể. Trả về object mới, không sửa process.env.
export function accountEnv(key) {
  const a = ACCOUNTS[key];
  if (!a) return { ...process.env };
  const env = { ...process.env };
  if (a.isDefault) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = a.dir;
  return env;
}

export function loadConfig(name) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config", `${name}.json`), "utf8"));
  // Expand repo paths against REZIL_ROOT so every consumer sees absolute paths while config/*.json
  // stays machine-independent. Covers single-repo configs (`path`) and github.json (`repos[*].path`).
  if (cfg && typeof cfg.path === "string") cfg.path = absRepoPath(cfg.path);
  if (cfg && cfg.repos) {
    for (const r of Object.values(cfg.repos)) {
      if (r && typeof r.path === "string") r.path = absRepoPath(r.path);
    }
  }
  return cfg;
}

// Resolve a single REZIL repo entry by name (for auto mode). Defaults to defaultRepo.
export function resolveRepo(name) {
  const gh = loadConfig("github");
  const key = name || gh.defaultRepo;
  const r = gh.repos[key];
  if (!r) throw new Error(`Unknown repo "${key}". Known: ${Object.keys(gh.repos).join(", ")}`);
  return { name: key, ...r };
}

export function listRepos() {
  const gh = loadConfig("github");
  return { repos: Object.keys(gh.repos), defaultRepo: gh.defaultRepo };
}

// Single-repo projects driven by a config/<key>.json (own CLAUDE.md/.claude auto-loaded by cwd).
// Adding one is a one-entry change here + its config/<key>.json (+ an entry in Chat.jsx's PROJECTS
// and, if it needs its own prompt/tools, a branch in lib/claude.js). Currently none.
export const SIMPLE_PROJECTS = {};

// Normalize an arbitrary project param to a known key; anything unknown → "rezil".
// "free" is the unrestricted, all-projects mode (see resolveProject) — kept explicit here so it
// survives the normalize step instead of being coerced to "rezil".
export function normalizeProject(p) {
  return p === "rezil" || p === "free" || SIMPLE_PROJECTS[p] ? p : "rezil";
}

// Resolve a "project" (rezil | free | …) into the bits a run/chat needs.
// Keeping this in one place is what makes adding another project a one-entry change.
export function resolveProject(project) {
  // "free" = unrestricted, all-projects mode: cwd is the workspace root (~/IdeaProjects by default,
  // = rezilRoot) so claude can reach EVERY project checked out side-by-side, not just one repo.
  if (project === "free") {
    const root = rezilRoot();
    return {
      key: "free",
      label: "Toàn bộ",
      cwd: root,
      addDirs: [root].filter((p) => fs.existsSync(p)),
      cfg: null,
    };
  }
  const simple = SIMPLE_PROJECTS[project];
  if (simple) {
    const s = loadConfig(project);
    return {
      key: project,
      label: simple.label,
      cwd: s.path,
      addDirs: [s.path].filter((p) => fs.existsSync(p)),
      cfg: s,
    };
  }
  // default: rezil
  const gh = loadConfig("github");
  const repos = Object.values(gh.repos).map((r) => r.path);
  return {
    key: "rezil",
    label: "REZIL",
    cwd: gh.repos[gh.defaultRepo].path,
    addDirs: repos.filter((p) => fs.existsSync(p)),
    cfg: gh,
  };
}
