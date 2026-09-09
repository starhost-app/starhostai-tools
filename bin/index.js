#!/usr/bin/env node
"use strict";

const os = require("os");
const readline = require("readline");
const { loadConfig, saveConfig, clearConfig } = require("../lib/config");
const { DEFAULT_SERVER_URL } = require("../lib/constants");
const { serve } = require("../lib/socket");

const VERSION = require("../package.json").version;
const COMMANDS = ["help", "status", "version", "disconnect"];

function serverUrl(explicit) {
  const fromEnv = process.env.STARHOSTAI_URL;
  const fromConfig = loadConfig().server;
  return (explicit || fromEnv || fromConfig || DEFAULT_SERVER_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function usage() {
  console.log(`
  StarHostAI Tools v${VERSION}

  Connect this machine to StarHostAI so the AI can:
    • read / write / create / list / delete files across your system
    • run terminal commands

  Usage:
    starhostai-tools               First run: asks for your 8-character connection code,
                                   names this device and connects
    starhostai-tools status        Show saved device, token & expiry
    starhostai-tools disconnect    Clear saved auth token on this machine
    starhostai-tools help          Show this help
    starhostai-tools version       Show the version

  Options:
    --name <name>    Name this device (default: prompts, then your computer's hostname)
    --mode <mode>    allow | deny | auto (default: allow)
    --server <url>   StarHostAI server URL (default: saved config / env / built-in)

  Pairing once saves a 2-week auth token locally. On later runs the CLI asks the
  server if the token is still valid — if it expired it asks for a fresh code.
  Works on Windows, macOS and Linux. Only 1 machine can be connected per account.
  `);
}

function parseArgs(argv) {
  const args = { server: null, mode: null, name: null, command: null, code: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server" && argv[i + 1]) args.server = argv[++i];
    else if (a === "--mode" && argv[i + 1]) args.mode = argv[++i];
    else if (a === "--name" && argv[i + 1]) args.name = argv[++i];
    else if (a === "--help" || a === "-h") args.command = "help";
    else if (a === "--version" || a === "-v") args.command = "version";
    else if (!args.command && !a.startsWith("-")) {
      if (COMMANDS.includes(a)) args.command = a;
      else if (!args.code) args.code = a;
    }
  }
  return args;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function promptForCode() {
  return prompt("  Enter your 8-character connection code: ");
}

async function promptForDeviceName() {
  const fallback = os.hostname() || "my-machine";
  const ans = await prompt(`  Name this device (default: ${fallback}): `);
  return ans || fallback;
}

async function status() {
  const config = loadConfig();
  console.log(`\n  StarHostAI Tools v${VERSION}`);
  if (!config.token) {
    console.log("  Not paired yet. Run `npx github:starhost-app/starhostai-tools` — it asks for your 8-character connection code.\n");
    return;
  }
  console.log(`  Server:        ${config.server || serverUrl()}`);
  console.log(`  Device:        ${config.name || "CLI Session"}`);
  console.log(`  Auth Token:    ${config.token.slice(0, 18)}... (expiry checked with the server on connect)`);
  console.log(`  Mode:          ${config.mode || "allow"}`);
  console.log(`  System Access: Full system access (protected system directories excluded)\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    usage();
    return;
  }
  if (args.command === "version") {
    console.log(VERSION);
    return;
  }
  if (args.command === "status") {
    await status();
    return;
  }
  if (args.command === "disconnect") {
    clearConfig();
    console.log("\n  ✔ Saved auth token & connection info cleared.\n");
    return;
  }

  const base = serverUrl(args.server);
  const mode = ["allow", "deny", "auto"].includes(args.mode) ? args.mode : (loadConfig().mode || "allow");
  const cwd = os.homedir();

  // Connection loop: pair with a code → save token; reconnect with the saved
  // token and let the SERVER validate it; if expired/invalid, ask for a new
  // code and try again.
  let code = args.code || null;
  while (true) {
    const config = loadConfig();
    const token = config.token || null;
    let name = args.name || config.name || null;

    if (!code && !token) {
      console.log(`\n  StarHostAI Tools v${VERSION}`);
      console.log("  No saved connection found. Pair this machine (find your code in StarHostAI → Connect).\n");
      code = await promptForCode();
      if (!code) {
        console.log("\n  No connection code entered. Exiting.\n");
        process.exit(1);
      }
      if (!name) name = await promptForDeviceName();
    }

    console.log(`\n  StarHostAI Tools v${VERSION}`);
    console.log(`  Server:        ${base}`);
    if (token) {
      console.log(`  Device:        ${name || "CLI Session"}`);
      console.log(`  Auth Token:    ${token.slice(0, 18)}... (validating with server…)`);
    } else {
      console.log(`  Device:        ${name || "CLI Session"}`);
      console.log(`  Pairing Code:  ${code} (exchanging for a 2-week auth token…)`);
    }
    console.log(`  Mode:          ${mode}`);
    console.log(`  System Access: Full system access (protected system directories excluded)`);

    const onAuthToken = ({ token: newToken, expiresAt }) => {
      saveConfig({ ...loadConfig(), server: base, token: newToken, expiresAt, name, mode, code: undefined });
    };

    const result = await serve({ base, code, token, name, mode, cwd, onAuthToken });

    if (result && (result.tokenExpired || result.invalidCode)) {
      // Server said the token/code is no good — clear it and ask for a fresh code.
      clearConfig();
      console.log("\n  ✗ Your saved token has expired (or the code was invalid). Let's pair again.\n");
      code = null;
      continue;
    }
    if (result && result.replaced) {
      process.exit(0);
    }
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`\n  ✗ ${err.message}\n`);
  process.exit(1);
});