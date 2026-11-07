import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const assertScript = resolve(".opencode/skills/lesson-checks/scripts/assert.mjs");
const checkScript = resolve(".opencode/skills/lesson-checks/scripts/check.mjs");

function assertCall(...args) {
  return run(process.execPath, [assertScript, ...args], { encoding: "utf8" });
}

async function withLesson(fn) {
  const dir = await mkdtemp(join(tmpdir(), "lesson-"));
  await mkdir(join(dir, "work"), { recursive: true });
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const COMPOSE = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    depends_on:
      - api
  api:
    image: node:20-alpine
    environment:
      NODE_ENV: production
`;

test("assert --exists and --not-exists", async () => {
  await withLesson(async (dir) => {
    await writeFile(join(dir, "work", "a.js"), "x", "utf8");
    const ok = await assertCall("--exists", join(dir, "work", "a.js"));
    assert.match(ok.stdout, /ok/);
    await assert.rejects(assertCall("--not-exists", join(dir, "work", "a.js")));
  });
});

test("assert --contains and --not-contains", async () => {
  await withLesson(async (dir) => {
    const file = join(dir, "work", "a.js");
    await writeFile(file, "module.exports = 1;\n", "utf8");
    await assertCall("--file", file, "--contains", "module.exports");
    await assert.rejects(assertCall("--file", file, "--not-contains", "module.exports"));
  });
});

test("assert parses YAML paths", async () => {
  await withLesson(async (dir) => {
    const file = join(dir, "work", "compose.yaml");
    await writeFile(file, COMPOSE, "utf8");
    await assertCall("--file", file, "--yaml-path", "services.web.image", "--equals", "nginx:alpine");
    await assertCall("--file", file, "--yaml-path", "services.api.environment.NODE_ENV", "--equals", "production");
    await assert.rejects(
      assertCall("--file", file, "--yaml-path", "services.web.image", "--equals", "redis"),
    );
  });
});

test("assert parses YAML lists under a key", async () => {
  await withLesson(async (dir) => {
    const file = join(dir, "work", "compose.yaml");
    await writeFile(file, COMPOSE, "utf8");
    await assertCall("--file", file, "--yaml-path", "services.web.depends_on.0", "--equals", "api");
    await assertCall("--file", file, "--yaml-path", "services.web.ports.0", "--equals", "8080:80");
  });
});

test("assert parses JSON paths", async () => {
  await withLesson(async (dir) => {
    const file = join(dir, "work", "data.json");
    await writeFile(file, JSON.stringify({ items: [{ id: 42 }] }), "utf8");
    await assertCall("--file", file, "--json-path", "items.0.id", "--equals", "42");
    await assert.rejects(assertCall("--file", file, "--json-path", "items.0.id", "--equals", "7"));
  });
});

test("assert --command checks exit code and stdout", async () => {
  await assertCall("--command", "node -e \"console.log('OK')\"", "--exit", "0", "--stdout-contains", "OK");
  await assert.rejects(assertCall("--command", "node -e \"process.exit(1)\"", "--exit", "0"));
});

test("assert --http checks a live endpoint", async () => {
  const server = await import("node:http").then(({ createServer }) =>
    createServer((req, res) => {
      res.writeHead(req.url === "/health" ? 200 : 404).end("ok");
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    await assertCall("--http", `http://127.0.0.1:${port}/health`, "--status", "200");
    await assert.rejects(assertCall("--http", `http://127.0.0.1:${port}/missing`, "--status", "200"));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("check.mjs: static checks pass and write a report", async () => {
  await withLesson(async (dir) => {
    await writeFile(join(dir, "work", "compose.yaml"), COMPOSE, "utf8");
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(join(dir, "scripts", "assert.mjs"), await readFile(assertScript, "utf8"), "utf8");
    // Пути в checks.json относительны папки урока.
    await writeFile(
      join(dir, "checks.json"),
      JSON.stringify({
        lesson: 1,
        checks: [
          { id: "file", type: "static", command: "node scripts/assert.mjs --exists work/compose.yaml" },
          {
            id: "image",
            type: "static",
            command:
              "node scripts/assert.mjs --file work/compose.yaml --yaml-path services.web.image --equals nginx:alpine",
          },
        ],
      }),
      "utf8",
    );

    const out = await run(process.execPath, [checkScript, "--lesson", dir], { encoding: "utf8" });
    const report = JSON.parse(await readFile(join(dir, "checks-result.json"), "utf8"));
    assert.equal(report.status, "passed");
    assert.equal(report.summary.passed, 2);
    assert.match(out.stdout, /passed/);
  });
});

test("check.mjs: failing required check exits 1", async () => {
  await withLesson(async (dir) => {
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(join(dir, "scripts", "assert.mjs"), await readFile(assertScript, "utf8"), "utf8");
    await writeFile(
      join(dir, "checks.json"),
      JSON.stringify({
        lesson: 1,
        checks: [{ id: "missing", type: "static", command: "node scripts/assert.mjs --exists work/nope.js" }],
      }),
      "utf8",
    );
    await assert.rejects(run(process.execPath, [checkScript, "--lesson", dir], { encoding: "utf8" }));
    const report = JSON.parse(await readFile(join(dir, "checks-result.json"), "utf8"));
    assert.equal(report.status, "failed");
  });
});

test("check.mjs: run checks are skipped without --allow-exec", async () => {
  await withLesson(async (dir) => {
    await writeFile(
      join(dir, "checks.json"),
      JSON.stringify({
        lesson: 1,
        checks: [{ id: "docker", type: "run", command: "exit 0" }],
      }),
      "utf8",
    );
    await assert.rejects(
      run(process.execPath, [checkScript, "--lesson", dir], { encoding: "utf8" }),
      (error) => error.code === 2,
    );
    const report = JSON.parse(await readFile(join(dir, "checks-result.json"), "utf8"));
    assert.equal(report.status, "incomplete");
    assert.equal(report.checks[0].status, "skipped");
  });
});

test("check.mjs: --list marks run checks without teardown", async () => {
  await withLesson(async (dir) => {
    await writeFile(
      join(dir, "checks.json"),
      JSON.stringify({
        lesson: 1,
        checks: [
          { id: "docker", type: "run", command: "exit 0" },
          { id: "docker-ok", type: "run", command: "exit 0", teardown: "exit 0" },
          { id: "static", type: "static", command: "exit 0" },
        ],
      }),
      "utf8",
    );
    const out = await run(process.execPath, [checkScript, "--lesson", dir, "--list"], { encoding: "utf8" });
    assert.match(out.stdout, /docker\trun\trequired\tNO_TEARDOWN/);
    assert.match(out.stdout, /docker-ok\trun\trequired\tteardown/);
    assert.match(out.stdout, /static\tstatic\trequired\t-/);
  });
});

test("check.mjs: --only runs a single check", async () => {  await withLesson(async (dir) => {
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(join(dir, "scripts", "assert.mjs"), await readFile(assertScript, "utf8"), "utf8");
    await writeFile(join(dir, "work", "a.txt"), "hi", "utf8");
    await writeFile(
      join(dir, "checks.json"),
      JSON.stringify({
        lesson: 1,
        checks: [
          { id: "a", type: "static", command: "node scripts/assert.mjs --exists work/a.txt" },
          { id: "b", type: "static", command: "node scripts/assert.mjs --exists work/missing.txt" },
        ],
      }),
      "utf8",
    );
    const out = await run(process.execPath, [checkScript, "--lesson", dir, "--only", "a"], { encoding: "utf8" });
    const report = JSON.parse(await readFile(join(dir, "checks-result.json"), "utf8"));
    assert.equal(report.status, "passed");
    assert.equal(report.checks.length, 1);
    assert.match(out.stdout, /passed/);
  });
});
