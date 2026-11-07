#!/usr/bin/env node
// Детерминированный движок прогресса учебного проекта.
// Использование: node progress.mjs <init|diagnostic|attempt|complete|render> [options]

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const XP_PER_LEVEL = 250;
const PASS_SCORE = 7;
const MAX_SCORE = 9;

const LEVEL_TITLES = [
  "Newbie",
  "Signal Scout",
  "Packet Apprentice",
  "Subnet Student",
  "Network Ninja",
  "Switch Sage",
  "Routing Wizard",
  "Protocol Master",
  "Core Engineer",
  "Packet Whisperer",
];

const BADGE_DEFS = {
  first_packet: { icon: "🎓", name: "First Packet", hidden: false },
  signal_acquired: { icon: "📡", name: "Signal Acquired", hidden: false },
  three_way_handshake: { icon: "🔌", name: "Three-Way Handshake", hidden: false },
  flawless: { icon: "💯", name: "Flawless", hidden: false },
  subnet_slayer: { icon: "🧮", name: "Subnet Slayer", hidden: false },
  comeback_kid: { icon: "🧗", name: "Comeback Kid", hidden: false },
  streak_3: { icon: "🔥", name: "Streak ×3", hidden: false },
  streak_7: { icon: "🌋", name: "Streak ×7", hidden: false },
  rfc_reader: { icon: "📜", name: "RFC Reader", hidden: false },
  boss_defeated: { icon: "🏆", name: "Boss Defeated", hidden: false },
  night_owl: { icon: "🦉", name: "Night Owl", hidden: true },
  speedrun: { icon: "⚡", name: "Speedrun", hidden: true },
};

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
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
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      opts[key] = true;
      continue;
    }
    opts[key] = next;
    i += 1;
  }
  return { command, opts };
}

function fail(message) {
  console.error(`ошибка: ${message}`);
  process.exit(1);
}

function requireOption(opts, name) {
  const value = opts[name];
  if (value === undefined || value === "") fail(`не указан --${name}`);
  return value;
}

function parseIntStrict(value, name, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    fail(`--${name}: нужно целое число от ${min} до ${max}`);
  }
  return n;
}

// Локальная календарная дата, не UTC: стрик должен идти по дню ученика.
function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoDate(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("--date должен быть в формате YYYY-MM-DD");
  return value;
}

function dayDiff(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const first = Date.UTC(ay, am - 1, ad);
  const second = Date.UTC(by, bm - 1, bd);
  return Math.round((first - second) / 86400000);
}

function levelTitle(level) {
  return LEVEL_TITLES[level - 1] ?? "Legend";
}

function freshState({ subject, slug, total }) {
  return {
    subject,
    slug,
    learner: "you",
    level: 1,
    level_title: levelTitle(1),
    xp: 0,
    total_xp: 0,
    xp_to_next_level: XP_PER_LEVEL,
    current_lesson: 1,
    total_lessons: total,
    diagnostic_completed: false,
    streak: { current: 0, longest: 0, last_study_date: null, history: [] },
    lessons: [],
    attempts: [],
    badges: [],
    personal_best: { score: 0, xp_in_one_lesson: 0 },
  };
}

async function load(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`не удалось прочитать ${file}: ${error.message}`);
  }
}

async function save(file, state) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

// Оценка файлового урока выводится из checks-result.json: доля пройденных
// проверок от максимума 9. Для засчитанного урока балл не ниже проходного:
// статус passed уже означает, что все обязательные проверки прошли.
async function scoreFromChecks(file, { requirePassed }) {
  const path = resolve(String(file));
  let report;
  try {
    report = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`не удалось прочитать ${path}: ${error.message}`);
  }
  if (!Array.isArray(report.checks) || report.checks.length === 0) {
    fail(`${path}: нет списка checks`);
  }
  if (requirePassed && report.status !== "passed") {
    fail(`${path}: status = ${report.status}; урок не сдан`);
  }

  const weightOf = (c) => (Number.isFinite(Number(c.weight)) ? Number(c.weight) : 1);
  const total = report.checks.reduce((sum, c) => sum + weightOf(c), 0);
  const passed = report.checks
    .filter((c) => c.status === "passed")
    .reduce((sum, c) => sum + weightOf(c), 0);

  const raw = total > 0 ? Math.round((MAX_SCORE * passed) / total) : 0;
  const score = requirePassed ? Math.max(PASS_SCORE, raw) : raw;
  return Math.min(MAX_SCORE, Math.max(0, score));
}

// Оценка берётся либо из --score, либо из результата файловых проверок --checks.
async function resolveScore(opts, { requirePassed }) {
  if (opts.score !== undefined) {
    return parseIntStrict(opts.score, "score", 0, MAX_SCORE);
  }
  if (opts.checks === undefined || opts.checks === true) {
    fail("нужен --score <0-9> или --checks <путь к checks-result.json>");
  }
  return scoreFromChecks(String(opts.checks), { requirePassed });
}

function award(state, id) {
  if (!BADGE_DEFS[id]) fail(`неизвестный бейдж ${id}`);
  if (state.badges.includes(id)) return null;
  state.badges.push(id);
  return id;
}

function updateStreak(state, date) {
  const streak = state.streak;
  if (streak.history.includes(date)) return [];
  const added = [];
  if (!streak.last_study_date) {
    streak.current = 1;
  } else if (dayDiff(date, streak.last_study_date) === 1) {
    streak.current += 1;
  } else if (dayDiff(date, streak.last_study_date) === 0) {
    // Тот же день: стрик не меняется.
  } else {
    streak.current = 1;
  }
  streak.last_study_date = date;
  streak.longest = Math.max(streak.longest, streak.current);
  streak.history.push(date);
  if (streak.current >= 3) added.push(award(state, "streak_3"));
  if (streak.current >= 7) added.push(award(state, "streak_7"));
  return added.filter(Boolean);
}

function applyBadges(state, lesson, date, sources) {
  const added = [];
  const push = (id) => {
    const got = award(state, id);
    if (got) added.push(got);
  };

  if (lesson.id === 1) push("first_packet");
  if (state.diagnostic_completed) push("signal_acquired");
  if (state.lessons.length >= 3) push("three_way_handshake");
  if (lesson.score === MAX_SCORE) push("flawless");
  if (lesson.score === MAX_SCORE && /подсет|subnet|маск|cidr/i.test(lesson.title)) {
    push("subnet_slayer");
  }
  const earlier = state.attempts.filter((a) => a.lesson === lesson.id);
  if (earlier.some((a) => a.score <= 3)) push("comeback_kid");
  if (sources) push("rfc_reader");
  if (lesson.id === state.total_lessons) push("boss_defeated");

  const localHour = new Date().getHours();
  if (date === localDate() && localHour < 5) push("night_owl");

  const completionsToday = state.lessons.filter((l) => l.completed === date).length;
  if (completionsToday >= 2) push("speedrun");

  return added;
}

function recomputeLevel(state) {
  let level = 1;
  let remaining = state.total_xp;
  while (remaining >= XP_PER_LEVEL) {
    remaining -= XP_PER_LEVEL;
    level += 1;
  }
  state.level = level;
  state.xp = remaining;
  state.level_title = levelTitle(level);
}

function applyXp(state, amount) {
  state.total_xp += amount;
  recomputeLevel(state);
}

function summary(state, extra = {}) {
  return {
    subject: state.subject,
    level: state.level,
    level_title: state.level_title,
    xp: state.xp,
    total_xp: state.total_xp,
    xp_to_next_level: state.xp_to_next_level,
    current_lesson: state.current_lesson,
    total_lessons: state.total_lessons,
    streak: state.streak.current,
    badges: state.badges,
    ...extra,
  };
}

function renderDashboard(state) {
  const data = JSON.stringify(state).replaceAll("</script", "<\\/script");
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(state.subject)} · прогресс</title>
<style>
  :root { --bg:#0f1420; --card:#1a2233; --accent:#4ade80; --accent2:#60a5fa; --muted:#64748b; --text:#e2e8f0; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,"Segoe UI",sans-serif; background:var(--bg); color:var(--text); padding:32px; }
  h1 { margin:0 0 4px; font-size:1.6rem; }
  .sub { color:var(--muted); margin-bottom:24px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; }
  .card { background:var(--card); border-radius:14px; padding:20px; box-shadow:0 4px 20px #0004; }
  .level-row { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px; }
  .level-title { font-weight:600; color:var(--accent); }
  .bar { height:14px; background:#0b1220; border-radius:8px; overflow:hidden; }
  .bar > div { height:100%; background:linear-gradient(90deg,var(--accent2),var(--accent)); border-radius:8px; transition:width .6s; }
  .meta { display:flex; justify-content:space-between; margin-top:6px; font-size:.85rem; color:var(--muted); }
  .lessons { display:grid; grid-template-columns:repeat(auto-fill,minmax(90px,1fr)); gap:10px; margin-top:12px; }
  .lesson { text-align:center; padding:10px 4px; border-radius:10px; background:#0b1220; border:1px solid #223; font-size:.8rem; }
  .lesson.done { border-color:var(--accent); background:#0f2a1a; }
  .lesson.current { border-color:var(--accent2); box-shadow:0 0 0 2px #60a5fa55; }
  .lesson .score { font-weight:700; color:var(--accent); }
  .badges { display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; }
  .badge { padding:8px 12px; border-radius:999px; background:#0b1220; border:1px solid #223; font-size:.82rem; }
  .badge.locked { opacity:.35; filter:grayscale(1); }
  .streak { display:grid; grid-template-columns:repeat(15,1fr); gap:4px; margin-top:12px; }
  .day { aspect-ratio:1; border-radius:4px; background:#0b1220; }
  .day.on { background:var(--accent); }
  .day.today { box-shadow:0 0 0 2px var(--accent2); }
  .big { font-size:2rem; font-weight:700; }
  .muted { color:var(--muted); font-size:.85rem; }
</style>
</head>
<body>
  <h1 id="title"></h1>
  <div class="sub" id="sub"></div>
  <div class="grid">
    <div class="card">
      <div class="level-row"><span class="level-title" id="lvlTitle"></span><span class="muted" id="lvlNum"></span></div>
      <div class="bar"><div id="xpBar"></div></div>
      <div class="meta"><span id="xpText"></span><span id="toNext"></span></div>
    </div>
    <div class="card">
      <div class="muted">Стрик 🔥</div>
      <div class="big" id="streakNum"></div>
      <div class="muted" id="streakBest"></div>
      <div class="streak" id="heatmap"></div>
    </div>
    <div class="card" style="grid-column:1/-1">
      <div class="muted" style="margin-bottom:6px">Путь обучения</div>
      <div class="lessons" id="lessons"></div>
    </div>
    <div class="card" style="grid-column:1/-1">
      <div class="muted" style="margin-bottom:6px">Коллекция бейджей</div>
      <div class="badges" id="badges"></div>
    </div>
  </div>
<script>
const PROGRESS = ${data};
const BADGE_DEFS = ${JSON.stringify(BADGE_DEFS)};
const p = PROGRESS;
const $ = (id) => document.getElementById(id);
$("title").textContent = p.subject;
$("sub").textContent = "Урок " + p.current_lesson + " из " + p.total_lessons;
$("lvlTitle").textContent = "Уровень " + p.level + " · " + p.level_title;
$("lvlNum").textContent = p.xp + " / " + p.xp_to_next_level + " XP";
$("xpBar").style.width = Math.min(100, p.xp / p.xp_to_next_level * 100) + "%";
$("xpText").textContent = "⭐ " + p.xp + " XP";
$("toNext").textContent = "до уровня: " + (p.xp_to_next_level - p.xp) + " XP";
$("streakNum").textContent = p.streak.current;
$("streakBest").textContent = "рекорд: " + p.streak.longest;

const today = new Date();
const hm = $("heatmap");
for (let i = 29; i >= 0; i--) {
  const d = new Date(today); d.setDate(d.getDate() - i);
  const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const el = document.createElement("div");
  el.className = "day" + (p.streak.history.includes(iso) ? " on" : "") + (i === 0 ? " today" : "");
  el.title = iso;
  hm.appendChild(el);
}

const lm = $("lessons");
for (let i = 1; i <= p.total_lessons; i++) {
  const done = p.lessons.find((l) => l.id === i);
  const el = document.createElement("div");
  el.className = "lesson" + (done ? " done" : "") + (i === p.current_lesson ? " current" : "");
  el.innerHTML = done
    ? "<div>Урок " + i + "</div><div class='score'>" + done.score + "/9</div>"
    : "<div>Урок " + i + "</div><div class='muted'>" + (i === p.current_lesson ? "→ сейчас" : "🔒") + "</div>";
  lm.appendChild(el);
}

const bm = $("badges");
for (const [key, def] of Object.entries(BADGE_DEFS)) {
  const owned = p.badges.includes(key);
  if (def.hidden && !owned) continue;
  const el = document.createElement("div");
  el.className = "badge" + (owned ? "" : " locked");
  el.textContent = def.icon + " " + def.name;
  bm.appendChild(el);
}
</script>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[ch];
  });
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (!command) fail("нужна команда: init, diagnostic, attempt, complete, render");

  const progressPath = resolve(requireOption(opts, "progress"));
  const date = isoDate(opts.date) ?? localDate();

  if (command === "init") {
    const subject = String(requireOption(opts, "subject"));
    const slug = String(opts.slug ?? "subject");
    const total = opts.total === undefined ? 12 : parseIntStrict(opts.total, "total", 1, 100);
    const exists = await access(progressPath).then(
      () => true,
      () => false,
    );
    if (exists && !opts.force) {
      fail(`${progressPath} уже существует; не перезаписываю прогресс (для сброса передай --force)`);
    }
    const state = freshState({ subject, slug, total });
    await save(progressPath, state);
    console.log(JSON.stringify(summary(state), null, 2));
    return;
  }

  if (command === "render") {
    const state = await load(progressPath);
    const out = resolve(requireOption(opts, "out"));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, renderDashboard(state), "utf8");
    console.log(`дашборд отрисован: ${out}`);
    return;
  }

  const state = await load(progressPath);

  if (command === "diagnostic") {
    const already = state.diagnostic_completed;
    state.diagnostic_completed = true;
    const added = updateStreak(state, date);
    if (!already) {
      const badge = award(state, "signal_acquired");
      if (badge) added.push(badge);
    }
    await save(progressPath, state);
    console.log(JSON.stringify(summary(state, { added_badges: added, repeated: already }), null, 2));
    return;
  }

  if (command === "attempt") {
    const lesson = parseIntStrict(requireOption(opts, "lesson"), "lesson", 1, state.total_lessons);
    const score = await resolveScore(opts, { requirePassed: false });
    state.attempts.push({ lesson, score, date });
    const added = updateStreak(state, date);
    await save(progressPath, state);
    console.log(JSON.stringify(summary(state, { lesson, score, added_badges: added }), null, 2));
    return;
  }

  if (command === "complete") {
    const lessonId = parseIntStrict(requireOption(opts, "lesson"), "lesson", 1, state.total_lessons);
    const score = await resolveScore(opts, { requirePassed: true });
    if (score < PASS_SCORE) fail(`score ${score} ниже ${PASS_SCORE}; используй команду attempt`);
    if (state.lessons.some((l) => l.id === lessonId) && !opts.force) {
      fail(`lesson ${lessonId} уже засчитан; передай --force для перезаписи`);
    }

    const xpAward = score * 10 + (score === MAX_SCORE ? 10 : 0);
    const title = String(opts.title ?? `Урок ${lessonId}`);
    const lesson = { id: lessonId, title, score, xp: xpAward, completed: date, badges: [] };

    if (opts.force) {
      const previous = state.lessons.find((l) => l.id === lessonId);
      if (previous) {
        // Повторная запись не должна начислять XP дважды.
        state.total_xp = Math.max(0, state.total_xp - previous.xp);
        recomputeLevel(state);
        state.lessons = state.lessons.filter((l) => l.id !== lessonId);
      }
    }
    state.lessons.push(lesson);
    state.lessons.sort((a, b) => a.id - b.id);
    applyXp(state, xpAward);

    const added = updateStreak(state, date);
    added.push(...applyBadges(state, lesson, date, Boolean(opts.sources)));
    lesson.badges = [...new Set(added)];
    state.badges = [...new Set(state.badges)];

    if (score > state.personal_best.score) state.personal_best.score = score;
    if (xpAward > state.personal_best.xp_in_one_lesson) {
      state.personal_best.xp_in_one_lesson = xpAward;
    }
    state.current_lesson = Math.min(state.total_lessons, Math.max(state.current_lesson, lessonId + 1));

    await save(progressPath, state);
    console.log(JSON.stringify(summary(state, {
      lesson: lessonId,
      score,
      xp_award: xpAward,
      added_badges: [...new Set(added)],
    }), null, 2));
    return;
  }

  fail(`неизвестная команда ${command}`);
}

main().catch((error) => fail(error.message));
