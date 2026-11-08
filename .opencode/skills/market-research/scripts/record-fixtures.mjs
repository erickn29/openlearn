#!/usr/bin/env node
// Перезапись фикстур с живого hh.ru.
//
// Нужен, когда hh меняет разметку: снимаем свежие страницы, и тесты сразу
// показывают, что именно сломалось. Запускать редко и вручную, не в CI.
//
// Использование:
//   node .opencode/skills/market-research/scripts/record-fixtures.mjs [--role 156] [--area 1]

import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "./lib/http.mjs";
import { extractState } from "./lib/parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const role = option("role", "156");
const area = option("area", "1");

const client = createClient({
  userAgent: "openlearn-market/0.1 (educational learning project)",
  pauseMin: 800,
  pauseMax: 1500,
  log: (line) => console.log(line),
});

async function save(name, html) {
  // Сжимаем: страница выдачи весит 1.3 МБ, в git это лишние мегабайты.
  const body = gzipSync(Buffer.from(html, "utf8"), { level: 9 });
  const file = join(fixtures, `${name}.html.gz`);
  await mkdir(fixtures, { recursive: true });
  await writeFile(file, body);
  console.log(`${file} — ${Math.round(body.length / 1024)} КБ (из ${Math.round(html.length / 1024)} КБ)`);
}

const searchUrl =
  `https://hh.ru/search/vacancy?area=${area}&professional_role=${role}` +
  "&items_on_page=20&page=0&enable_snippets=true&order_by=relevance";

console.log("запрос выдачи:", searchUrl);
const search = await client.get(searchUrl);
if (search.url !== searchUrl && !search.url.includes("/search/vacancy")) {
  throw new Error(`hh перенаправил на ${search.url}: похоже, нужен российский IP`);
}

const state = extractState(search.html);
const first = state.vacancySearchResult?.vacancies?.[0];
if (!first) throw new Error("в выдаче нет вакансий: нечего записывать в фикстуру");

await save(`search-role${role}-area${area}`, search.html);
console.log(`первая вакансия: ${first.vacancyId} — ${first.name}`);

const cardUrl = `https://hh.ru/vacancy/${first.vacancyId}`;
console.log("запрос карточки:", cardUrl);
const card = await client.get(cardUrl);
await save("vacancy-sample", card.html);

console.log("\nготово. Прогони тесты: node --test test/market.test.mjs");
