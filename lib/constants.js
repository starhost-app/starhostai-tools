"use strict";

/**
 * The StarHostAI server this connector pairs with.
 *
 * Users just run `npx github:starhost-app/starhostai-tools` — no --server
 * flag needed, and the first run asks for their 8-character connection
 * code. STARHOSTAI_URL env var / saved config / --server flag can still
 * override this for development.
 */
const DEFAULT_SERVER_URL = "https://ai.starhost.app";

module.exports = { DEFAULT_SERVER_URL };