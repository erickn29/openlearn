import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MarkupError, decodeEntities, parseSearchPage, parseVacancyPage, htmlToText } from "../.opencode/skills/market-research/scripts/lib/parse.mjs";
import { canonicalSkill, aggregateSkills, scanText, normalizeKey } from "../.opencode/skills/market-research/scripts/lib/skills.mjs";
import { salaryStats, experienceStats, formatStats, dedupeById, percentile, salaryPoint } from "../.opencode/skills/market-research/scripts/lib/stats.mjs";
import { randomPause } from "../.opencode/skills/market-research/scripts/lib/http.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", ".opencode", "skills", "market-research", "fixtures");

// Фикстуры хранятся сжатыми: страница выдачи весит 1.3 МБ.
const readFixture = async (name) => gunzipSync(await readFile(join(fixtures, `${name}.html.gz`))).toString("utf8");

const searchHtml = await readFixture("search-role156-area1");
const vacancyHtml = await readFixture("vacancy-sample");

test("decodeEntities разворачивает числовые и именованные сущности", () => {
  assert.equal(decodeEntities("&#34;a&#34; &amp; &#171;b&#187;"), '"a" & «b»');
  assert.equal(decodeEntities("&lt;p&gt;"), "<p>");
});

test("parseSearchPage достаёт выдачу из HH-Lux-InitialState", () => {
  const page = parseSearchPage(searchHtml);
  assert.equal(page.total, 546);
  assert.equal(page.vacancies.length, 20);
  assert.equal(page.per_page, 20);
  assert.equal(page.has_next, true);
  const first = page.vacancies[0];
  assert.match(first.id, /^\d+$/);
  assert.ok(first.name.length > 0);
  assert.ok(first.employer, "название работодателя должно быть заполнено");
  assert.ok(first.snippet?.requirements, "при enable_snippets сниппет требований есть");
});

test("parseSearchPage разворачивает обёртки workFormats и professionalRoleIds", () => {
  const page = parseSearchPage(searchHtml);
  const withFormats = page.vacancies.find((v) => v.work_formats.length > 0);
  assert.ok(withFormats, "хотя бы одна вакансия должна иметь формат работы");
  for (const value of withFormats.work_formats) assert.equal(typeof value, "string");
  const withRoles = page.vacancies.find((v) => v.roles.length > 0);
  assert.ok(withRoles, "роли должны разворачиваться в числа");
  for (const value of withRoles.roles) assert.equal(typeof value, "number");
});

test("parseSearchPage падает MarkupError на чужой разметке", () => {
  assert.throws(() => parseSearchPage("<html><body>nope</body></html>"), MarkupError);
  assert.throws(() => parseSearchPage("<template id=\"HH-Lux-InitialState\">{bad json}</template>"), MarkupError);
  assert.throws(() => parseSearchPage(""), MarkupError);
});

test("parseVacancyPage достаёт навыки и описание", () => {
  const vacancy = parseVacancyPage(vacancyHtml);
  assert.equal(vacancy.id, "139095845");
  assert.ok(vacancy.name.length > 0);
  assert.ok(vacancy.skills.length >= 3, "keySkills должны разбираться");
  assert.ok(vacancy.description.length > 500, "описание должно быть полным");
  assert.ok(vacancy.experience, "опыт должен нормализоваться в один из кодов hh");
});

test("parseVacancyPage падает MarkupError без vacancyView", () => {
  assert.throws(() => parseVacancyPage("<template id=\"HH-Lux-InitialState\">{}</template>"), MarkupError);
});

test("htmlToText превращает описание в плоский текст", () => {
  const text = htmlToText("<p>Требования:</p><ul><li>SQL</li><li>Python</li></ul>");
  assert.match(text, /Требования:/);
  assert.match(text, /• SQL/);
  assert.ok(!text.includes("<li>"));
});

test("canonicalSkill сводит алиасы к одному названию", () => {
  assert.equal(canonicalSkill("MSSQL"), "MS SQL");
  assert.equal(canonicalSkill("MS SQL Server"), "MS SQL");
  assert.equal(canonicalSkill("Postgres"), "PostgreSQL");
  assert.equal(canonicalSkill("k8s"), "Kubernetes");
  assert.equal(canonicalSkill("Docker-compose"), "Docker");
  assert.equal(canonicalSkill("C++"), "C++");
  assert.equal(canonicalSkill("Power BI"), "Power BI");
  assert.equal(canonicalSkill("   "), null);
});

test("normalizeKey сохраняет значимую пунктуацию", () => {
  assert.equal(normalizeKey("C#"), "c#");
  assert.equal(normalizeKey("Node.js"), "node.js");
  assert.equal(normalizeKey("MS   SQL"), "ms sql");
  assert.equal(normalizeKey("Golang"), "golang");
});

test("aggregateSkills считает долю от вакансий с навыками", () => {
  const vacancies = [
    ...Array.from({ length: 8 }, () => ({ skills: ["SQL", "Python"] })),
    ...Array.from({ length: 2 }, () => ({ skills: ["PostgreSQL"] })),
    ...Array.from({ length: 10 }, () => ({ skills: [] })),
  ];
  const result = aggregateSkills(vacancies);
  assert.equal(result.base, 10, "база — только вакансии с навыками");
  assert.equal(result.skills[0].name, "Python");
  assert.equal(result.skills[0].count, 8);
  assert.equal(result.skills[0].share, 0.8);
  const postgres = result.skills.find((s) => s.name === "PostgreSQL");
  assert.equal(postgres.share, 0.2);
});

test("aggregateSkills не считает дубли внутри одной вакансии", () => {
  const result = aggregateSkills([{ skills: ["SQL", "SQL", "sql"] }]);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].count, 1);
});

test("scanText находит технологии в свободном тексте и не ловит короткие алиасы", () => {
  const hits = scanText("Опыт работы с PostgreSQL и Python, знание Docker и Kubernetes, SQL обязателен");
  for (const skill of ["PostgreSQL", "Python", "Docker", "Kubernetes", "SQL"]) {
    assert.ok(hits.includes(skill), `должен найти ${skill}`);
  }
  assert.ok(!hits.includes("Go"), "короткий алиас не должен срабатывать на служебное слово");
});

test("scanText не находит навык внутри другого слова", () => {
  const hits = scanText("Работа с базой данных и котиками");
  assert.ok(!hits.includes("SQL"));
});

test("salaryPoint сводит вилку к середине", () => {
  assert.equal(salaryPoint({ salary_from: 100000, salary_to: 200000 }), 150000);
  assert.equal(salaryPoint({ salary_from: 100000, salary_to: null }), 100000);
  assert.equal(salaryPoint({ salary_from: null, salary_to: 90000 }), 90000);
  assert.equal(salaryPoint({ salary_from: null, salary_to: null }), null);
});

test("percentile интерполирует на чётной выборке", () => {
  assert.equal(percentile([1, 2, 3], 0.5), 2);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([10], 0.75), 10);
  assert.equal(percentile([], 0.5), null);
});

test("salaryStats игнорирует вакансии без зарплаты и чужие валюты", () => {
  const stats = salaryStats([
    { salary_from: 100000, salary_to: 200000, salary_currency: "RUR" },
    { salary_from: 300000, salary_to: null, salary_currency: "RUR" },
    { salary_from: null, salary_to: null },
    { salary_from: 5000, salary_to: 5000, salary_currency: "USD" },
  ]);
  assert.equal(stats.n, 2);
  // Линейная интерполяция по двум точкам [150000, 300000]: p25=187500, p75=262500.
  assert.equal(stats.median, 225000);
  assert.equal(stats.p25, 187500);
  assert.equal(stats.p75, 262500);
  assert.equal(stats.currency, "RUR");
});

test("salaryStats возвращает нули на пустой выборке", () => {
  const stats = salaryStats([]);
  assert.equal(stats.n, 0);
  assert.equal(stats.median, null);
});

test("experienceStats считает доли по известным значениям", () => {
  const stats = experienceStats([
    { experience: "noExperience" },
    { experience: "between1And3" },
    { experience: "between1And3" },
    { experience: null },
  ]);
  assert.equal(stats.known, 3);
  assert.equal(stats.unknown, 1);
  assert.equal(stats.counts.between1And3.share, 0.667);
  assert.equal(stats.counts.between1And3.label, "1–3 года");
});

test("formatStats подписывает известные форматы и не теряет неизвестные", () => {
  const stats = formatStats([
    { work_formats: ["REMOTE", "HYBRID"] },
    { work_formats: ["REMOTE"] },
    { work_formats: ["FIELD_WORK"] },
    { work_formats: [] },
  ]);
  const remote = stats.find((item) => item.key === "REMOTE");
  assert.equal(remote.count, 2);
  assert.equal(remote.share, 0.5);
  assert.equal(remote.label, "удалённо");
  const field = stats.find((item) => item.key === "FIELD_WORK");
  assert.equal(field.label, "разъездная");
});

test("dedupeById склеивает дубли и дополняет навыки", () => {
  const result = dedupeById([
    { id: "1", name: "a", skills: [] },
    { id: "1", name: "a", skills: ["SQL"] },
    { id: "2", name: "b", skills: [] },
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].skills, ["SQL"]);
});

test("randomPause укладывается в диапазон 800–1500 мс", () => {
  for (let i = 0; i < 200; i += 1) {
    const value = randomPause(800, 1500);
    assert.ok(value >= 800 && value <= 1500, `${value} вне диапазона`);
    assert.equal(Number.isInteger(value), true);
  }
  // обратный порядок аргументов не должен ломать диапазон
  const reversed = randomPause(1500, 800);
  assert.ok(reversed >= 800 && reversed <= 1500);
});
