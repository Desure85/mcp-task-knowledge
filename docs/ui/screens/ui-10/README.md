# UI-10 — design system: screenshots

Captured with Chrome headless (playwright-core) at 1440×900; mobile at 390×844.
All files are ≤ 150 KB.

| File | What it shows |
|------|---------------|
| `design-{indigo,petrol,copper}-{light,dark}.png` | `/design`: every primitive in one of the six palette × mode variants (6 files) |
| `tasks-{indigo-light,indigo-dark,petrol-dark}.png` | Tasks page under the new shell tokens (old page surfaces are intentionally not migrated — UI-24) |
| `overview-{indigo-light,indigo-dark,petrol-dark}.png` | Overview under the same three variants |
| `topbar-theme-mobile.png` | 390 px Topbar with the theme menu open (mode + palette, all six choices visible) |

No-flash check: with `localStorage` set to `copper`/`dark`, the first HTML response
already contains the inline theme script, and at DOMContentLoaded (before hydration)
`document.documentElement` reports `data-theme="copper" data-mode="dark"`,
`style.colorScheme="dark"`.

Hardcoded-colour backlog (input for UI-24; regex counts `bg|text|border-<palette>-NN`
plus `#hex` per page): memory 81, prompts 34, knowledge 29, analytics 27, graph 27,
system 27, projects 25, search 9.
