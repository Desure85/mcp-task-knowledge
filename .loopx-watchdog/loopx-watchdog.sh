#!/usr/bin/env bash
# LoopX watchdog — шлёт tick-сообщения в ТЕКУЩУЮ OpenCode-сессию через tmux send-keys.
# Attach-модель: пишет user-сообщение в существующую сессию, не спавнит новый процесс.
#
# На каждом tick:
#   1. Сканирует BACKLOG.md → добавляет pending задачи, которых нет в LoopX todos
#   2. Спрашивает loopx quota should-run → если true, пинает агента через tmux
#
# Usage:
#   ./loopx-watchdog.sh start [tmux_session]   — старт цикла
#   ./loopx-watchdog.sh stop                   — остановить
#   ./loopx-watchdog.sh status                 — статус + хвост лога
#   ./loopx-watchdog.sh once                   — один tick (sync+check, без посыла)
#   ./loopx-watchdog.sh send "msg"             — послать произвольное сообщение
#   ./loopx-watchdog.sh sync                   — только sync BACKLOG → LoopX
#
# Env:
#   LOOPX_TICK=300             интервал между тиками (сек, default 300)
#   LOOPX_TMUX=mcp-goal        tmux session куда слать
#   LOOPX_AGENT=nightly-worker-01

set -u
cd "$(dirname "$0")/.." || exit 1

GOAL_ID="mcp-task-knowledge-goal"
AGENT_ID="${LOOPX_AGENT:-nightly-worker-01}"
TMUX_SESSION="${LOOPX_TMUX:-mcp-goal}"
PIDFILE=".loopx-watchdog/watchdog.pid"
LOG=".loopx-watchdog/watchdog.log"
LOCKFILE=".loopx-watchdog/watchdog.lock"
TICK_INTERVAL="${LOOPX_TICK:-300}"
MAX_CONSEC_FAILS=5

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*" >>"$LOG"; }

is_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

# ─── Sync BACKLOG → LoopX todos ──────────────────────────────────
# Парсит BACKLOG.md, находит строки `| ID | title | prio | pending |`,
# добавляет в LoopX те которых там ещё нет.
sync_backlog() {
  python3 << 'PYEOF'
import re, subprocess, sys

try:
    with open('BACKLOG.md') as f:
        lines = f.readlines()
except FileNotFoundError:
    sys.exit(0)

tasks = []
for line in lines:
    m = re.match(r'^\|\s*([A-Z]+-\d+)\s*\|\s*([^|]+?)\s*\|\s*(low|medium|high)\s*\|\s*pending\s*\|', line)
    if m:
        tid, title, prio = m.groups()
        tasks.append((tid.strip(), title.strip()[:100], prio))

if not tasks:
    sys.exit(0)

result = subprocess.run(
    ['loopx', 'todo', 'list', '--goal-id', 'mcp-task-knowledge-goal', '--project', '.'],
    capture_output=True, text=True)
existing_ids = set(re.findall(r'\b([A-Z]+-\d+)\b', result.stdout))

prio_map = {'high': 'P0', 'medium': 'P1', 'low': 'P2'}
added = []
for tid, title, prio in tasks:
    if tid in existing_ids:
        continue
    p = prio_map.get(prio, 'P2')
    text = f"[{p}] {tid}: {title}"
    cmd = ['loopx', 'todo', 'add', '--goal-id', 'mcp-task-knowledge-goal', '--project', '.',
           '--role', 'agent', '--claimed-by', 'nightly-worker-01',
           '--task-class', 'advancement_task', '--action-kind', 'implementation',
           '--text', text]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if 'added: `True`' in r.stdout or '"added": true' in r.stdout:
        added.append(tid)

if added:
    print(f"BACKLOG_SYNC added={len(added)} ids={','.join(added[:20])}", flush=True)
PYEOF
}

tick() {
  local turn
  turn=$(date -u +%Y%m%dT%H%M%SZ)
  loopx --format json \
    --registry "$HOME/.codex/loopx/registry.global.json" \
    quota should-run \
    --goal-id "$GOAL_ID" \
    --agent-id "$AGENT_ID" \
    --runtime-profile generic_cli \
    --turn-instance-id "$turn" 2>&1
}

send_message() {
  local text="$1"
  tmux send-keys -t "$TMUX_SESSION" "$text" Enter 2>&1
}

main_loop() {
  log "watchdog start pid=$$ tick=${TICK_INTERVAL}s tmux=$TMUX_SESSION"
  local fails=0
  local last_action=""
  while true; do
    if sync_out=$(sync_backlog 2>&1); then
      [ -n "$sync_out" ] && log "sync: $sync_out"
    else
      log "sync FAIL: $(echo "$sync_out" | head -3)"
    fi

    if ! out=$(tick); then
      fails=$((fails+1))
      log "tick FAIL ($fails): $(echo "$out" | head -3)"
      [ "$fails" -ge "$MAX_CONSEC_FAILS" ] && { log "too many fails, exit"; exit 2; }
      sleep "$TICK_INTERVAL"; continue
    fi
    fails=0
    should_run=$(echo "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("should_run"))' 2>/dev/null || echo "?")
    action=$(echo "$out" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("protocol_action_packet",{}).get("summary",""))' 2>/dev/null)
    log "tick should_run=$should_run action=$action"
    if [ "$should_run" = "True" ] && [ "$action" != "$last_action" ]; then
      local msg="[LoopX tick] $action. Выполни bounded slice → writeback (refresh-state + spend-slot). В процессе: находки в draft + пополняй BACKLOG новыми задачами."
      if send_message "$msg" >/dev/null 2>&1; then
        log "sent tick to tmux:$TMUX_SESSION (new action)"
        last_action="$action"
      else
        log "send FAIL — tmux session $TMUX_SESSION недоступна"
      fi
    elif [ "$should_run" = "True" ]; then
      log "skip — same action still in progress"
    fi
    sleep "$TICK_INTERVAL"
  done
}

case "${1:-status}" in
  start)
    if is_running; then echo "already running pid=$(cat "$PIDFILE")"; exit 0; fi
    [ -n "${2:-}" ] && TMUX_SESSION="$2"
    rm -f "$LOCKFILE"
    nohup env LOOPX_TMUX="$TMUX_SESSION" "$0" __run >>"$LOG" 2>&1 &
    echo $! >"$PIDFILE"
    echo "started pid=$(cat "$PIDFILE") tmux=$TMUX_SESSION tick=${TICK_INTERVAL}s"
    ;;
  __run)
    exec 200>"$LOCKFILE"
    flock -n 200 || { log "another instance holds lock"; exit 1; }
    main_loop
    ;;
  stop)
    if is_running; then kill "$(cat "$PIDFILE")"; rm -f "$PIDFILE"; echo "stopped"; else echo "not running"; fi
    ;;
  once)
    sync_backlog
    tick | python3 -m json.tool | head -40
    ;;
  sync)
    sync_backlog
    ;;
  send)
    shift
    send_message "$*"
    ;;
  status)
    if is_running; then echo "running pid=$(cat "$PIDFILE")"; else echo "not running"; fi
    tail -15 "$LOG" 2>/dev/null
    ;;
  *) echo "usage: $0 [start [tmux]|stop|status|once|send \"msg\"|sync]" >&2; exit 64 ;;
esac
