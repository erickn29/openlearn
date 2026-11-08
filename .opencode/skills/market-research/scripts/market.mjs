#!/usr/bin/env node
// Сбор требований рынка с публичного поиска hh.ru.
//
// Почему HTML, а не API: api.hh.ru/vacancies без OAuth-токена отдаёт 403
// (публичный поиск закрыт с апреля 2026). Страница поиска при этом открыта,
// и весь её результат лежит в <template id="HH-Lux-InitialState">.
// Справочники (professional_roles, areas, suggests) через API доступны.
//
// Использование: node market.mjs <roles|collect|render> [options]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createClient, NetworkError } from "./lib/http.mjs";
import { MarkupError, parseSearchPage, parseVacancyPage, htmlToText } from "./lib/parse.mjs";
import { aggregateSkills, canonicalSkill, round, scanText } from "./lib/skills.mjs";
import { dedupeById, experienceStats, formatStats, salaryStats } from "./lib/stats.mjs";

const EXIT = { ok: 0, usage: 1, network: 2, markup: 3 };

const DEFAULTS = {
  area: 1,
  limit: 200,
  details: 50,
  pauseMin: 800,
  pauseMax: 1500,
  timeout: 20000,
  maxSeconds: 300,
  retries: 2,
  freshDays: 14,
  topSkills: 25,
  itemsPerPage: 100,
  userAgent: "openlearn-market/0.1 (educational learning project)",
};

const MAX_PAGES = 20; // hh отдаёт 404 после 20-й страницы: потолок 2000 позиций
const MAX_LIMIT = 2000;
const MAX_DETAILS = 200;

const HH_BASE = "https://hh.ru";
const HH_API = "https://api.hh.ru";

const WORK_FORMATS = { any: null, remote: "REMOTE", hybrid: "HYBRID", onsite: "ON_SITE" };

function fail(message, code = EXIT.usage) {
  console.error(`ошибка: ${message}`);
  process.exit(code);
}

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

function intOption(opts, name, fallback, min, max) {
  const raw = opts[name];
  if (raw === undefined) return fallback;
  const value = Number(raw === true ? NaN : raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`--${name}: нужно целое число от ${min} до ${max}`);
  }
  return value;
}

function strOption(opts, name, fallback) {
  const raw = opts[name];
  if (raw === undefined) return fallback;
  if (raw === true) fail(`--${name}: нужно значение`);
  return String(raw);
}

function flag(opts, name) {
  return opts[name] === true || opts[name] === "true" || opts[name] === "1";
}

function requireOption(opts, name) {
  const raw = opts[name];
  if (raw === undefined || raw === true || raw === "") fail(`не указан --${name}`);
  return String(raw);
}

function subjectPaths(subject) {
  const dir = resolve(subject);
  return { dir, json: join(dir, "market.json"), md: join(dir, "market.md") };
}

// Снапшот живёт в папке цели: subjects/<slug> у одиночного предмета,
// tracks/<slug> у профессии. Разница только в имени флага, путь одинаковый.
function targetDir(opts) {
  const track = opts.track;
  const subject = opts.subject;
  if (track !== undefined || subject !== undefined) {
    if (track !== undefined && subject !== undefined) {
      fail("укажи что-то одно: --subject или --track");
    }
    const value = track ?? subject;
    if (value === true || value === "") fail(`не указано значение --${track !== undefined ? "track" : "subject"}`);
    return String(value);
  }
  fail("не указан --subject <папка> или --track <папка>");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function localIso(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${hours}:${minutes}`
  );
}

// ---------- roles ----------

async function cmdRoles(opts) {
  const text = strOption(opts, "text", null);
  const client = createClient({ userAgent: DEFAULTS.userAgent, timeout: DEFAULTS.timeout, pauseMin: 0, pauseMax: 0 });
  let payload;
  try {
    // Справочник ролей открыт без токена — это единственный вызов API, который нам нужен.
    const { html } = await client.get(`${HH_API}/professional_roles`);
    payload = JSON.parse(html);
  } catch (error) {
    fail(`не удалось прочитать справочник ролей: ${error.message}`, EXIT.network);
  }
  const roles = (payload.categories ?? []).flatMap((category) =>
    (category.roles ?? []).map((role) => ({ id: Number(role.id), name: role.name, category: category.name })),
  );
  const needle = text ? text.toLowerCase() : null;
  const matched = needle
    ? roles.filter((role) => role.name.toLowerCase().includes(needle) || role.category.toLowerCase().includes(needle))
    : roles;

  if (flag(opts, "json")) {
    process.stdout.write(`${JSON.stringify({ query: text, roles: matched.slice(0, 50) }, null, 2)}\n`);
    return;
  }
  if (matched.length === 0) {
    console.log(`по запросу «${text}» ничего не нашлось. Попробуй слово из названия роли: «аналитик», «разработчик», «тестировщик».`);
    return;
  }
  const width = Math.max(...matched.slice(0, 50).map((role) => role.name.length));
  for (const role of matched.slice(0, 50)) {
    console.log(`${String(role.id).padStart(5)}  ${role.name.padEnd(width)}  ${role.category}`);
  }
}

// ---------- collect ----------

function buildSearchUrl({ role, area, format, text, page, itemsPerPage }) {
  const params = new URLSearchParams();
  params.set("items_on_page", String(itemsPerPage));
  params.set("page", String(page));
  params.set("enable_snippets", "true");
  params.set("order_by", "relevance");
  if (role) params.set("professional_role", String(role));
  if (area) params.set("area", String(area));
  if (text) params.set("text", text);
  const formatValue = WORK_FORMATS[format];
  if (formatValue) params.set("work_format", formatValue);
  return `${HH_BASE}/search/vacancy?${params.toString()}`;
}

async function resolveAreaName(client, areaId) {
  try {
    const { html } = await client.get(`${HH_API}/areas/${areaId}`);
    const payload = JSON.parse(html);
    return payload.name ?? null;
  } catch {
    return null;
  }
}

async function resolveRoleName(client, roleId) {
  if (!roleId) return null;
  try {
    const { html } = await client.get(`${HH_API}/professional_roles`);
    const payload = JSON.parse(html);
    for (const category of payload.categories ?? []) {
      for (const role of category.roles ?? []) {
        if (Number(role.id) === Number(roleId)) return role.name;
      }
    }
  } catch {
    /* имя роли не критично: соберём и без него */
  }
  return null;
}

async function cmdCollect(opts) {
  const paths = subjectPaths(targetDir(opts));

  const role = intOption(opts, "role", null, 1, 9999);
  const area = intOption(opts, "area", DEFAULTS.area, 0, 99999999);
  const format = strOption(opts, "format", "any");
  const text = strOption(opts, "text", null);
  const limit = intOption(opts, "limit", DEFAULTS.limit, 1, MAX_LIMIT);
  const details = intOption(opts, "details", DEFAULTS.details, 0, MAX_DETAILS);
  const pauseMin = intOption(opts, "pause-min", DEFAULTS.pauseMin, 0, 60000);
  const pauseMax = intOption(opts, "pause-max", DEFAULTS.pauseMax, 0, 60000);
  const timeout = intOption(opts, "timeout", DEFAULTS.timeout, 1000, 120000);
  const maxSeconds = intOption(opts, "max-seconds", DEFAULTS.maxSeconds, 0, 7200);
  const freshDays = intOption(opts, "fresh-days", DEFAULTS.freshDays, 0, 365);
  const top = intOption(opts, "top", DEFAULTS.topSkills, 1, 200);
  const itemsPerPage = intOption(opts, "per-page", DEFAULTS.itemsPerPage, 1, 100);
  const verbose = !flag(opts, "quiet");

  if (!(format in WORK_FORMATS)) fail(`--format: одно из ${Object.keys(WORK_FORMATS).join("|")}`);
  if (!role && !text) fail("нужен --role <id из `market.mjs roles`> или --text <поисковый запрос>");
  if (pauseMax < pauseMin) fail("--pause-max не может быть меньше --pause-min");

  // Свежий снапшот по тем же параметрам не пересобираем: hh за сутки не меняется
  // настолько, чтобы жечь запросы.
  if (!flag(opts, "force") && freshDays > 0) {
    try {
      const existing = await readJson(paths.json);
      const same = existing?.request?.role === role && existing?.request?.area === area && existing?.request?.format === format;
      const ageDays = (Date.now() - Date.parse(existing.collected_at)) / 86400000;
      if (same && Number.isFinite(ageDays) && ageDays < freshDays) {
        console.log(`market.json свежий (${Math.floor(ageDays)} дн.), беру кэш. Пересобрать: --force`);
        return paths;
      }
    } catch {
      /* снапшота нет — собираем */
    }
  }

  const log = verbose ? (line) => console.log(line) : () => {};
  const client = createClient({
    userAgent: strOption(opts, "user-agent", DEFAULTS.userAgent),
    timeout,
    pauseMin,
    pauseMax,
    retries: intOption(opts, "retries", DEFAULTS.retries, 0, 10),
    maxSeconds,
    log,
  });

  const budget = `пауза ${pauseMin}–${pauseMax} мс, таймаут ${timeout} мс, бюджет ${maxSeconds} с`;
  log(`сбор: роль ${role ?? "—"}, регион ${area}, формат ${format}, до ${limit} вакансий, ${details} карточек; ${budget}`);

  const collected = [];
  let totalFound = null;
  let truncated = false;
  const pages = Math.min(MAX_PAGES, Math.ceil(limit / itemsPerPage));

  for (let page = 0; page < pages; page += 1) {
    const url = buildSearchUrl({ role, area, format, text, page, itemsPerPage });
    let parsed;
    try {
      const { html } = await client.get(url);
      parsed = parseSearchPage(html, { page: `поиск, страница ${page + 1}` });
    } catch (error) {
      if (error instanceof MarkupError) fail(`${error.message}. Разметка hh изменилась — починить парсер.`, EXIT.markup);
      if (error instanceof NetworkError && error.code === "budget") {
        truncated = true;
        log("  бюджет времени исчерпан, сохраняю собранное");
        break;
      }
      if (error instanceof NetworkError && error.code === "not_found") {
        // 404 на глубокой странице — это потолок выдачи, а не ошибка.
        log(`  страница ${page + 1} за пределами выдачи, останавливаюсь`);
        break;
      }
      if (error instanceof NetworkError && error.code === "blocked") {
        fail(`${error.message}. Нужен российский IP без VPN.`, EXIT.network);
      }
      fail(`${error.message}`, EXIT.network);
    }

    totalFound = parsed.total ?? totalFound;
    collected.push(...parsed.vacancies);
    log(`  страница ${page + 1}/${pages}: ${parsed.vacancies.length} вакансий (всего найдено ${parsed.total ?? "?"})`);
    if (!parsed.has_next) break;
    if (collected.length >= limit) break;
  }

  const vacancies = dedupeById(collected).slice(0, limit);
  let detailsFetched = 0;
  let detailsFailed = 0;

  const targets = details > 0 ? vacancies.slice(0, details) : [];
  for (let index = 0; index < targets.length; index += 1) {
    const vacancy = targets[index];
    try {
      const { html } = await client.get(`${HH_BASE}/vacancy/${vacancy.id}`);
      const full = parseVacancyPage(html, { page: `карточка ${vacancy.id}` });
      vacancy.skills = full.skills;
      vacancy.description = full.description;
      if (vacancy.salary_from == null && full.salary_from != null) {
        vacancy.salary_from = full.salary_from;
        vacancy.salary_to = full.salary_to;
        vacancy.salary_currency = full.salary_currency;
        vacancy.salary_gross = full.salary_gross;
      }
      detailsFetched += 1;
    } catch (error) {
      if (error instanceof MarkupError) fail(`${error.message}. Разметка hh изменилась — починить парсер.`, EXIT.markup);
      if (error instanceof NetworkError && error.code === "budget") {
        truncated = true;
        log("  бюджет времени исчерпан на карточках, сохраняю собранное");
        break;
      }
      if (error instanceof NetworkError && error.code === "blocked") {
        fail(`${error.message}. Нужен российский IP без VPN.`, EXIT.network);
      }
      detailsFailed += 1;
      log(`  карточка ${vacancy.id}: ${error.message}`);
    }
    if (verbose && (index + 1) % 10 === 0) {
      log(`  карточек: ${index + 1}/${targets.length}`);
    }
  }

  // Навыки из карточек + упоминания в сниппетах и теле требований: у части
  // вакансий keySkills не заполнены, но текст всё равно называет технологии.
  const normalized = vacancies.map((vacancy) => {
    const declared = (vacancy.skills ?? []).map(canonicalSkill).filter(Boolean);
    const fromText = [
      ...scanText(vacancy.snippet?.requirements),
      ...scanText(htmlToText(vacancy.description)),
    ];
    return { ...vacancy, skills: [...new Set([...declared, ...fromText])], skills_declared: declared.length };
  });

  const skills = aggregateSkills(normalized, { top });
  const salary = salaryStats(normalized);
  const experience = experienceStats(normalized);
  const formats = formatStats(normalized);

  const withSkills = normalized.filter((v) => v.skills.length > 0).length;
  const withDeclared = normalized.filter((v) => v.skills_declared > 0).length;
  const withSalary = normalized.filter((v) => v.salary_from != null || v.salary_to != null).length;

  const [roleName, areaName] = await Promise.all([
    role ? resolveRoleName(client, role) : Promise.resolve(null),
    area !== DEFAULTS.area ? resolveAreaName(client, area) : Promise.resolve("Москва"),
  ]);

  const snapshot = {
    schema: 1,
    collected_at: localIso(new Date()),
    request: {
      role: role ?? null,
      role_name: roleName,
      area,
      area_name: areaName,
      format,
      text,
      limit,
      details_requested: details,
      items_per_page: itemsPerPage,
      pause_min_ms: pauseMin,
      pause_max_ms: pauseMax,
      timeout_ms: timeout,
      max_seconds: maxSeconds,
    },
    coverage: {
      total_found: totalFound,
      sampled: collected.length,
      unique: normalized.length,
      details_fetched: detailsFetched,
      details_failed: detailsFailed,
      with_skills: withSkills,
      with_skills_declared: withDeclared,
      with_salary: withSalary,
      truncated,
      elapsed_seconds: round(client.elapsed() / 1000, 1),
    },
    skills: skills.skills,
    skills_base: skills.base,
    experience,
    formats,
    salary,
    vacancies: normalized,
  };

  await writeJson(paths.json, snapshot);
  console.log(
    `собрано: ${snapshot.coverage.unique} уникальных из ${totalFound ?? "?"}, ` +
      `карточек ${detailsFetched}, с навыками ${withSkills}, за ${snapshot.coverage.elapsed_seconds} с`,
  );
  console.log(paths.json);
  return paths;
}

// ---------- render ----------

const EXPERIENCE_ORDER = ["noExperience", "between1And3", "between3And6", "moreThan6"];

function pct(share) {
  return `${Math.round(share * 100)}%`;
}

function formatSalary(salary) {
  if (!salary || salary.n === 0) return "нет данных";
  const money = (value) => `${Math.round(value / 1000)} тыс.`;
  const gross = salary.currency === "RUR" ? " ₽" : ` ${salary.currency}`;
  return `${money(salary.p25)} / ${money(salary.median)} / ${money(salary.p75)}${gross} (p25 / медиана / p75, n=${salary.n})`;
}

function renderMarkdown(snapshot) {
  const { request, coverage, skills, skills_base: skillsBase, experience, formats, salary } = snapshot;
  const lines = [];

  const role = request.role_name ?? (request.text ? `«${request.text}»` : "—");
  const areaName = request.area_name ?? `регион ${request.area}`;
  const formatLabel = { any: "любой формат", remote: "удалёнка", hybrid: "гибрид", onsite: "офис" }[request.format] ?? request.format;

  lines.push(`# Требования рынка: ${role}`);
  lines.push("");
  // Первая строка — рамка выборки. Дальше любые проценты читаются уже с поправкой.
  lines.push(
    `> ${areaName} · ${formatLabel} · собрано ${coverage.unique} из ${coverage.total_found ?? "?"} вакансий ` +
      `(${coverage.details_fetched} карточек с полным текстом) · ${request.collected_at?.slice(0, 10) ?? snapshot.collected_at.slice(0, 10)}`,
  );
  lines.push("");
  lines.push(
    `Источник — публичный поиск hh.ru. Это срез выдачи на дату, а не рынок целиком: одна роль, один регион, ` +
      `один момент времени. Вакансии без навыков и без зарплаты в расчёт долей не входят.`,
  );
  lines.push("");

  if (coverage.truncated) {
    lines.push("> Сбор прерван по бюджету времени: данные неполные, перезапусти с большим `--max-seconds`.");
    lines.push("");
  }

  lines.push("## Навыки");
  lines.push("");
  lines.push(`Доля считается от ${skillsBase} вакансий с заполненными навыками (из ${coverage.unique} собранных).`);
  if (coverage.with_skills_declared > 0 && coverage.with_skills_declared < skillsBase) {
    lines.push("");
    lines.push(
      `Из них ${coverage.with_skills_declared} с навыками, указанными работодателем явно; ` +
        `остальные — навыки, найденные в тексте требований.`,
    );
  } else if (coverage.with_skills_declared === 0 && skillsBase > 0) {
    lines.push("");
    lines.push("Карточки не тянулись: все навыки найдены в тексте сниппетов, а не в `keySkills`.");
  }
  lines.push("");
  if (skillsBase > 0 && skillsBase < 20) {
    lines.push(
      `> **Выборка мала:** навыки есть только у ${skillsBase} вакансий. Проценты ниже — ориентир для плана, ` +
        `а не статистика рынка. Для устойчивых цифр нужно 200+ вакансий и 50+ карточек.`,
    );
    lines.push("");
  }
  if (skills.length === 0) {
    lines.push("Навыки не собраны. Запусти с `--details 50`, чтобы подтянуть карточки.");
  } else {
    lines.push("| Навык | Вакансий | Доля |");
    lines.push("| --- | --- | --- |");
    for (const skill of skills) {
      lines.push(`| ${skill.name} | ${skill.count} | ${pct(skill.share)} |`);
    }
  }
  lines.push("");

  lines.push("## Опыт");
  lines.push("");
  if (experience.known === 0) {
    lines.push("нет данных");
  } else {
    lines.push("| Опыт | Вакансий | Доля |");
    lines.push("| --- | --- | --- |");
    for (const key of EXPERIENCE_ORDER) {
      const item = experience.counts[key];
      if (!item || item.count === 0) continue;
      lines.push(`| ${item.label} | ${item.count} | ${pct(item.share)} |`);
    }
  }
  lines.push("");

  lines.push("## Формат работы");
  lines.push("");
  if (formats.length === 0) {
    lines.push("нет данных");
  } else {
    // Подписи берём заново: старые снапшоты могли сохранить сырой код формата.
    const formatLabels = { REMOTE: "удалённо", HYBRID: "гибрид", ON_SITE: "офис", FIELD_WORK: "разъездная" };
    for (const item of formats) {
      lines.push(`- ${formatLabels[item.key] ?? item.label}: ${item.count} (${pct(item.share)})`);
    }
  }
  lines.push("");

  lines.push("## Зарплаты");
  lines.push("");
  lines.push(formatSalary(salary));
  if (coverage.with_salary < coverage.unique) {
    lines.push("");
    lines.push(`Зарплата указана в ${coverage.with_salary} из ${coverage.unique} вакансий — медиана по остальным неизвестна.`);
  }
  lines.push("");

  lines.push("## Что делать с этим файлом");
  lines.push("");
  lines.push(
    "Учитель заполняет в `plan.md` раздел «Требования рынка → уроки»: навык с долей **30% и выше** " +
      "либо закрыт уроком, либо явно отнесён к «сознательно вне программы» с причиной.",
  );
  lines.push("");
  lines.push(`Пересобрать снапшот: \`/market\` (пишет только \`market.mjs\`, руками не править).`);

  return `${lines.join("\n")}\n`;
}

async function cmdRender(opts) {
  const paths = subjectPaths(targetDir(opts));
  let snapshot;
  try {
    snapshot = await readJson(paths.json);
  } catch (error) {
    fail(`нет market.json в ${paths.dir}: сначала запусти collect (${error.message})`, EXIT.usage);
  }
  const markdown = renderMarkdown(snapshot);
  await writeFile(paths.md, markdown, "utf8");
  console.log(paths.md);
  return paths;
}

// ---------- main ----------

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || flag(opts, "help")) {
    console.log(`market.mjs — требования рынка с hh.ru

  roles   --text "аналитик"                        подобрать id роли
  collect --subject subjects/<slug> [options]      собрать снапшот в market.json
  collect --track tracks/<slug> [options]          то же для трека профессии
  render  --subject subjects/<slug>                отрисовать market.md
  render  --track tracks/<slug>                    отрисовать market.md трека

Параметры collect:
  --role <id>        роль из справочника hh
  --text <строка>    свободный поисковый запрос (вместо --role)
  --area <id>        регион hh, по умолчанию 1 (Москва)
  --format           any|remote|hybrid|onsite
  --limit <n>        сколько вакансий из поиска взять, по умолчанию ${DEFAULTS.limit}
  --details <n>      сколько карточек дотянуть, по умолчанию ${DEFAULTS.details}, 0 — не тянуть
  --pause-min <мс>   нижняя граница паузы, по умолчанию ${DEFAULTS.pauseMin}
  --pause-max <мс>   верхняя граница паузы, по умолчанию ${DEFAULTS.pauseMax}
  --timeout <мс>     таймаут одного запроса, по умолчанию ${DEFAULTS.timeout}
  --max-seconds <с>  бюджет на весь сбор, по умолчанию ${DEFAULTS.maxSeconds}, 0 — без лимита
  --retries <n>      повторы на 429/5xx/таймаут, по умолчанию ${DEFAULTS.retries}
  --fresh-days <n>   не пересобирать свежий снапшот, по умолчанию ${DEFAULTS.freshDays}
  --force            пересобрать несмотря на свежесть
  --top <n>          сколько навыков писать, по умолчанию ${DEFAULTS.topSkills}

Коды выхода: 0 ок, 1 параметры, 2 сеть, 3 разметка hh изменилась.`);
    return EXIT.ok;
  }

  if (command === "roles") {
    await cmdRoles(opts);
    return EXIT.ok;
  }
  if (command === "collect") {
    await cmdCollect(opts);
    return EXIT.ok;
  }
  if (command === "render") {
    await cmdRender(opts);
    return EXIT.ok;
  }
  fail(`неизвестная команда «${command}». Доступно: roles, collect, render.`);
}

try {
  process.exitCode = await main();
} catch (error) {
  fail(error?.stack ?? String(error), EXIT.network);
}
