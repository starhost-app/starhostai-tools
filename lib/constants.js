"use strict";

/**
 * The StarHostAI server this connector pairs with.
 *
 * Fill this in with your real domain before publishing, e.g.:
 *   "https://starhostai.example.com"
 *
 * Users then just run `npx github:starhost-app/starhostai-tools` — no
 * --server flag needed, and the first run asks for their 8-character
 * connection code. The CLI falls back to http://localhost:3000 only when
 * this is still empty and no STARHOSTAI_URL env var / config value is set
 * (local development).
 */
const DEFAULT_SERVER_URL = "";

module.exports = { DEFAULT_SERVER_URL };