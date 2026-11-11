# SC-05 — graph LOD benchmark

Synthetic entity graph rendered through `generateGraphHTML` (`src/memory/graph-viz.ts`) in
headless Chromium. The benchmark is not part of `npm test` or CI; run it before changing graph
rendering.

## Command

```bash
node scripts/bench/graph-bench.mjs --sizes 200,1000,5000 --shots 200,1000 \
  --playwright <path-to-playwright-core> \
  --chrome <path-to-chrome> \
  --out-dir docs/benchmarks/graph-sc05
```

Windows run (2026-11-11) used `web-ui/node_modules/playwright-core` and Playwright's
`chromium-1193/chrome-win/chrome.exe`, 1400×900, headless.

## Results after LOD (SC-05)

| Nodes | Edges | Settle | SVG elements | Long tasks | Longest task | Timed out |
|------:|------:|-------:|-------------:|-----------:|-------------:|:---------:|
| 200   | 293   | 1.81 s | 503          | **94 ms**  | 94 ms        | no |
| 1000  | 1478  | 1.84 s | 683          | **139 ms** | 139 ms       | no |
| 5000  | 7379  | 1.92 s | 726          | **207 ms** | 207 ms       | no |

Before SC-05 the backlog recorded 1000 nodes ≈2.3 s / ~2 s of Long Tasks and 5000 ≈13.7 s /
16.3 s. The exact pre-change run is in `BACKLOG.md`, not reproduced here.

Threshold (DoD): 5000 nodes → `longTaskTotalMs < 2000` and `timedOut === false`. Result:
**207 ms, false**.

## What changed

- Initial view is capped at 300 nodes (top-degree first), so force/render work is bounded;
  stats says `Showing N of M nodes`.
- Graphs with more than 30 nodes use a deterministic four-ring layout and render once instead
  of running 160 animation frames; small graphs keep the force simulation.
- Labels only for the 18 highest-degree nodes (plus clusters/focus), with a simple collision
  pass.
- `Cluster: type` / `Cluster: tag`: aggregate members into one node; clicking a cluster expands
  it. `Neighborhood: 1/2`: click a node to restrict the view to its BFS neighborhood.
- Edges are thinner/fainter in dense views.

## Screenshots

- `graph-200.png` — 200 nodes, no clusters.
- `graph-1000.png` — 1000 input nodes, capped view.

## Limitations

- Synthetic ring/star graph, not a real temporal memory; branch/degree distribution differs.
- Headless Chromium on one Windows machine; numbers are not a CI gate.
- The cap is by node count, not by edge count: a dense 300-node graph can still be heavier.
- Labels are approximate (character-count width), not measured glyphs.
- `Cluster: tag` groups by the **first** tag only; multi-tag nodes appear in one cluster.
