# DX-34: шрифты web-ui через `next/font/local`

**Дата:** 2026-11-07 04:05
**Задача:** DX-34 (P-20261107-6), решение владельца 2026-11-07 «шрифты next/font/local»
**Ветка:** `fix/web-ui-local-fonts` (worktree `/home/dm/work/mcp-tk-fonts`, база `origin/master` 0bce157)

## Вопрос

Сборка `web-ui` краснеет на master из-за загрузки Google Fonts: `next/font/google` ходит на
`fonts.googleapis.com`/`fonts.gstatic.com` во время `next build`, и при недоступной сети job падает
(`Can't resolve '@vercel/turbopack-next/internal/font/google/font'` на 046efb5 и 0bce157, run
42315698925; локально воспроизводится как `Failed to fetch IBM Plex Sans/Mono from Google Fonts`).
Нужно убрать сетевую зависимость сборки, не меняя внешний вид: IBM Plex Sans (400/500/600) для
интерфейса, IBM Plex Mono (400/500) для ID, путей и времени, переменные `--font-plex-sans` и
`--font-plex-mono`.

## Решение

- Шрифты лежат файлами в `web-ui/app/fonts` и подключаются через `next/font/local` в
  `web-ui/app/layout.tsx`; `next/font/google` из web-ui убран.
- **Один woff2 на начертание, а не файл на подмножество.** Внутри каждого файла и `latin`, и
  `cyrillic`. `next/font/local` (`dist/compiled/@next/font/dist/local/loader.js`) на каждый `src`
  эмитит `@font-face` с одним и тем же сгенерированным семейством и заданным весом и **никогда** не
  эмитит `unicode-range`; два файла одного веса (latin + cyrillic) дали бы два правила с одинаковым
  семейством и диапазоном, браузер оставил бы последнее, и кириллица молча ушла бы в системный шрифт
  при зелёной сборке.
- Файлы получены из Google Fonts CSS API: запрос со старым UA (`-A 'Mozilla/4.0'`) отдаёт полный TTF
  на начертание, точные диапазоны подмножеств — тот же CSS с современным UA. Сабсет — `fontTools`
  4.61.1 (`python3 -m fontTools.subset --unicodes=... --layout-features='*' --flavor=woff2`), который
  уже есть на хосте; в `package.json` ничего не добавлено, TTF не коммитятся. Команда и литеральные
  диапазоны записаны в `web-ui/app/fonts/README.md`, лицензия — `OFL.txt` рядом (SIL OFL 1.1,
  © 2017 IBM Corp., Reserved Font Name «Plex»).
- Параметры `localFont`: те же `variable` (`--font-plex-sans`, `--font-plex-mono`) и `display: 'swap'`,
  веса 400/500/600 и 400/500; `fallback` — только имя семейства (`['IBM Plex Sans']`,
  `['IBM Plex Mono']`), чтобы итоговый стек совпал с прежним (генераторное имя + авто-фолбэк-фейс +
  `IBM Plex …` + хвост из `@theme` в `globals.css`). Параметр `subsets` у `localFont` отсутствует —
  не переносится.
- Страж против возврата: `web-ui/lib/no-remote-fonts.test.ts` — запрещает импорт `next/font/google`
  и ссылки на `fonts.googleapis.com`/`fonts.gstatic.com` в `app/**` и `components/**`, требует
  `next/font/local` в `layout.tsx` и наличия всех пяти файлов, на которые он ссылается. Сканируются
  только исходники: `app/fonts/README.md` и записи решений упоминают хосты по делу.
- Гейт в CI отдельно не добавлялся (решение владельца): остаётся только тест-страж.

## Почему

- Отвергнуто: `@fontsource/*` как npm-зависимость — запрещены новые зависимости, а сами CSS-файлы
  пакета разбиты по подмножествам, то есть упираются в ту же проблему `unicode-range`.
- Отвергнуто: два вызова `localFont` (latin и cyrillic) с общим `declarations: font-family` и разными
  `unicode-range` — переменная `--font-plex-sans` всё равно генерируется из служебного имени семейства,
  поэтому кастомное имя в `declarations` рассинхронизирует переменную и фактический `@font-face`
  (шрифт просто не применится).
- Отвергнуто: отдать файлы через `@font-face` в `globals.css` — это вывод шрифтов из `next/font` и
  расхождение с DESIGN.md; поручение требует `next/font/local`.
- Цена выбранного варианта: один файл на weight тяжелее пары подмножеств (суммарно 147 044 B на пять
  файлов против ≈172 KB у отдельных subset-файлов), но лишних начертаний и подмножеств нет; на
  браузер это влияет только объёмом загрузки (латиница и кириллица качаются вместе), не отрисовкой.

## Проверено

- Сеть заблокирована: `unshare -rn` (жёсткая изоляция) и `HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:9`
  (Next сам читает эти переменные для font-fetch; механизм подтверждён экспериментом — с ними
  google-вариант падает).
- До правки: `npm run build` и `npm run build -- --webpack` при заблокированной сети падают с
  `Failed to fetch IBM Plex Sans/Mono from Google Fonts`.
- После правки: обе команды — `EXIT=0` при заблокированной сети; `rg 'fonts\.googleapis\.com|fonts\.gstatic\.com'`
  по `.next` → 0 вхождений.
- Внешний вид: Playwright, dev-режим `/design`, шесть вариантов темы. Ширина контрольных строк
  (латиница, кириллица, смешанная) на 13 px/400: **Δ = 0.0000 px** в каждом варианте против
  google-варианта. Кириллица рендерится файлом Plex: `document.fonts.check` → true, отличие ширины
  кириллической строки от Arial — 2.891 px и до, и после; в `document.fonts` пять Plex-фейсов
  (`sans` 400/500/600, `mono` 400/500).
- Страж: `npx vitest run lib/no-remote-fonts.test.ts` — 4/4 green; revert-check (вернуть google-импорт
  в `layout.tsx`) — 2/4 red, откат — снова 4/4 green.
- `npm run backlog:check` — 405 total, 281 done, 7 wip, 94 pending; `npm run design:doc` — без диффа
  по сгенерированным блокам.

## Откат

`git revert` коммита с `layout.tsx`, `app/fonts/*` и стражем возвращает `next/font/google`; сборка
снова начнёт ходить в сеть. Файлы шрифтов, README и OFL удаляются вместе с каталогом `app/fonts`.
Запись DX-34 в `BACKLOG.md` вернуть в `pending`, счётчики — обратно (done −1, pending +1).
