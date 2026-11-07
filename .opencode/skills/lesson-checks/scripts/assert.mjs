#!/usr/bin/env node
// Минимальные утверждения для проверки файловых заданий.
// Без внешних зависимостей: YAML разбирается встроенным парсером подмножества.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      opts._.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    if (eq !== -1) {
      opts[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i += 1;
    }
  }
  return opts;
}

function fail(message) {
  console.error(`провал: ${message}`);
  process.exit(1);
}

function requireString(opts, name) {
  const value = opts[name];
  if (value === undefined || value === true) {
    console.error(`ошибка: нужен --${name}`);
    process.exit(3);
  }
  return String(value);
}

// Подмножество YAML: отступы, ключи, скаляры, списки. Достаточно для compose/конфигов.
function parseYaml(text) {
  const rawLines = text.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, value: root }];

  function scalar(raw) {
    const value = raw.trim();
    if (value === "" || value === "~" || value === "null") return null;
    if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    return value.replace(/^["']|["']$/g, "");
  }

  // Определяет, начинается ли блок под ключом со списка.
  function blockAtIsList(lines, fromIndex, parentIndent) {
    for (let i = fromIndex; i < lines.length; i += 1) {
      const candidate = lines[i];
      if (!candidate.trim() || candidate.trim().startsWith("#")) continue;
      const indent = candidate.length - candidate.trimStart().length;
      if (indent <= parentIndent) return false;
      return /^-\s+/.test(candidate.trim());
    }
    return false;
  }

  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index];
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    const listItem = line.match(/^-\s+(.*)$/);
    if (listItem) {
      if (!Array.isArray(parent)) continue;
      const rest = listItem[1];
      const keyValue = rest.match(/^([\w.-]+):\s*(.*)$/);
      if (keyValue) {
        const item = {};
        item[keyValue[1]] = scalar(keyValue[2]);
        parent.push(item);
        stack.push({ indent, value: item });
      } else {
        parent.push(scalar(rest));
      }
      continue;
    }

    const keyValue = line.match(/^([\w.-]+):\s*(.*)$/);
    if (!keyValue) continue;
    const [, key, value] = keyValue;
    if (value === "") {
      const container = blockAtIsList(rawLines, index + 1, indent) ? [] : {};
      parent[key] = container;
      stack.push({ indent, value: container });
    } else {
      parent[key] = scalar(value);
    }
  }
  return root;
}

function getPath(object, dotted) {
  return dotted.split(".").reduce((acc, part) => {
    if (acc === undefined || acc === null) return undefined;
    if (Array.isArray(acc)) return acc[Number(part)];
    return acc[part];
  }, object);
}

function valuesEqual(actual, expected) {
  return String(actual) === String(expected);
}

async function httpCheck(url, expectedStatus) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (error) {
    fail(`HTTP ${url} недоступен: ${error.message}`);
  }
  if (expectedStatus && response.status !== Number(expectedStatus)) {
    fail(`HTTP ${url} вернул ${response.status}, ожидался ${expectedStatus}`);
  }
  return response;
}

async function commandCheck(command, opts) {
  const result = await new Promise((resolvePromise) => {
    const child = spawn(command, { shell: true, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => {
      stdout += c;
    });
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    child.on("error", (error) => resolvePromise({ code: null, stdout: "", stderr: error.message }));
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });

  if (opts.exit !== undefined && opts.exit !== true && result.code !== Number(opts.exit)) {
    fail(`команда завершилась с кодом ${result.code}, ожидался ${opts.exit}\n${result.stderr.slice(0, 800)}`);
  }
  if (opts["stdout-contains"] && !result.stdout.includes(String(opts["stdout-contains"]))) {
    fail(`в stdout нет "${opts["stdout-contains"]}"\nstdout: ${result.stdout.slice(0, 800)}`);
  }
  if (opts["stderr-contains"] && !result.stderr.includes(String(opts["stderr-contains"]))) {
    fail(`в stderr нет "${opts["stderr-contains"]}"`);
  }
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.exists) {
    const target = resolve(String(opts.exists));
    if (!existsSync(target)) fail(`файл или папка не существует: ${opts.exists}`);
    console.log(`ok: существует ${opts.exists}`);
    return;
  }

  if (opts["not-exists"]) {
    const target = resolve(String(opts["not-exists"]));
    if (existsSync(target)) fail(`не должно существовать: ${opts["not-exists"]}`);
    console.log(`ok: отсутствует ${opts["not-exists"]}`);
    return;
  }

  if (opts.http) {
    const response = await httpCheck(String(opts.http), opts.status);
    console.log(`ok: HTTP ${response.status} ${opts.http}`);
    return;
  }

  if (opts.command) {
    await commandCheck(String(opts.command), opts);
    console.log("ok: команда прошла проверку");
    return;
  }

  const file = requireString(opts, "file");
  let text;
  try {
    text = await readFile(resolve(file), "utf8");
  } catch (error) {
    fail(`не удалось прочитать ${file}: ${error.message}`);
  }

  if (opts.contains !== undefined) {
    const needle = requireString(opts, "contains");
    if (!text.includes(needle)) fail(`в ${file} нет "${needle}"`);
    console.log(`ok: ${file} содержит "${needle}"`);
    return;
  }

  if (opts["not-contains"] !== undefined) {
    const needle = requireString(opts, "not-contains");
    if (text.includes(needle)) fail(`в ${file} не должно быть "${needle}"`);
    console.log(`ok: ${file} не содержит "${needle}"`);
    return;
  }

  if (opts["yaml-path"]) {
    const path = requireString(opts, "yaml-path");
    const actual = getPath(parseYaml(text), path);
    if (actual === undefined) fail(`в ${file} нет пути ${path}`);
    if (opts.equals !== undefined && !valuesEqual(actual, requireString(opts, "equals"))) {
      fail(`${file}: ${path} = ${JSON.stringify(actual)}, ожидалось "${opts.equals}"`);
    }
    console.log(`ok: ${path} = ${JSON.stringify(actual)}`);
    return;
  }

  if (opts["json-path"]) {
    const path = requireString(opts, "json-path");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      fail(`${file}: некорректный JSON — ${error.message}`);
    }
    const actual = getPath(parsed, path);
    if (actual === undefined) fail(`в ${file} нет пути ${path}`);
    if (opts.equals !== undefined && !valuesEqual(actual, requireString(opts, "equals"))) {
      fail(`${file}: ${path} = ${JSON.stringify(actual)}, ожидалось "${opts.equals}"`);
    }
    console.log(`ok: ${path} = ${JSON.stringify(actual)}`);
    return;
  }

  console.error("ошибка: не указано ни одно условие (--exists, --contains, --yaml-path, --json-path, --http, --command)");
  process.exit(3);
}

main().catch((error) => fail(error.message));
