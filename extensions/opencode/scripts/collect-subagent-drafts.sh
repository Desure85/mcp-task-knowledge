#!/usr/bin/env bash
# collect-subagent-drafts.sh — собрать драфты текущей сессии + ВСЕХ её сабагентов.
#
# Проблема: сабагенты (explore/librarian/general/Sisyphus-Junior/...) пишут в свой
# draft-ses_<subagent-id>.md, а /end-session видит только драфт родительской сессии.
# Без этого скрипта драфты сабагентов теряются при консолидации.
#
# Как работает:
#   1. Берёт ID текущей сессии (аргумент $1 или переменная OPENCODE_SESSION_ID,
#      или последняя активная сессия из opencode.db с parent_id IS NULL).
#   2. Из opencode.db достаёт parent_id сессии (если сама сессия — сабагент,
#      поднимается до корня) и ВСЕ дочерние сессии (сабагенты).
#   3. Ищет draft-ses_<id>.md в <directory>/.omo/memory (directory сессии из БД)
#      и в ~/.omo/memory (глобальный). Для другого проекта — запусти с его
#      session_id: directory сам укажет нужную папку.
#   4. Печатает сводный отчёт: каждый найденный драфт + общий сводный файл
#      (опция --out <file>).
#
# Использование:
#   collect-subagent-drafts.sh [session_id] [--out <файл>] [--list]
#   OPENCODE_SESSION_ID=ses_xxx collect-subagent-drafts.sh
#
# Выход:
#   stdout — список найденных драфтов с размерами;
#   при --list — ТОЛЬКО пути найденных файлов, по одному на строку
#     (машиночитаемо; для /end-session: консолидируй и архивируй строго этот список);
#   при --out — сводный markdown со всеми драфтами (для /end-session).

set -euo pipefail

DB="${OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}"
OUT=""
LIST=""
SESSION_ID=""

# --- аргументы ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --list) LIST=1; shift ;;
    --db)  DB="$2"; shift 2 ;;
    --help|-h)
      grep '^#' "$0" | head -30 | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      if [[ -z "$SESSION_ID" ]]; then SESSION_ID="$1"; shift;
      else echo "Неизвестный аргумент: $1" >&2; exit 2; fi ;;
  esac
done

[[ -f "$DB" ]] || { echo "Ошибка: БД не найдена: $DB" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "Ошибка: sqlite3 не установлен" >&2; exit 1; }

# --- определить корневую сессию (родителя) ---
if [[ -z "$SESSION_ID" ]]; then
  SESSION_ID="${OPENCODE_SESSION_ID:-}"
fi

if [[ -z "$SESSION_ID" ]]; then
  # последняя активная (не сабагент) сессия
  SESSION_ID=$(sqlite3 "$DB" "SELECT id FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 1;" 2>/dev/null || true)
fi

[[ -z "$SESSION_ID" ]] && { echo "Ошибка: не удалось определить сессию (передайте ID аргументом)" >&2; exit 1; }

# подняться до корня, если текущая сессия — сабагент
ROOT_ID="$SESSION_ID"
for _ in 1 2 3 4 5; do
  P=$(sqlite3 "$DB" "SELECT parent_id FROM session WHERE id='$ROOT_ID';" 2>/dev/null || true)
  [[ -z "$P" || "$P" == "null" ]] && break
  ROOT_ID="$P"
done

echo "=== Драфты сессии $ROOT_ID и её сабагентов ===" >&2

# --- все id: корень + дети (сабагенты) ---
IDS=$(sqlite3 "$DB" "SELECT id FROM session WHERE id='$ROOT_ID' OR parent_id='$ROOT_ID' ORDER BY time_created;" 2>/dev/null || true)
[[ -z "$IDS" ]] && IDS="$ROOT_ID"

# --- искать драфты по directory сессии из БД (переносимо) ---
# session-draft.ts пишет проектный драфт в <directory>/.omo/memory/draft-<id>.md,
# где directory — рабочая папка сессии из opencode.db. Глобальный — в ~/.omo/memory.
# Для другого проекта просто запусти скрипт с его session_id (или из его cwd) —
# directory сессии укажет правильную папку.
FOUND=()
for id in $IDS; do
  dir=$(sqlite3 "$DB" "SELECT directory FROM session WHERE id='$id';" 2>/dev/null || true)
  for base in "$dir/.omo/memory" "$HOME/.omo/memory"; do
    f="$base/draft-$id.md"
    if [[ -f "$f" ]]; then
      FOUND+=("$f")
      break
    fi
  done
done

# --- машиночитаемый режим: только пути (для session-scoped консолидации) ---
if [[ -n "$LIST" ]]; then
  if [[ ${#FOUND[@]} -gt 0 ]]; then
    printf '%s\n' "${FOUND[@]}"
  fi
  exit 0
fi

if [[ ${#FOUND[@]} -eq 0 ]]; then
  echo "Драфты не найдены (сессий: $(echo "$IDS" | wc -l), сабагентов: $(( $(echo "$IDS" | wc -l) - 1 )))"
  exit 0
fi

# --- отчёт ---
{
  echo "# Драфты сессии $ROOT_ID + сабагентов (собрано $(date +%Y-%m-%d))"
  echo ""
  echo "Сессии: $IDS" | tr '\n' ' '
  echo ""
  echo ""
  for f in "${FOUND[@]}"; do
    echo "---"
    echo ""
    echo "## Файл: $(basename "$f")"
    echo ""
    cat "$f"
    echo ""
  done
} > "${OUT:-/dev/stdout}"

echo "Найдено драфтов: ${#FOUND[@]} (сессий всего: $(echo "$IDS" | wc -l))"
if [[ -n "$OUT" ]]; then
  echo "Сводный файл: $OUT"
fi
