#!/usr/bin/env node
// Проверка авторского формата урока.
//
// Ловит то, что модель при спешке делает предсказуемо: забыла файл, написала
// теорию на две страницы, не дала примера кода, не сказала, сколько урок
// займёт. Это не оценка качества — только измеримые правила из
// lesson-generator/SKILL.md.
//
// Использование:
//   node lint-lesson.mjs --lesson subjects/<slug>/lessons/lesson_3
//   node lint-lesson.mjs --lesson ... --json
//
// Коды выхода: 0 — всё в порядке, 1 — есть нарушения.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MAX_PARAGRAPHS = 5;
const MIN_TASKS = 2;
const MAX_MINUTES = 30;
const MIN_MINUTES = 10;

const REQUIRED_FILES = ["theory.md", "tasks.md", "answer-key.md"];
const REQUIRED_SECTIONS = [
  { re: /зачем это в работе/i, label: "«Зачем это в работе»" },
  { re: /где это в работе|где пригодится/i, label: "«Где это в работе»" },
];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      opts[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      opts[token.slice(2)] = true;
    } else {
      opts[token.slice(2)] = next;
      i += 1;
    }
  }
  return opts;
}

// Разбивает markdown на прозу и «не прозу». Прозой считаются только обычные
// строки текста: код, списки, таблицы, заголовки и цитаты не грузят ученика так,
// как абзац связного текста, поэтому в лимит абзацев не входят.
function proseParagraphs(markdown) {
  const paragraphs = [];
  let buffer = [];
  let inFence = false;
  let inFrontmatter = false;

  const flush = () => {
    if (buffer.length > 0) paragraphs.push(buffer.join(" ").trim());
    buffer = [];
  };

  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (i === 0 && line.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === "---") inFrontmatter = false;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;

    const trimmed = line.trim();
    const isStructural =
      trimmed === "" ||
      trimmed.startsWith("#") ||
      trimmed.startsWith(">") ||
      trimmed.startsWith("|") ||
      /^([-*+]|\d+[.)])\s+/.test(trimmed) ||
      trimmed.startsWith("<");

    if (isStructural) {
      flush();
      continue;
    }
    buffer.push(trimmed);
  }
  flush();
  return paragraphs;
}

function hasCodeBlock(markdown) {
  return /(^|\n)\s*(?<fence>```|~~~)[^\n]*\n[\s\S]*?\n\s*\k<fence>/m.test(markdown);
}

// Шапка вида «> ≈20 мин · чтение 6 мин · практика 14 мин».
// Ищем только в начале файла: иначе «5 мин» из тела урока будет принято за шапку.
function parseDuration(markdown) {
  const head = markdown.split(/\r?\n/).slice(0, 15).join("\n");
  const match = head.match(/[≈~]?\s*(\d{1,3})\s*мин/);
  if (!match) return null;
  const total = Number(match[1]);
  if (!Number.isFinite(total) || total <= 0) return null;
  const reading = head.match(/чтени[\p{L}]*\s*[:—-]?\s*(\d{1,3})\s*мин/iu);
  const practice = head.match(/практик[\p{L}]*\s*[:—-]?\s*(\d{1,3})\s*мин/iu);
  return {
    total,
    reading: reading ? Number(reading[1]) : null,
    practice: practice ? Number(practice[1]) : null,
  };
}

// Задания нумеруются в tasks.md заголовками или пунктами: «1.», «## Задание 1».
function countTasks(markdown) {
  const headings = markdown.match(/^#{2,4}\s*(задание|task)\s*(\d+)/gim) ?? [];
  if (headings.length > 0) return headings.map((h) => h.match(/(\d+)/)[1]);
  const items = markdown.match(/^(\d+)[.)]\s+\S/gm) ?? [];
  return items.map((item) => item.match(/^(\d+)/)[1]);
}

// Каждое задание должно быть отражено в ключе: ищем упоминание номера.
function missingInKey(ids, keyMarkdown) {
  return ids.filter((id) => {
    const patterns = [
      new RegExp(`(^|\\D)${id}\\s*[.)]`, "m"),
      new RegExp(`задани[ея]\\s*${id}(?!\\d)`, "i"),
      new RegExp(`^#{1,6}\\s*${id}\\b`, "m"),
    ];
    return !patterns.some((re) => re.test(keyMarkdown));
  });
}

async function exists(path) {
  return readFile(path, "utf8").then(
    () => true,
    () => false,
  );
}

async function lintLesson(dir) {
  const violations = [];
  const add = (rule, message) => violations.push({ rule, message });

  for (const file of REQUIRED_FILES) {
    if (!(await exists(join(dir, file)))) add("files", `нет файла ${file}`);
  }
  const theory = await readFile(join(dir, "theory.md"), "utf8").catch(() => null);
  if (theory === null) return violations;

  const paragraphs = proseParagraphs(theory);
  if (paragraphs.length > MAX_PARAGRAPHS) {
    add(
      "paragraphs",
      `в theory.md ${paragraphs.length} абзацев прозы, максимум ${MAX_PARAGRAPHS}: раздели урок или вынеси часть в tasks.md`,
    );
  }

  if (!hasCodeBlock(theory)) {
    add("code", "в theory.md нет блока кода — пример обязателен");
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!section.re.test(theory)) {
      add("sections", `в theory.md нет раздела ${section.label}`);
    }
  }

  const duration = parseDuration(theory);
  if (!duration) {
    add("duration", "в шапке theory.md нет оценки времени в формате «≈20 мин»");
  } else {
    if (duration.total < MIN_MINUTES || duration.total > MAX_MINUTES) {
      add("duration", `урок на ${duration.total} мин вне диапазона ${MIN_MINUTES}–${MAX_MINUTES}: это уже не атомарный урок`);
    }
    if (duration.reading != null && duration.practice != null) {
      if (duration.practice < duration.reading) {
        add("duration", `практика ${duration.practice} мин меньше чтения ${duration.reading} мин: упор должен быть на практику`);
      }
    }
  }

  const tasks = await readFile(join(dir, "tasks.md"), "utf8").catch(() => null);
  const key = await readFile(join(dir, "answer-key.md"), "utf8").catch(() => null);

  if (tasks !== null) {
    const ids = countTasks(tasks);
    if (ids.length < MIN_TASKS) {
      add("tasks", `в tasks.md ${ids.length} заданий, нужно минимум ${MIN_TASKS}`);
    } else if (key !== null) {
      const missing = missingInKey(ids, key);
      if (missing.length > 0) {
        add("key", `в answer-key.md нет ответа на задания: ${missing.join(", ")}`);
      }
    }
  }

  const checksPath = join(dir, "checks.json");
  if (await exists(checksPath)) {
    let spec = null;
    try {
      spec = JSON.parse(await readFile(checksPath, "utf8"));
    } catch (error) {
      add("checks", `checks.json не разбирается: ${error.message}`);
    }
    if (spec) {
      if (!Array.isArray(spec.checks) || spec.checks.length === 0) {
        add("checks", "checks.json: список checks пуст");
      } else {
        for (const check of spec.checks) {
          if (check?.type === "run" && !check.teardown) {
            add("checks", `checks.json: у run-проверки «${check.id ?? "?"}» нет teardown`);
          }
        }
      }
    }
  }

  return violations;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.lesson || opts.lesson === true) {
    console.error("ошибка: нужен --lesson <папка урока>");
    process.exit(1);
  }
  const dir = resolve(String(opts.lesson));
  const violations = await lintLesson(dir);

  if (opts.json) {
    console.log(JSON.stringify({ lesson: dir, ok: violations.length === 0, violations }, null, 2));
  } else if (violations.length === 0) {
    console.log(`урок в порядке: ${dir}`);
  } else {
    console.error(`урок не проходит проверку формата: ${dir}`);
    for (const violation of violations) {
      console.error(`  [${violation.rule}] ${violation.message}`);
    }
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`ошибка: ${error.message}`);
  process.exit(1);
});
