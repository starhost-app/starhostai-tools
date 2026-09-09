"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { expandGlob } = require("./glob");

const MAX_FILE_READ = 1_000_000; // 1MB per file
const MAX_OUTPUT = 200_000; // 200KB terminal output

function describeOperation(op, args) {
  switch (op) {
    case "read":
      return `read file(s): ${(args.paths || []).join(", ")}`;
    case "write":
      return `write file(s): ${(args.files || []).map((f) => f.path).join(", ")}`;
    case "makeDirs":
      return `create director${(args.paths || []).length === 1 ? "y" : "ies"}: ${(args.paths || []).join(", ")}`;
    case "list":
      return `list directory: ${args.path || process.cwd()}`;
    case "delete":
      return `delete: ${(args.paths || []).join(", ")}`;
    case "terminal":
      return `run terminal command: ${args.command}`;
    default:
      return op;
  }
}

/**
 * Mode gate. Confirmation happens in the StarHostAI web chat (the server asks
 * the user in the browser and passes `approved: true` for interactive ops), so
 * this CLI NEVER prompts.
 *  - "auto": run everything silently.
 *  - "deny": reject everything.
 *  - "allow": file reads/writes/dir creation/lists run silently; terminal
 *    commands and deletes only run when the server already got approval.
 */
function createGate(mode) {
  return function gate(op, args, approved) {
    if (mode === "auto") return { allowed: true };
    if (mode === "deny") {
      return {
        allowed: false,
        reason: `Denied: the connection is in DENY mode and does not permit: ${describeOperation(op, args)}`,
      };
    }
    // allow mode: only terminal + delete need (browser) approval
    if (op !== "terminal" && op !== "delete") return { allowed: true };
    if (approved) return { allowed: true };
    return {
      allowed: false,
      reason: `Denied: requires approval in the StarHostAI chat — ${describeOperation(op, args)}`,
    };
  };
}

/**
 * Protected system directories the connector refuses to touch. Everything
 * else — including user-made directories like /projects — is fair game.
 */
const SYSTEM_ROOTS = [
  "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/boot",
  "/dev", "/proc", "/sys", "/run", "/root", "/opt", "/snap", "/var",
];
const SYSTEM_WIN_ROOTS = [
  "c:\\windows", "c:\\program files", "c:\\programdata", "c:\\recovery",
];

function isSystemPath(abs) {
  const p = path.resolve(abs);
  for (const root of SYSTEM_ROOTS) {
    if (p === root || p.startsWith(root + path.sep)) return true;
  }
  const lower = p.toLowerCase();
  for (const r of SYSTEM_WIN_ROOTS) {
    if (lower === r || lower.startsWith(r + "\\")) return true;
  }
  return false;
}

/**
 * Resolve a path for filesystem operations.
 *
 * Full system access except protected system directories. The starting
 * directory is the user's home dir (the connection's cwd).
 */
function resolvePath(p, cwd) {
  const root = path.resolve(cwd || process.cwd());
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  if (isSystemPath(abs)) {
    throw new Error(`Path is in a protected system directory (${abs})`);
  }
  return abs;
}

async function opRead(args, cwd) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  const files = [];
  const missing = [];
  for (const raw of paths) {
    const expanded = expandGlob(raw, cwd);
    if (expanded.length === 0) {
      missing.push(raw);
      continue;
    }
    for (const rawExpanded of expanded) {
      let p;
      try {
        p = resolvePath(rawExpanded, cwd);
      } catch (err) {
        files.push({ path: rawExpanded, error: err.message });
        continue;
      }
      try {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          files.push({ path: p, error: "is a directory — use fs_list" });
          continue;
        }
        if (stat.size > MAX_FILE_READ) {
          files.push({ path: p, error: `file too large (${stat.size} bytes)` });
          continue;
        }
        const content = fs.readFileSync(p, "utf8");
        files.push({ path: p, content });
      } catch (err) {
        files.push({ path: p, error: err.message });
      }
    }
  }
  return { files, missing };
}

async function opWrite(args, cwd) {
  const files = Array.isArray(args.files) ? args.files : [];
  const written = [];
  const errors = [];
  for (const f of files) {
    const raw = String(f.path || "");
    try {
      const p = resolvePath(raw, cwd);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(f.content ?? ""), "utf8");
      written.push(p);
    } catch (err) {
      errors.push({ path: raw, error: err.message });
    }
  }
  return { written, errors };
}

async function opMakeDirs(args, cwd) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  const created = [];
  for (const raw of paths) {
    try {
      const p = resolvePath(String(raw || ""), cwd);
      fs.mkdirSync(p, { recursive: true });
      created.push(p);
    } catch (err) {
      if (err.message.startsWith("Path is in a protected")) {
        created.push({ path: raw, error: err.message });
      } else {
        // mkdir failed for another reason — still list it if it exists.
        try {
          const p = resolvePath(String(raw || ""), cwd);
          if (fs.existsSync(p)) created.push(p);
        } catch {
          created.push({ path: raw, error: err.message });
        }
      }
    }
  }
  return { created };
}

async function opList(args, cwd) {
  let p;
  try {
    p = resolvePath(String(args.path || "."), cwd);
  } catch (err) {
    return { path: String(args.path || "."), entries: [{ type: "error", name: args.path || ".", error: err.message }] };
  }
  const recursive = Boolean(args.recursive);
  const entries = [];
  const walk = (dir) => {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      entries.push({ type: "error", name: dir, error: err.message });
      return;
    }
    for (const e of list) {
      const full = path.join(dir, e.name);
      entries.push({ type: e.isDirectory() ? "dir" : "file", name: e.name, path: full });
      if (recursive && e.isDirectory()) walk(full);
    }
  };
  walk(p);
  return { path: p, entries };
}

async function opDelete(args, cwd) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  const deleted = [];
  const errors = [];
  for (const raw of paths) {
    try {
      const p = resolvePath(String(raw || ""), cwd);
      const stat = fs.lstatSync(p);
      if (stat.isDirectory()) {
        if (args.recursive) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.rmdirSync(p);
        }
      } else {
        fs.unlinkSync(p);
      }
      deleted.push(p);
    } catch (err) {
      errors.push(`${raw}: ${err.message}`);
    }
  }
  return { deleted, errors };
}

function opTerminal(args, cwd) {
  const command = String(args.command || "");
  const runCwd = args.cwd ? String(args.cwd) : cwd || process.cwd();
  const timeoutMs = Math.min(Number(args.timeoutMs) || 60_000, 600_000);

  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, cwd: runCwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(0, MAX_OUTPUT);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(0, MAX_OUTPUT);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ output: `Failed to start command: ${err.message}`, exitCode: 1, cwd: runCwd });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      resolve({
        output: timedOut ? `${output}\n[command timed out after ${timeoutMs}ms and was killed]` : output,
        exitCode: timedOut ? 124 : code,
        cwd: runCwd,
      });
    });
  });
}

async function execute(op, args, { mode, cwd, approved = false }) {
  const gate = createGate(mode);
  const decision = gate(op, args, approved);
  if (!decision.allowed) {
    return { ok: false, error: decision.reason };
  }
  try {
    let data;
    switch (op) {
      case "read": data = await opRead(args, cwd); break;
      case "write": data = await opWrite(args, cwd); break;
      case "makeDirs": data = await opMakeDirs(args, cwd); break;
      case "list": data = await opList(args, cwd); break;
      case "delete": data = await opDelete(args, cwd); break;
      case "terminal": data = await opTerminal(args, cwd); break;
      default:
        return { ok: false, error: `Unknown operation: ${op}` };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { execute, describeOperation };