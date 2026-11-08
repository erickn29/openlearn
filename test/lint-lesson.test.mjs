import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = resolve(".opencode/skills/lesson-generator/scripts/lint-lesson.mjs");

const GOOD_THEORY = `# Срезы списка

> ≈20 мин · чтение 6 мин · практика 14 мин

## Зачем это в работе

Срезы — это основной способ взять часть ответа API, не копируя список целиком.

## Идея

Срез берёт полуинтервал: левая граница входит, правая нет.

\`\`\`python
items = ["a", "b", "c", "d"]
print(items[1:3])
\`\`\`

## Где это в работе

Разбиение ответа на страницы и отрезание служебного префикса в логах.
`;

const GOOD_TASKS = `# Задания

## Задание 1

Что вернёт \`items[1:3]\`?

## Задание 2

Собери в \`work/answer.py\` функцию \`first_n\`.
`;

const GOOD_KEY = `# Ключ

## Задание 1

Вернёт \`["b", "c"]\`.

## Задание 2

\`\`\`python
def first_n(items, n):
    return items[:n]
\`\`\`
`;

async function withLesson(fn, files = {}) {
  const dir = await mkdtemp(join(tmpdir(), "lesson-lint-"));
  await mkdir(dir, { recursive: true });
  const defaults = { "theory.md": GOOD_THEORY, "tasks.md": GOOD_TASKS, "answer-key.md": GOOD_KEY };
  for (const [name, content] of Object.entries({ ...defaults, ...files })) {
    if (content === null) continue;
    await writeFile(join(dir, name), content, "utf8");
  }
  // Нарушения — это код выхода 1 с корректным JSON: execFile на таком падает,
  // поэтому разбираем stdout вручную.
  const lint = async (...args) => {
    try {
      const result = await run(process.execPath, [script, "--lesson", dir, "--json", ...args], {
        encoding: "utf8",
      });
      return JSON.parse(result.stdout);
    } catch (error) {
      if (typeof error.stdout === "string" && error.stdout.trim().startsWith("{")) {
        return JSON.parse(error.stdout);
      }
      throw error;
    }
  };
  try {
    await fn({ dir, lint });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("хороший урок проходит без нарушений", async () => {
  await withLesson(async ({ lint }) => {
    const out = await lint();
    assert.equal(out.ok, true, JSON.stringify(out.violations));
    assert.deepEqual(out.violations, []);
  });
});

test("линтер падает на пропущенном файле", async () => {
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.equal(out.ok, false);
      assert.ok(out.violations.some((v) => v.rule === "files" && v.message.includes("answer-key.md")));
    },
    { "answer-key.md": null },
  );
});

test("линтер падает, когда теория длиннее пяти абзацев прозы", async () => {
  const bloated = GOOD_THEORY.replace(
    "## Где это в работе",
    `${Array.from({ length: 6 }, (_, i) => `Абзац номер ${i + 1} про срезы, которого здесь быть не должно.`).join("\n\n")}

## Где это в работе`,
  );
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.equal(out.ok, false);
      const paragraph = out.violations.find((v) => v.rule === "paragraphs");
      assert.ok(paragraph, "должно быть нарушение по абзацам");
      assert.match(paragraph.message, /[6-9] абзацев/);
    },
    { "theory.md": bloated },
  );
});

test("код и списки не считаются абзацами прозы", async () => {
  const listsOnly = `# Тема

> ≈18 мин · чтение 5 мин · практика 13 мин

## Зачем это в работе

Коротко.

## Идея

- пункт один
- пункт два
- пункт три

| a | b |
| --- | --- |
| 1 | 2 |

\`\`\`sh
echo hi
\`\`\`

## Где это в работе

Тоже коротко.
`;
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.equal(out.ok, true, JSON.stringify(out.violations));
    },
    { "theory.md": listsOnly },
  );
});

test("линтер требует блок кода", async () => {
  const noCode = GOOD_THEORY.replace(/```python[\s\S]*?```/, "");
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.ok(out.violations.some((v) => v.rule === "code"));
    },
    { "theory.md": noCode },
  );
});

test("линтер требует разделы «Зачем» и «Где»", async () => {
  const noWhy = GOOD_THEORY.replace("## Зачем это в работе", "## Вступление").replace(
    "## Где это в работе",
    "## Итог",
  );
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      const rules = out.violations.filter((v) => v.rule === "sections");
      assert.equal(rules.length, 2);
    },
    { "theory.md": noWhy },
  );
});

test("линтер требует оценку времени и следит за диапазоном", async () => {
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.ok(out.violations.some((v) => v.rule === "duration"));
    },
    { "theory.md": GOOD_THEORY.replace("> ≈20 мин · чтение 6 мин · практика 14 мин", "") },
  );

  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.ok(out.violations.some((v) => v.rule === "duration" && /вне диапазона/.test(v.message)));
    },
    { "theory.md": GOOD_THEORY.replace("≈20 мин", "≈45 мин") },
  );
});

test("линтер следит, чтобы практика была не меньше чтения", async () => {
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.ok(out.violations.some((v) => v.rule === "duration" && /практика/.test(v.message)));
    },
    { "theory.md": GOOD_THEORY.replace("чтение 6 мин · практика 14 мин", "чтение 15 мин · практика 5 мин") },
  );
});

test("линтер требует минимум два задания", async () => {
  const oneTask = "# Задания\n\n## Задание 1\n\nОдин вопрос.\n";
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.ok(out.violations.some((v) => v.rule === "tasks"));
    },
    { "tasks.md": oneTask, "answer-key.md": "# Ключ\n\n## Задание 1\n\nОтвет.\n" },
  );
});

test("линтер требует ответ на каждое задание", async () => {
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      const key = out.violations.find((v) => v.rule === "key");
      assert.ok(key, "должно быть нарушение по ключу");
      assert.match(key.message, /2/);
    },
    { "answer-key.md": "# Ключ\n\n## Задание 1\n\nТолько первый ответ.\n" },
  );
});

test("линтер проверяет checks.json: пустой список и run без teardown", async () => {
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.ok(out.violations.some((v) => v.rule === "checks" && /пуст/.test(v.message)));
    },
    { "checks.json": JSON.stringify({ checks: [] }) },
  );

  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.ok(out.violations.some((v) => v.rule === "checks" && /teardown/.test(v.message)));
    },
    {
      "checks.json": JSON.stringify({
        checks: [{ id: "up", type: "run", command: "docker compose up -d" }],
      }),
    },
  );
});

test("линтер принимает корректный checks.json", async () => {
  await withLesson(
    async ({ lint }) => {
      const out = await lint();
      assert.equal(out.ok, true, JSON.stringify(out.violations));
    },
    {
      "checks.json": JSON.stringify({
        checks: [
          { id: "file", type: "static", command: "node assert.mjs --file work/a.py" },
          { id: "run", type: "run", command: "python work/a.py", teardown: "rm -rf work/out" },
        ],
      }),
    },
  );
});
