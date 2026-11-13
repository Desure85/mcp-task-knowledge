# Typed relations in the knowledge graph (UI-29)

Temporal facts can carry optional entity relations:

```json
{
  "statement": "API uses PostgreSQL",
  "relations": [
    { "subject": "API", "predicate": "uses", "object": "PostgreSQL" }
  ]
}
```

## API

- `memory_temporal_add` accepts `relations` (max 100).
- `memory_temporal_query` / `memory_temporal_history` return the field unchanged.
- Facts without `relations` are valid; on load the field is normalised to `[]`, so old
  `temporal-graph.json` files keep working.
- Relations are trimmed, deduplicated by `subject|predicate|object`, and validated:
  unknown predicate → error; empty subject/object → error; self-relation → error.

## Predicate dictionary

`uses`, `depends_on`, `part_of`, `related_to`, `owns`, `works_for`, `created_by`,
`replaces`, `contradicts`, `supports`, `causes`, `derived_from`.

The dictionary is a fixed allowlist in `src/memory/relations.ts`; extending it is a
code change (no free-form predicates yet).

## UI

`/graph` has a third mode, **Relations**:

- nodes are entities, edges are directed `subject → object` with the predicate as the
  edge label;
- repeated triples merge with a count (thicker line);
- predicate chips filter the graph (`All` + one chip per predicate);
- the mode is stored in `localStorage` (`graph.mode`).

Screenshots: `docs/ui/screens/ui-29/relations-1440.png`, `relations-390.png`.

## Limitations

- Relations are accepted only as explicit input; `memory_extract` does not infer them
  from free text yet.
- No `memory_temporal_update` tool: a fact's relations are fixed at add time.
- The UI mode shows only facts loaded by the page (pagination limits still apply).
- No relation-level permissions or provenance separate from the fact.
