---
description: Показать прогресс и перегенерировать дашборд
agent: study-orchestrator
---

Покажи прогресс по предмету: $ARGUMENTS

1. Найди `subjects/<slug>/progress.json` (если slug не указан — единственный или последний изменённый).
2. Перегенерируй дашборд:

```sh
node .opencode/skills/gamify-progress/scripts/progress.mjs render \
  --progress subjects/<slug>/progress.json \
  --out subjects/<slug>/dashboard.html
```

3. Выведи в чат: уровень, XP, стрик, пройденные уроки, следующие 1–2 темы, новые бейджи.
4. Не придумывай XP и бейджи, если файла нет — предложи начать предмет.
