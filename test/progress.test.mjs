import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = resolve(".opencode/skills/gamify-progress/scripts/progress.mjs");

async function withSubject(fn) {
  const dir = await mkdtemp(join(tmpdir(), "learning-"));
  const progress = join(dir, "progress.json");
  const call = (...args) =>
    run(process.execPath, [script, ...args, "--progress", progress], { encoding: "utf8" }).then((r) =>
      JSON.parse(r.stdout),
    );
  try {
    await call("init", "--subject", "Test", "--slug", "test", "--total", "4");
    await fn({ dir, progress, call });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("init creates level 1 and refuses to overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "learning-"));
  const progress = join(dir, "progress.json");
  const call = (...args) =>
    run(process.execPath, [script, ...args, "--progress", progress], { encoding: "utf8" }).then((r) =>
      JSON.parse(r.stdout),
    );
  try {
    const out = await call("init", "--subject", "Test", "--slug", "test", "--total", "4");
    assert.equal(out.level, 1);
    assert.equal(out.total_xp, 0);
    await assert.rejects(call("init", "--subject", "Test", "--slug", "test", "--total", "4"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("complete awards score*10 and a bonus for 9/9", async () => {
  await withSubject(async ({ call }) => {
    const out = await call("complete", "--lesson", "1", "--score", "8", "--title", "OSI");
    assert.equal(out.xp_award, 80);
    assert.equal(out.current_lesson, 2);
    const perfect = await call("complete", "--lesson", "2", "--score", "9", "--title", "IP");
    assert.equal(perfect.xp_award, 100);
  });
});

test("complete rejects a failing score", async () => {
  await withSubject(async ({ call }) => {
    await assert.rejects(call("complete", "--lesson", "1", "--score", "4"));
  });
});

test("complete derives score from checks-result.json", async () => {
  await withSubject(async ({ dir, call }) => {
    const checks = join(dir, "checks-result.json");
    await writeFile(
      checks,
      JSON.stringify({
        status: "passed",
        checks: [
          { id: "a", status: "passed" },
          { id: "b", status: "passed" },
          { id: "c", status: "passed" },
        ],
      }),
      "utf8",
    );
    const out = await call("complete", "--lesson", "1", "--checks", checks);
    assert.equal(out.score, 9, "all checks passed must yield 9/9");
    assert.equal(out.xp_award, 100);
  });
});

test("complete with --checks refuses an unpassed report", async () => {
  await withSubject(async ({ dir, call }) => {
    const checks = join(dir, "checks-result.json");
    await writeFile(
      checks,
      JSON.stringify({ status: "failed", checks: [{ id: "a", status: "failed" }] }),
      "utf8",
    );
    await assert.rejects(call("complete", "--lesson", "1", "--checks", checks));
  });
});

test("attempt with --checks records a partial score without XP", async () => {
  await withSubject(async ({ dir, call }) => {
    const checks = join(dir, "checks-result.json");
    await writeFile(
      checks,
      JSON.stringify({
        status: "failed",
        checks: [
          { id: "a", status: "passed" },
          { id: "b", status: "failed" },
          { id: "c", status: "failed" },
        ],
      }),
      "utf8",
    );
    const out = await call("attempt", "--lesson", "1", "--checks", checks);
    assert.equal(out.score, 3);
    assert.equal(out.total_xp, 0);
  });
});

test("a repeated lesson is rejected without --force", async () => {
  await withSubject(async ({ call }) => {
    await call("complete", "--lesson", "1", "--score", "8");
    await assert.rejects(call("complete", "--lesson", "1", "--score", "9"));
    const forced = await call("complete", "--lesson", "1", "--score", "9", "--force");
    assert.equal(forced.score, 9);
    assert.equal(forced.total_xp, 100, "--force must replace XP, not add to it");
  });
});

test("level increases after 250 XP and XP carries over", async () => {
  await withSubject(async ({ call }) => {
    await call("complete", "--lesson", "1", "--score", "9");
    await call("complete", "--lesson", "2", "--score", "9");
    const out = await call("complete", "--lesson", "3", "--score", "7");
    assert.equal(out.total_xp, 270);
    assert.equal(out.level, 2);
    assert.equal(out.xp, 20);
    assert.equal(out.xp_to_next_level, 250);
  });
});

test("streaks increment on consecutive days and reset after a gap", async () => {
  await withSubject(async ({ call }) => {
    const first = await call("complete", "--lesson", "1", "--score", "8", "--date", "2026-01-01");
    assert.equal(first.streak, 1);
    const second = await call("complete", "--lesson", "2", "--score", "8", "--date", "2026-01-02");
    assert.equal(second.streak, 2);
    const gap = await call("complete", "--lesson", "3", "--score", "8", "--date", "2026-01-05");
    assert.equal(gap.streak, 1);
  });
});

test("badges are awarded by condition, not by request", async () => {
  await withSubject(async ({ call }) => {
    const out = await call("complete", "--lesson", "1", "--score", "9", "--title", "Subnets", "--sources");
    for (const badge of ["first_packet", "flawless", "subnet_slayer", "rfc_reader"]) {
      assert.ok(out.badges.includes(badge), `missing ${badge}`);
    }
    assert.ok(!out.badges.includes("speedrun"), "speedrun needs two lessons in one day");
    assert.ok(!out.badges.includes("boss_defeated"), "boss is the final lesson");
  });
});

test("attempt records a try without XP", async () => {
  await withSubject(async ({ progress, call }) => {
    const out = await call("attempt", "--lesson", "1", "--score", "3");
    assert.equal(out.total_xp, 0);
    const state = JSON.parse(await readFile(progress, "utf8"));
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0].lesson, 1);
    assert.equal(state.attempts[0].score, 3);
    assert.match(state.attempts[0].date, /^\d{4}-\d{2}-\d{2}$/);
  });
});

test("render embeds the progress data and escapes script closers", async () => {
  await withSubject(async ({ dir, call }) => {
    await call("complete", "--lesson", "1", "--score", "8", "--title", "OSI");
    const out = join(dir, "dashboard.html");
    await run(process.execPath, [script, "render", "--progress", join(dir, "progress.json"), "--out", out]);
    const html = await readFile(out, "utf8");
    assert.match(html, /const PROGRESS = /);
    assert.match(html, /Mодель|OSI/);
    assert.ok(!html.includes("</script></script>"));
  });
});
