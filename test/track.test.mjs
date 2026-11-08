import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = resolve(".opencode/skills/gamify-progress/scripts/progress.mjs");

// Трек живёт в отдельной песочнице: subjects/ и tracks/ под одним корнем,
// ровно как в репозитории.
async function withTrack(fn) {
  const root = await mkdtemp(join(tmpdir(), "track-"));
  const subjects = join(root, "subjects");
  const track = join(root, "tracks", "python-backend");

  const progressCall = (slug, ...args) =>
    run(process.execPath, [script, ...args, "--progress", join(subjects, slug, "progress.json")], {
      encoding: "utf8",
    });

  const trackCall = (...args) =>
    run(process.execPath, [script, "track", ...args, "--track", track, "--subjects", subjects], {
      encoding: "utf8",
    });

  const readTrack = async () => {
    const page = await readFile(join(track, "dashboard.html"), "utf8");
    return JSON.parse(page.match(/const TRACK = (.+);\n/)[1]);
  };

  async function section(slug, title, total) {
    await mkdir(join(subjects, slug), { recursive: true });
    await progressCall(slug, "init", "--subject", title, "--slug", slug, "--total", String(total));
  }

  async function plan(slug, minutes) {
    const rows = minutes.map((m, i) => `| ${i + 1} | Урок ${i + 1} | ${m} | результат |`).join("\n");
    await writeFile(
      join(subjects, slug, "plan.md"),
      `# ${slug}\n\n| № | Тема | мин | Результат |\n| --- | --- | --- | --- |\n${rows}\n`,
      "utf8",
    );
  }

  try {
    await fn({ root, subjects, track, progressCall, trackCall, readTrack, section, plan });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("track init пишет track.json с секциями по порядку", async () => {
  await withTrack(async ({ track, trackCall, section }) => {
    await section("python-core", "Python: ядро", 4);
    await section("git-basics", "Git", 3);

    const out = JSON.parse(
      (
        await trackCall(
          "init",
          "--title", "Python backend",
          "--role", "96",
          "--section", "git-basics:2",
          "--section", "python-core:1",
        )
      ).stdout,
    );
    assert.equal(out.sections, 2);
    assert.equal(out.totals.lessons_total, 7);

    const spec = JSON.parse(await readFile(join(track, "track.json"), "utf8"));
    assert.deepEqual(spec.sections.map((s) => s.slug), ["python-core", "git-basics"]);
    assert.equal(spec.sections[0].order, 1);
    assert.equal(spec.role.hh_id, 96);
    assert.equal(spec.sections[0].title, "Python: ядро", "название берётся из progress.json секции");
  });
});

test("track init отвергает дубли, отсутствующие секции и плохой slug", async () => {
  await withTrack(async ({ trackCall, section }) => {
    await section("python-core", "Python", 3);
    await section("git-basics", "Git", 3);

    await assert.rejects(trackCall("init", "--section", "python-core:1", "--section", "python-core:2"));
    await assert.rejects(trackCall("init", "--section", "python-core:1", "--section", "git-basics:1"));
    await assert.rejects(trackCall("init", "--section", "no-such-section:1"));
    await assert.rejects(trackCall("init", "--section", "python_core:1"));
    await assert.rejects(trackCall("init"));
  });
});

test("track init не перезаписывает трек без --force", async () => {
  await withTrack(async ({ trackCall, section }) => {
    await section("python-core", "Python", 3);
    await trackCall("init", "--section", "python-core:1");
    await assert.rejects(trackCall("init", "--section", "python-core:1"));
    const forced = await trackCall("init", "--section", "python-core:1", "--force");
    assert.equal(JSON.parse(forced.stdout).sections, 1);
  });
});

test("track render суммирует XP и считает уровень по сумме, а не по уровням", async () => {
  await withTrack(async ({ trackCall, section, progressCall }) => {
    await section("python-core", "Python", 4);
    await section("git-basics", "Git", 4);
    await trackCall("init", "--section", "python-core:1", "--section", "git-basics:2");

    // 9/9 = 100 XP, 9/9 = 100 XP на первой секции; 8/9 = 80 XP на второй.
    await progressCall("python-core", "complete", "--lesson", "1", "--score", "9");
    await progressCall("python-core", "complete", "--lesson", "2", "--score", "9");
    await progressCall("git-basics", "complete", "--lesson", "1", "--score", "8");

    const out = JSON.parse((await trackCall("render")).stdout);
    assert.equal(out.totals.total_xp, 280);
    assert.equal(out.totals.level, 2, "уровень считается по сумме XP, а не по сумме уровней");
    assert.equal(out.totals.xp, 30);
    assert.equal(out.totals.lessons_done, 3);
    assert.equal(out.totals.lessons_total, 8);
    assert.equal(out.totals.sections_done, 0);
    assert.equal(out.totals.complete, false);
    assert.equal(out.next.slug, "python-core");
  });
});

test("track render склеивает стрики по уникальным датам", async () => {
  await withTrack(async ({ trackCall, section, progressCall, readTrack }) => {
    await section("python-core", "Python", 4);
    await section("git-basics", "Git", 4);
    await trackCall("init", "--section", "python-core:1", "--section", "git-basics:2");

    await progressCall("python-core", "complete", "--lesson", "1", "--score", "8", "--date", "2026-01-01");
    await progressCall("python-core", "complete", "--lesson", "2", "--score", "8", "--date", "2026-01-02");
    // Тот же день в другой секции не должен удвоить стрик.
    await progressCall("git-basics", "complete", "--lesson", "1", "--score", "8", "--date", "2026-01-02");
    await progressCall("git-basics", "complete", "--lesson", "2", "--score", "8", "--date", "2026-01-03");

    await trackCall("render");
    const data = await readTrack();
    assert.equal(data.streak.current, 3);
    assert.equal(data.streak.longest, 3);
    assert.deepEqual(data.streak.history, ["2026-01-01", "2026-01-02", "2026-01-03"]);
    assert.equal(data.totals.lessons_done, 4);
  });
});

test("track render объединяет бейджи без дублей", async () => {
  await withTrack(async ({ trackCall, section, progressCall, readTrack }) => {
    await section("python-core", "Python", 10);
    await section("git-basics", "Git", 10);
    await trackCall("init", "--section", "python-core:1", "--section", "git-basics:2");
    await progressCall("python-core", "complete", "--lesson", "1", "--score", "9");
    await progressCall("git-basics", "complete", "--lesson", "1", "--score", "9");

    await trackCall("render");
    const data = await readTrack();
    assert.deepEqual(data.badges.sort(), ["first_packet", "flawless"]);
  });
});

test("track render переживает секцию без progress.json", async () => {
  await withTrack(async ({ trackCall, section, subjects, readTrack }) => {
    await section("python-core", "Python", 4);
    await mkdir(join(subjects, "git-basics"), { recursive: true });
    await trackCall("init", "--section", "python-core:1", "--section", "git-basics:2");

    const out = JSON.parse((await trackCall("render")).stdout);
    assert.equal(out.totals.lessons_total, 4, "секция без прогресса не ломает агрегат");

    const data = await readTrack();
    const git = data.sections.find((s) => s.slug === "git-basics");
    assert.equal(git.status, "not_started");
    assert.equal(git.lessons_total, 0);
  });
});

test("track render суммирует минуты из plan.md секций", async () => {
  await withTrack(async ({ trackCall, section, plan, progressCall }) => {
    await section("python-core", "Python", 3);
    await section("git-basics", "Git", 2);
    await plan("python-core", [20, 25, 15]);
    await plan("git-basics", [20, 20]);
    await trackCall("init", "--section", "python-core:1", "--section", "git-basics:2");
    await progressCall("python-core", "complete", "--lesson", "1", "--score", "8");

    const out = JSON.parse((await trackCall("render")).stdout);
    assert.equal(out.totals.minutes_total, 100);
    assert.equal(out.totals.minutes_done, 20);
    assert.equal(out.totals.minutes_left, 80);
  });
});

test("минуты не выдумываются, если в plan.md нет колонки «мин»", async () => {
  await withTrack(async ({ trackCall, section, subjects }) => {
    await section("python-core", "Python", 2);
    await writeFile(join(subjects, "python-core", "plan.md"), "# Python\n\nПросто текст без таблицы.\n", "utf8");
    await trackCall("init", "--section", "python-core:1");

    const out = JSON.parse((await trackCall("render")).stdout);
    assert.equal(out.totals.minutes_total, null);
    assert.equal(out.totals.minutes_left, null);
  });
});

test("трек закрыт только когда закрыты все обязательные секции", async () => {
  await withTrack(async ({ trackCall, section, progressCall }) => {
    await section("python-core", "Python", 2);
    await section("fastapi", "FastAPI", 2);
    await trackCall("init", "--section", "python-core:1", "--section", "fastapi:2:optional");

    await progressCall("python-core", "complete", "--lesson", "1", "--score", "8");
    await progressCall("python-core", "complete", "--lesson", "2", "--score", "8");

    const out = JSON.parse((await trackCall("render")).stdout);
    assert.equal(out.totals.complete, true, "необязательная секция не держит трек открытым");
    assert.equal(out.totals.sections_done, 1);
    assert.equal(out.next, null);
  });
});

test("track render пишет только внутрь папки трека", async () => {
  await withTrack(async ({ trackCall, section, progressCall, subjects }) => {
    await section("python-core", "Python", 2);
    await trackCall("init", "--section", "python-core:1");
    await progressCall("python-core", "complete", "--lesson", "1", "--score", "8");

    const before = await readFile(join(subjects, "python-core", "progress.json"), "utf8");
    await trackCall("render");
    const after = await readFile(join(subjects, "python-core", "progress.json"), "utf8");
    assert.equal(after, before, "трек не имеет права менять прогресс секций");
  });
});

test("дашборд трека ссылается на дашборды секций относительным путём", async () => {
  await withTrack(async ({ trackCall, section, track }) => {
    await section("python-core", "Python", 2);
    await trackCall("init", "--section", "python-core:1");
    await trackCall("render");

    const page = await readFile(join(track, "dashboard.html"), "utf8");
    assert.match(page, /"\.\.\/\.\.\/subjects\/" \+ s\.slug \+ "\/dashboard\.html"/, "ссылка относительная");
    assert.match(page, /const TRACK = /);
    assert.ok(!page.includes("</script></script>"), "данные экранированы внутри файла");
  });
});

test("track render умеет писать дашборд по явному --out", async () => {
  await withTrack(async ({ trackCall, section, root }) => {
    await section("python-core", "Python", 2);
    await trackCall("init", "--section", "python-core:1");
    const out = join(root, "custom", "track.html");
    await trackCall("render", "--out", out);
    const page = await readFile(out, "utf8");
    assert.match(page, /const TRACK = /);
  });
});
