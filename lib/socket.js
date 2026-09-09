"use strict";

const { execute } = require("./executor");

/**
 * Load `ws` if installed; otherwise fall back to Node's global WebSocket
 * (Node >= 22). Prints guidance when neither is available.
 */
function getWebSocket() {
  try {
    return require("ws");
  } catch {
    if (typeof globalThis.WebSocket === "function") return globalThis.WebSocket;
    throw new Error(
      "No WebSocket implementation found. Install the connector deps with `npm install` in the connector folder (needs the `ws` package) or use Node 22+."
    );
  }
}

function wsUrl(base, { token, code, name, mode }) {
  const url = new URL(base);
  const proto = url.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  if (code) params.set("code", code);
  if (name) params.set("name", name);
  if (mode) params.set("mode", mode);
  return `${proto}//${url.host}/api/ws-tools?${params.toString()}`;
}

/**
 * Connect to StarHostAI by 2-week auth token (saved locally) or an 8-character
 * one-time connection code (exchanges for a fresh 2-week token). Serves tool
 * calls until the connection ends.
 */
function serve({ base, token, code, name, mode = "allow", cwd, onAuthToken, print = console.log }) {
  const WS = getWebSocket();
  let currentToken = token;
  let socket = null;
  let stopped = false;
  let backoff = 1000;

  return new Promise((resolve, reject) => {
    const connect = () => {
      if (stopped) return;

      const connectUrl = wsUrl(base, { token: currentToken, code, name, mode });
      socket = new WS(connectUrl, { handshakeTimeout: 15_000 });
      socket.on("open", () => {
        backoff = 1000;
        print("\n[StarHostAI] Connected. Ctrl+C to disconnect.\n");
      });

      socket.on("message", async (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "welcome") {
          // Code exchange: the server hands back the 2-week auth token — save it.
          if (msg.token) {
            currentToken = msg.token;
            if (typeof onAuthToken === "function") {
              onAuthToken({ token: msg.token, expiresAt: msg.expiresAt });
            }
          }
          if (msg.expiresAt) {
            const daysLeft = Math.max(1, Math.round((new Date(msg.expiresAt) - Date.now()) / (1000 * 60 * 60 * 24)));
            print(`[StarHostAI] 🔑 2-Week Auth Token Active (valid ~${daysLeft} days until ${new Date(msg.expiresAt).toLocaleDateString()})`);
          }
          return;
        }
        if (msg.type === "ping") {
          send({ type: "pong" });
          return;
        }
        if (msg.type === "tool_call") {
          const { requestId, tool, args, approved } = msg;
          // Mode is sent with EVERY request so the user can flip allow/deny/auto
          // at any time from the web UI — never trust the connect-time value.
          const reqMode = msg.mode || mode;
          const result = await execute(tool, args || {}, { mode: reqMode, cwd, approved: Boolean(approved) });
          send({
            type: "result",
            requestId,
            ok: result.ok,
            data: result.ok ? result.data : undefined,
            error: result.ok ? undefined : result.error,
          });
        }
      });

      socket.on("close", (code, reason) => {
        const reasonStr = Buffer.isBuffer(reason) ? reason.toString() : String(reason || "");
        if (code === 4001) {
          stopped = true;
          if (reasonStr.includes("expired") || reasonStr.includes("auth token")) {
            print("\n[StarHostAI] ❌ 2-week auth token expired or invalid. Get a fresh 8-character connection code from StarHostAI → Connect, then run: npx github:starhost-app/starhostai-tools");
            resolve({ tokenExpired: true, rejected: true });
          } else if (reasonStr.includes("invalid connection") || reasonStr.includes("missing connection")) {
            print("\n[StarHostAI] ❌ Invalid connection code. Get a fresh 8-character code in StarHostAI → Connect and run: npx github:starhost-app/starhostai-tools");
            resolve({ invalidCode: true, rejected: true });
          } else {
            print(`\n[StarHostAI] ❌ Connection rejected (${reasonStr || "rejected"}).`);
            resolve({ rejected: true });
          }
          return;
        }
        if (code === 1001 && reasonStr === "chat closed") {
          stopped = true;
          print("\nChat Closed CLI Tools will close too");
          print("Bye.");
          resolve({ chatClosed: true });
          return;
        }
        if (code === 1001 && reasonStr === "replaced by a new connection") {
          // Only one machine can be connected per account at a time — a new
          // device paired and took over this connection.
          stopped = true;
          print("\nAnother device connected and replaced this one (only 1 machine at a time).");
          print("Bye.");
          resolve({ replaced: true });
          return;
        }
        if (code === 1001 && reasonStr === "connection revoked") {
          // This device was removed from the account in StarHostAI → Settings.
          stopped = true;
          print("\nThis device was removed from your StarHostAI account.");
          print("Bye.");
          resolve({ revoked: true });
          return;
        }
        if (code === 1001 && reasonStr === "server shutdown") {
          stopped = true;
          print("\nServer is shutting down");
          print("Bye.");
          resolve({ serverShutdown: true });
          return;
        }
        if (stopped) {
          resolve({ stopped: true });
          return;
        }
        print(`[StarHostAI] Connection lost (code ${code}), reconnecting in ${backoff / 1000}s…`);
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      });

      socket.on("error", (err) => {
        if (!stopped) print(`[StarHostAI] Socket error: ${err.message}`);
      });
    };

    const send = (obj) => {
      if (socket && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(obj));
      }
    };

    process.on("SIGINT", () => {
      stopped = true;
      try {
        socket && socket.close(1000, "user disconnect");
      } catch {
        /* ignore */
      }
      print("\n[StarHostAI] Disconnected.");
      resolve({ stopped: true });
    });

    connect();
  });
}

module.exports = { serve, wsUrl, getWebSocket };