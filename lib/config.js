"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function configDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "starhostai");
}

function configPath() {
  return path.join(configDir(), "config.json");
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
}

function clearConfig() {
  try {
    fs.rmSync(configPath(), { force: true });
  } catch {
    /* ignore */
  }
}

module.exports = { configDir, configPath, loadConfig, saveConfig, clearConfig };