#!/usr/bin/env node
// Детерминированный запуск проверок файловых заданий.
// Использование:
//   node check.mjs --lesson subjects/<slug>/lessons/lesson_1 [--allow-exec] [--only id]
//   node check.mjs --lesson ... --list

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MAX_OUTPUT = 4000;
const DEFAULT_TIMEOUT = 60;

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

function fail(message, code = 3) {
  console.error(`ошибка: ${message}`);
  process.exit(code);
}

function truncate(value) {
  const text = String(value ?? "");
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT)}\n… (обрезано, всего ${text.length} символов)`;
}

function runCommand(command, { cwd, timeoutSeconds }) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({
        exit_code: null,
        duration_ms: Date.now() - started,
        stdout: "",
        stderr: `не удалось запустить: ${error.message}`,
        timed_out: false,
        spawn_error: true,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exit_code: code,
        duration_ms: Date.now() - started,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        timed_out: timedOut,
        spawn_error: false,
      });
    });
  });
}

function validateCheck(check, index) {
  const where = `checks[${index}]`;
  if (!check || typeof check !== "object") fail(`${where}: должен быть объектом`);
  if (!check.id) fail(`${where}: нет id`);
  if (!check.command) fail(`${where}: нет command`);
  if (!["static", "run"].includes(check.type)) {
    fail(`${where}: type должен быть static или run`);
  }
  if (check.teardown && typeof check.teardown !== "string") {
    fail(`${where}: teardown должен быть строкой`);
  }
  return {
    id: String(check.id),
    title: String(check.title ?? check.id),
    type: check.type,
    command: String(check.command),
    teardown: check.teardown ? String(check.teardown) : null,
    timeout_seconds: Number(check.timeout_seconds ?? DEFAULT_TIMEOUT),
    required: check.required !== false,
    weight: Number(check.weight ?? 1),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.lesson || opts.lesson === true) fail("нужен --lesson <папка урока>");

  const lessonDir = resolve(String(opts.lesson));
  const checksPath = join(lessonDir, "checks.json");
  let spec;
  try {
    spec = JSON.parse(await readFile(checksPath, "utf8"));
  } catch (error) {
    fail(`не удалось прочитать ${checksPath}: ${error.message}`);
  }

  if (!Array.isArray(spec.checks) || spec.checks.length === 0) {
    fail("checks.json: массив checks пуст");
  }

  const checks = spec.checks.map(validateCheck);

  if (opts.list) {
    for (const check of checks) {
      const teardown = check.type === "run" ? (check.teardown ? "teardown" : "NO_TEARDOWN") : "-";
      console.log(
        `${check.id}\t${check.type}\t${check.required ? "required" : "optional"}\t${teardown}\t${check.title}`,
      );
    }
    return;
  }

  const only = opts.only && opts.only !== true ? String(opts.only) : null;
  const selected = only ? checks.filter((c) => c.id === only) : checks;
  if (only && selected.length === 0) fail(`нет проверки с id ${only}`);

  const allowExec = Boolean(opts["allow-exec"]);
  const startedAt = new Date().toISOString();
  const results = [];

  for (const check of selected) {
    if (check.type === "run" && !allowExec) {
      results.push({
        id: check.id,
        title: check.title,
        type: check.type,
        required: check.required,
        weight: check.weight,
        status: "skipped",
        reason: "run-проверка требует --allow-exec",
      });
      continue;
    }

    console.error(`→ ${check.id}: ${check.command}`);
    if (check.type === "run" && !check.teardown) {
      console.error(`  предупреждение: run-проверка ${check.id} без teardown`);
    }
    const result = await runCommand(check.command, {
      cwd: lessonDir,
      timeoutSeconds: check.timeout_seconds,
    });

    if (check.teardown) {
      const cleanup = await runCommand(check.teardown, {
        cwd: lessonDir,
        timeoutSeconds: check.timeout_seconds,
      });
      result.teardown_exit_code = cleanup.exit_code;
      if (cleanup.exit_code !== 0) {
        result.teardown_stderr = cleanup.stderr;
      }
    }

    const status = result.timed_out || result.spawn_error || result.exit_code !== 0 ? "failed" : "passed";
    results.push({
      id: check.id,
      title: check.title,
      type: check.type,
      required: check.required,
      weight: check.weight,
      status,
      ...result,
    });
  }

  const failed = results.filter((r) => r.status === "failed");
  const skipped = results.filter((r) => r.status === "skipped");
  const requiredFailed = failed.some((r) => r.required);
  const requiredSkipped = skipped.some((r) => r.required);

  let status = "passed";
  if (requiredFailed) status = "failed";
  else if (requiredSkipped) status = "incomplete";

  const report = {
    lesson: spec.lesson ?? null,
    lesson_dir: lessonDir,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    allow_exec: allowExec,
    status,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === "passed").length,
      failed: failed.length,
      skipped: skipped.length,
      required_failed: failed.filter((r) => r.required).length,
      required_skipped: skipped.filter((r) => r.required).length,
    },
    checks: results,
  };

  const out = join(lessonDir, "checks-result.json");
  await mkdir(lessonDir, { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(report.summary, null, 2));
  console.error(`результат: ${status} → ${out}`);

  if (status === "failed") process.exit(1);
  if (status === "incomplete") process.exit(2);
}

main().catch((error) => fail(error.message));
