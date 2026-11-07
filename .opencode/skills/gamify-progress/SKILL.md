---
name: gamify-progress
description: Обновляет XP, уровни, стрики и бейджи и рисует офлайн-дашборд предмета. Используй после каждой проверки урока или диагностики.
---

# Геймификация прогресса

`progress.json` — единственный источник правды. Никогда не редактируй его вручную; запускай скрипт.

## Команды

```sh
# Создать файл прогресса предмета
node .opencode/skills/gamify-progress/scripts/progress.mjs init \
  --progress subjects/<slug>/progress.json \
  --subject "Компьютерные сети" --slug computer-networks --total 12

# Отметить диагностику пройденной (выдаёт signal_acquired)
node .opencode/skills/gamify-progress/scripts/progress.mjs diagnostic \
  --progress subjects/<slug>/progress.json

# Записать неудачную или частичную попытку (без XP)
node .opencode/skills/gamify-progress/scripts/progress.mjs attempt \
  --progress subjects/<slug>/progress.json --lesson 1 --score 3

# Засчитать урок (начисляет XP и бейджи)
node .opencode/skills/gamify-progress/scripts/progress.mjs complete \
  --progress subjects/<slug>/progress.json --lesson 1 --score 8 \
  --title "Модель OSI и TCP/IP" --sources

# Засчитать файловый урок: оценка выводится из checks-result.json
node .opencode/skills/gamify-progress/scripts/progress.mjs complete \
  --progress subjects/<slug>/progress.json --lesson 1 \
  --checks subjects/<slug>/lessons/lesson_1/checks-result.json \
  --title "docker compose"

# Неудачная файловая попытка: та же логика, но без XP
node .opencode/skills/gamify-progress/scripts/progress.mjs attempt \
  --progress subjects/<slug>/progress.json --lesson 1 \
  --checks subjects/<slug>/lessons/lesson_1/checks-result.json

# Перерисовать дашборд после любого изменения
node .opencode/skills/gamify-progress/scripts/progress.mjs render \
  --progress subjects/<slug>/progress.json \
  --out subjects/<slug>/dashboard.html
```

## Правила

- `complete` начисляет `score × 10` XP и `+10` за 9/9.
- Файловый урок без текстовых ответов: вместо `--score` передай `--checks <checks-result.json>`. Оценка = `round(9 × вес пройденных / общий вес)`; `complete` дополнительно требует `status: "passed"` и не опускает оценку ниже 7.
- `init` отказывается перезаписывать существующий `progress.json`; `--force` — только для осознанного сброса предмета.
- `attempt` фиксирует попытку и обновляет стрик, но никогда не начисляет XP.
- Урок засчитывается один раз. Повторный `complete` для того же урока падает, если не передан `--force`.
- `--date YYYY-MM-DD` переопределяет сегодняшнюю дату для бэкфилла и тестов.
- `--sources` отмечает, что ученик сослался на RFC или документацию (выдаёт `rfc_reader`).
- Скрытые бейджи (`night_owl`, `speedrun`) есть в данных, но дашборд показывает их только после получения.

Условия бейджей — в `references/badges.md`, структура JSON — в `references/schema.md`.
