# Self-hosted IBM Plex (DX-34)

The web UI must build without network access. `next/font/google` downloaded the
faces from `fonts.googleapis.com` / `fonts.gstatic.com` during `next build`, so a
blocked egress made the whole `web-ui` CI job fail with
`Can't resolve '@vercel/turbopack-next/internal/font/google/font'`.
The faces below are committed as files and loaded through `next/font/local`
(`app/layout.tsx`).

## Files

| File | Family | Weight | Size |
|------|--------|--------|------|
| `IBMPlexSans-Regular.woff2` | IBM Plex Sans | 400 | 35 168 B |
| `IBMPlexSans-Medium.woff2` | IBM Plex Sans | 500 | 37 524 B |
| `IBMPlexSans-SemiBold.woff2` | IBM Plex Sans | 600 | 37 552 B |
| `IBMPlexMono-Regular.woff2` | IBM Plex Mono | 400 | 18 216 B |
| `IBMPlexMono-Medium.woff2` | IBM Plex Mono | 500 | 18 584 B |

Total 147 044 B (143.6 KiB).

Each file contains **both** the `latin` and the `cyrillic` subset: one file per
weight, not one file per subset. `next/font/local` emits one `@font-face` per
`src` entry with the same generated family and the given weight and never emits
`unicode-range`; two files of the same weight (latin and cyrillic) would both
claim the whole range, the browser would keep only the last one and Cyrillic
would silently fall back to a system face while the build stays green.

## Source

Faces were taken from the Google Fonts CSS API on 2026-11-07. Requesting the CSS
with a legacy user agent (`-A 'Mozilla/4.0'`) returns a **full TTF** (not a
subset) per weight; the `v23`/`v20` URLs below are the ones served that day:

```
IBM+Plex+Sans 400  https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD6llzAA.ttf
IBM+Plex+Sans 500  https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD2FlzAA.ttf
IBM+Plex+Sans 600  https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSDNF5zAA.ttf
IBM+Plex+Mono 400  https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n5ig.ttf
IBM+Plex+Mono 500  https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJ8lc.ttf
```

The unicode ranges are the ones Google itself serves for these two subsets
(same CSS API with a modern user agent). Both `latin` and `cyrillic` are merged
into one range list, which is what a single file per weight needs:

```
latin     U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
          U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122,
          U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD
cyrillic  U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116
```

## Reproducing (host tool, not a dependency)

The subsetting was done once with fontTools 4.61.1 and brotli 1.2.0 already
present on the machine. Nothing is added to `package.json`; the TTFs are not
committed.

```bash
UNI='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0301,U+0304,U+0308,U+0329,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2000-206F,U+20AC,U+2116,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'

python3 -m fontTools.subset IBMPlexSans-400.ttf \
  --unicodes="$UNI" --layout-features='*' --flavor=woff2 \
  --output-file=IBMPlexSans-Regular.woff2
```

The same command was used for the other four weights (`IBMPlexSans-500.ttf`,
`IBMPlexSans-600.ttf`, `IBMPlexMono-400.ttf`, `IBMPlexMono-500.ttf`).
`--layout-features='*'` keeps kerning and ligatures, so the advance widths stay
identical to the upstream faces.

## License

`OFL.txt` next to the files is the original SIL Open Font License 1.1 shipped
with IBM Plex (the same text for Sans and Mono). Copyright © 2017 IBM Corp.,
Reserved Font Name "Plex".
