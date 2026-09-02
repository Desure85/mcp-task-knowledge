# Skills, Rules & Workflows

## Skills System

Reusable "skills" for AI agents — analogous to Claude Code SKILL.md, Cursor .cursorrules, Cline .clinerules.

### Format

Markdown + YAML frontmatter, supports `$ARGUMENTS`, `${VARS}`:

```markdown
---
name: code-review
description: Perform automated code review
triggers:
  - "review my changes"
  - "check the diff"
allowed-tools:
  - read
  - grep
  - bash
---

# Code Review Skill

1. Read the diff
2. Check for security issues
3. Check for performance
4. Report findings
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `skills_create` | Create a skill |
| `skills_list` | List skills |
| `skills_get` | Get skill by ID |
| `skills_invoke` | Invoke a skill with arguments |
| `skills_search` | Search skills by tag/name |
| `skills_delete` | Delete a skill |

### Skill Converters

Convert between formats:
- `.cursorrules` → our format
- `SKILL.md` → our format
- `.clinerules` → our format
- Our format → Claude Code plugin

### Skill Templates

Pre-built skills included:
- code-review, deploy, test-gen, refactor, debug, architecture-review

### Permissions

- `allowed-tools`: restrict which MCP tools a skill can use
- `disable-model-invocation`: prevent automatic triggering
- Scope: project, user, global

## Rules Engine

Guardrails and rules for AI agents — analogous to .cursorrules, CLAUDE.md, policy-as-code.

### Hierarchy

Global → Project → User (inheritance + override at each level)

### MCP Tools

| Tool | Description |
|------|-------------|
| `rules_create` | Create a rule |
| `rules_list` | List rules |
| `rules_evaluate` | Evaluate input against rules |
| `rules_enforce` | Enforce rules on tool call (pre/post hooks) |

### Rule Packs

Pre-built rule packs:
- security-rules, ts-strict, react-conventions, python-style, team-standards

### Import

Import from `.cursorrules`, `CLAUDE.md`, `.clinerules`, `.windsurfrules`.

## Workflows

Sequences of AI actions — analogous to Windsurf Flows, Cursor rules chaining.

### MCP Tools

| Tool | Description |
|------|-------------|
| `workflow_create` | Create a workflow DAG |
| `workflow_execute` | Execute a workflow |
| `workflow_list` | List workflows |
| `workflow_get` | Get workflow by ID |

### Features

- DAG builder (nodes = tools/skills/rules, edges = dependencies)
- Executor: sequential, parallel, conditional branching, error recovery
- Templates: code-review-pipeline, feature-dev-flow, bug-triage, release-checklist
- Human-in-the-loop: approve/reject/modify at checkpoints
- State persistence: checkpoint + resume after crashes
- Subflows: nested workflows, composability
