#!/usr/bin/env node
// Structural validation for OpenCode V2 config in this repo.
// Catches the common failure modes: V1 agent keys, malformed permission rules,
// missing skill frontmatter, and non-kebab-case skill IDs.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const errors = [];
const warn = [];

const LEGACY_AGENT_KEYS = ["permission", "tools", "prompt", "disable", "maxSteps", "temperature", "top_p"];
const MODES = new Set(["primary", "subagent", "all"]);
const EFFECTS = new Set(["allow", "deny", "ask"]);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text, broken: true };
  const raw = text.slice(3, end);
  const body = text.slice(end + 4);
  const data = {};
  let currentKey = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (top) {
      currentKey = top[1];
      const value = top[2].trim();
      data[currentKey] = value === "" ? [] : value.replace(/^["']|["']$/g, "");
      continue;
    }
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      const inline = item[1].match(/^([\w-]+):\s*(.*)$/);
      if (inline) {
        data[currentKey].push({ [inline[1]]: inline[2].replace(/^["']|["']$/g, "") });
      } else {
        data[currentKey].push(item[1]);
      }
      continue;
    }
    const nested = line.match(/^\s{2,}([\w-]+):\s*(.*)$/);
    if (nested && currentKey && Array.isArray(data[currentKey]) && data[currentKey].length) {
      const last = data[currentKey][data[currentKey].length - 1];
      if (last && typeof last === "object") last[nested[1]] = nested[2].replace(/^["']|["']$/g, "");
    }
  }
  return { data, body, broken: false };
}

async function list(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function checkConfig() {
  for (const file of ["opencode.json", "opencode.jsonc"]) {
    let text;
    try {
      text = await readFile(join(root, file), "utf8");
    } catch {
      continue;
    }
    try {
      JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
    } catch (error) {
      errors.push(`${file}: invalid JSON — ${error.message}`);
    }
    if (!text.includes("$schema")) warn.push(`${file}: missing $schema`);
  }
}

async function checkAgents() {
  const dir = join(root, ".opencode", "agents");
  for (const entry of await list(dir)) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = relative(root, join(dir, entry.name));
    const text = await readFile(join(dir, entry.name), "utf8");
    const { data, body, broken } = parseFrontmatter(text);
    if (broken) errors.push(`${path}: unterminated frontmatter`);
    if (!data.description) errors.push(`${path}: missing description`);
    if (!MODES.has(data.mode)) errors.push(`${path}: mode must be primary|subagent|all (got ${data.mode})`);
    if (!body.trim()) errors.push(`${path}: empty system prompt`);
    for (const key of LEGACY_AGENT_KEYS) {
      if (key in data) errors.push(`${path}: legacy V1 key "${key}"`);
    }
    const rules = data.permissions;
    if (!Array.isArray(rules) || rules.length === 0) {
      errors.push(`${path}: permissions must be a non-empty list`);
      continue;
    }
    for (const rule of rules) {
      if (typeof rule !== "object") {
        errors.push(`${path}: malformed permission rule`);
        continue;
      }
      if (!rule.action || !rule.resource) errors.push(`${path}: rule needs action and resource`);
      if (!EFFECTS.has(rule.effect)) errors.push(`${path}: bad effect "${rule.effect}"`);
    }
    // A trailing blanket deny silently overrides every allow before it.
    for (const action of ["edit", "shell", "subagent", "read"]) {
      const matching = rules.filter((r) => r.action === action && r.resource === "*");
      const denyIndex = matching.findIndex((r) => r.effect === "deny");
      if (denyIndex === -1) continue;
      const lastAllow = rules.map((r) => r.action === action && r.effect === "allow").lastIndexOf(true);
      const denyAt = rules.indexOf(matching[denyIndex]);
      if (lastAllow > denyAt) {
        warn.push(`${path}: ${action} allow after blanket deny (intentional last-match-wins; verify)`);
      }
    }
  }
}

async function checkSkills() {
  const dir = join(root, ".opencode", "skills");
  for (const entry of await list(dir)) {
    if (!entry.isDirectory()) continue;
    if (!KEBAB.test(entry.name)) errors.push(`skills/${entry.name}: id must be kebab-case`);
    const file = join(dir, entry.name, "SKILL.md");
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      errors.push(`skills/${entry.name}: missing SKILL.md`);
      continue;
    }
    const { data } = parseFrontmatter(text);
    if (!data.name) warn.push(`skills/${entry.name}: missing name`);
    if (!data.description) errors.push(`skills/${entry.name}: missing description (skill will not be advertised)`);
  }
}

async function checkCommands() {
  const dir = join(root, ".opencode", "commands");
  for (const entry of await list(dir)) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = relative(root, join(dir, entry.name));
    const text = await readFile(join(dir, entry.name), "utf8");
    const { data, body, broken } = parseFrontmatter(text);
    if (broken) errors.push(`${path}: unterminated frontmatter`);
    if (!data.description) warn.push(`${path}: missing description`);
    if (!body.trim()) errors.push(`${path}: empty template`);
    if ("template" in data) errors.push(`${path}: template belongs in the body, not frontmatter`);
  }
}

await checkConfig();
await checkAgents();
await checkSkills();
await checkCommands();

for (const message of warn) console.warn(`warn: ${message}`);
if (errors.length) {
  for (const message of errors) console.error(`error: ${message}`);
  process.exit(1);
}
console.log("config ok");
