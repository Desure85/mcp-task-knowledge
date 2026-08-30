# P2P Sync Setup (OC-006)

> Синхронизация данных mcp-task-knowledge между Windows ↔ Linux через git.

## Вариант 1: Git Sync (рекомендуется)

### Настройка

1. **Создать отдельный git-репозиторий для данных:**

```bash
cd ~/mcpTrackerData
git init
echo ".embeddings/" > .gitignore
echo ".behavioral/" >> .gitignore
echo "*.tmp" >> .gitignore
git add -A
git commit -m "init: mcp-task-knowledge data"
git remote add origin <your-private-repo>
git push -u origin main
```

2. **На Linux (основная машина):**

```bash
# Cron: sync каждые 30 минут
*/30 * * * * cd ~/mcpTrackerData && git add -A && git commit -m "auto-sync $(date)" && git push
```

3. **На Windows:**

```powershell
# Task Scheduler: pull каждые 30 минут
schtasks /create /tn "McpSync" /tr "cd %USERPROFILE%\mcpTrackerData && git pull" /sc minute /mo 30
```

4. **После pull — reindex:**

```bash
# MCP-сервер автоматически переиндексирует при следующем запросе
# Для принудительной переиндексации:
node scripts/prompts.mjs index
```

### Разрешение конфликтов

При конфликте (одновременные изменения на двух машинах):

```bash
git pull --rebase
# Если конфликт — взять локальную версию данных:
git checkout --ours .
git add -A
git rebase --continue
```

## Вариант 2: Syncthing (для больших объёмов)

```bash
# Установка на обе машины
sudo apt install syncthing  # Linux
winget install Syncthing.Syncthing  # Windows

# Настройка:
# 1. Запустить syncthing на обеих машинах
# 2. Добавить устройства (Exchange Device IDs)
# 3. Share folder: ~/mcpTrackerData
# 4. Включить "Send Only" на основной машине, "Receive Only" на вторичной
```

## Вариант 3: LAN Relay (BM-012, уже реализовано)

Если обе машины в одной LAN:

```bash
# Основная машина:
RELAY_ENABLED=1 RELAY_SHARED_KEY=mysecret node dist/index.js

# Вторичная:
RELAY_ENABLED=1 RELAY_SHARED_KEY=mysecret node dist/index.js
# Пиры обнаруживаются через UDP multicast автоматически
```

## Рекомендация

**Git sync** — самый надёжный для текстовых данных (tasks/knowledge).
**Syncthing** — для больших бинарных кэшей (embeddings).
**LAN Relay** — для real-time sharing правил между разработчиками.
