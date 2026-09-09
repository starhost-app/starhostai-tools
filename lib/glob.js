"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Minimal glob expansion supporting `*`, `?` and `**` (recursive).
 * No external dependencies. Patterns must be absolute or relative to cwd.
 */
function expandGlob(pattern, cwd = process.cwd()) {
  const results = new Set();
  const absolute = path.isAbsolute(pattern) ? pattern : path.resolve(cwd, pattern);
  const hasMagic = /[*?]/.test(absolute);
  if (!hasMagic) {
    return fs.existsSync(absolute) ? [absolute] : [];
  }

  const parts = absolute.split(path.sep);
  const walk = (dirIndex, currentPath) => {
    if (dirIndex >= parts.length) {
      results.add(currentPath);
      return;
    }
    const part = parts[dirIndex];
    const isLast = dirIndex === parts.length - 1;

    if (part === "**") {
      // match zero or more directories
      walk(dirIndex + 1, currentPath);
      // recurse into every subdirectory
      let entries = [];
      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          walk(dirIndex, path.join(currentPath, e.name));
        }
      }
      return;
    }

    if (!/[*?]/.test(part)) {
      walk(dirIndex + 1, path.join(currentPath, part));
      return;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const regex = new RegExp(
      "^" +
        part
          .split(/(\*\*|\*|\?)/g)
          .map((seg) => {
            if (seg === "**") return ".*";
            if (seg === "*") return "[^/]*";
            if (seg === "?") return "[^/]";
            return seg.replace(/[.+^${}()|[\]\\]/g, "\\$&");
          })
          .join("") +
        "$"
    );

    for (const e of entries) {
      if (regex.test(e.name)) {
        const child = path.join(currentPath, e.name);
        if (isLast) {
          results.add(child);
        } else if (e.isDirectory()) {
          walk(dirIndex + 1, child);
        }
      }
    }
  };

  // start at the root-most existing directory
  let startIdx = 0;
  let current = path.parse(absolute).root;
  while (startIdx < parts.length && !/[*?]/.test(parts[startIdx])) {
    const next = path.join(current, parts[startIdx]);
    if (!fs.existsSync(next)) break;
    current = next;
    startIdx++;
  }
  if (startIdx >= parts.length) {
    return fs.existsSync(current) ? [current] : [];
  }
  walk(startIdx, current);

  return [...results];
}

module.exports = { expandGlob };