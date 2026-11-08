---
description: Обновить требования рынка по предмету или треку
agent: study-orchestrator
---

Обнови снапшот требований рынка: $ARGUMENTS

1. Определи цель. Если `$ARGUMENTS` пуст — ищи треки в `tracks/*/market.json`; если трек один, бери его, иначе спроси.
2. Порядок поиска снапшота: сначала `tracks/<slug>/market.json`, потом `subjects/<slug>/market.json`. У секции внутри трека своего рынка нет — снапшот общий на профессию.
3. Прочитай снапшот и возьми из `request` прежние параметры: `role`, `area`, `format`, `limit`, `details`.
4. Пересобери с теми же параметрами и `--force`:

```sh
node .opencode/skills/market-research/scripts/market.mjs collect \
  --subject <tracks|subjects>/<slug> --role <role> --area <area> --format <format> \
  --limit <limit> --details <details> --force
node .opencode/skills/market-research/scripts/market.mjs render --subject <tracks|subjects>/<slug>
```

Если `market.json` нет — сначала запусти `roles`, подтверди роль у ученика и собери снапшот с нуля по skill `market-research`.

5. Покажи, что изменилось: сравни новые доли навыков со старыми и назови 3–5 самых заметных сдвигов. Не пересказывай весь отчёт.
6. Если сдвиг затрагивает программу, предложи правку: для трека — `track.md` и состав секций, для предмета — `plan.md`. Меняй только с согласия ученика.
7. Если изменился состав секций, перерегистрируй трек:

```sh
node .opencode/skills/gamify-progress/scripts/progress.mjs track init --force --track tracks/<slug> --section <slug>:<order> ...
```

Коды выхода: `2` — сеть/403/VPN, повтори позже; `3` — разметка hh изменилась, отчёт не готов, нужен ремонт парсера.
