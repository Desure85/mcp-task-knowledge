# ADR-2026-11-12: модель задачи — исполнитель, срок, поля проекта, комментарии, связи

- **Статус:** accepted (TK-01, design gate)
- **Контекст:** MU-02 (version/CAS) и T-01/T-02 (пользователи, ACL) закрыты; текущая схема задачи
  фиксирована: `status/priority/tags/type/dependsOn/parentId/links`.
- **Решение владельца:** свой трекер; YouTrack — референс функций и языка запросов, не основа.

## 1. Проблема

Для TK-02..TK-05 и T-06 нужны: исполнитель, срок, настраиваемые поля проекта, комментарии/упоминания,
типизированные связи. Нельзя ломать wire-формат и существующие `dependsOn`/`parentId`.

## 2. Решение: аддитивная схема задач

### 2.1 Поля задачи (wire добавляет только опциональные ключи)

```ts
interface Task {
  // ...существующие поля без изменений
  assignee?: string;            // user id из T-01; отсутствие = не назначено
  dueDate?: string;             // ISO date (YYYY-MM-DD), не timestamp
  fields?: Record<string, string | number | boolean | string[] | null>; // custom fields by field id
  relations?: TaskRelation[];   // дополнительные типы связей
}

type TaskRelationType = 'relates' | 'duplicates' | 'blocks' | 'dependedBy';
interface TaskRelation { type: TaskRelationType; targetId: string; }
```

- `dependsOn` остаётся каноническим для `depends`; `parentId` — для `subtask`. `relations` — только
  дополнительные типы, не дублирует их.
- Все поля опциональны; старые задачи читаются без миграции (lazy defaults).
- `assignee` валидируется как существующий user id, если user-store доступен; иначе — строка (совместимость
  с file-профилем без auth.db).
- `dueDate` — календарная дата, без времени и TZ; сравнение лексикографическое.

### 2.2 Настраиваемые поля проекта

`ProjectMetadata.fields: FieldDef[]`:

```ts
interface FieldDef {
  id: string;                    // ^[a-z][a-z0-9_-]{0,31}$
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'user';
  options?: string[];            // только enum
  required?: boolean;            // default false
  defaultValue?: string | number | boolean;
}
```

- Максимум 50 полей на проект; enum ≤100 опций; label ≤120 символов.
- Валидация: zod-схема проекта строится динамически; неизвестный `fields` ключ — `FIELD_UNKNOWN`
  (не молчаливое игнорирование); неверный тип — `FIELD_INVALID`; отсутствие required при create —
  `FIELD_REQUIRED`.
- Удаление поля: `project_fields_set` без поля помечает его `archived:true`; значения остаются в задачах
  (чтение игнорирует), физического удаления нет.
- Wire-представление значений — плоский `fields`, имена = `FieldDef.id`; без вложенных объектов.
- Индекс: `task_fields(task_id, field_id, value_text, value_num)` (опционально, SC-02f/TK-02).

### 2.3 Комментарии и упоминания

- Отдельный append-only журнал: `DATA_DIR/comments/<project>/<taskId>.jsonl`.
- `Comment { id, taskId, authorId, body, mentions: string[], createdAt }`; `mentions` вычисляются из
  `@user` при записи, не хранятся в тексте отдельно.
- MCP: `tasks_comments_list`, `tasks_comment_add`; wire — массив комментариев только по явному запросу.
- Упоминания не создают уведомлений в MVP; T-04 webhook может эмитить `task.commented`.
- Удаление комментария — soft: `deletedAt`, тело остаётся для аудита.

### 2.4 Связи

- `depends` = `dependsOn` (DAG, защита от циклов уже есть).
- `subtask` = `parentId` (глубина ≤10).
- `relates`, `duplicates`, `blocks`/`dependedBy` — `relations`, симметричные типы нормализуются на чтении.
- Валидация: target существует в том же проекте; self-link запрещён; `duplicates` не участвует в DAG.

## 3. Миграция и `.schema-version`

- `CURRENT_SCHEMA = 1` → `2`.
- Миграция 1→2 — **no-op для файлов**: поля опциональны, старые задачи валидны.
- При старте: если `.schema-version` < 2, проставить 2 после проверки чтения одной задачи и одного проекта;
  ошибка чтения → не поднимать версию, WARN, работать в режиме schema 1.
- Metadata index: schema bump отдельно; новые колонки/таблицы добавляются вперёд-совместимо; при
  несовпадении версии индекса — rebuild, а не падение.
- Откат: вернуть `CURRENT_SCHEMA=1`; задачи с новыми полями читаются старым кодом (лишние JSON-ключи
  игнорируются), новые MCP-инструменты исчезают. Данные не удаляются.

## 4. Wire-совместимость

- Ни одно существующее поле не меняет тип/семантику; новые — опциональны.
- `tasks_get`/`tasks_list` возвращают новые поля только если они есть; `compact`/`fields` работают как раньше.
- Ошибки новых валидаций — аддитивные коды: `FIELD_UNKNOWN`, `FIELD_INVALID`, `FIELD_REQUIRED`,
  `RELATION_INVALID`, `COMMENT_NOT_FOUND`.

## 5. Влияние на пункты

- **TK-02** (язык запросов) строится по `fields`/`assignee`/`dueDate`; синтаксис `assignee: me`, `due: <date>`,
  `#tag`, `project:`.
- **TK-03/TK-04** используют поля/сроки для дорожек, спринтов и виджетов.
- **T-06** использует `relations` для обратных ссылок задача↔документ (документная сторона — отдельно).
- **T-04** может эмитить `task.assigned`, `task.commented`.

## 6. Открытые вопросы (не блокируют TK-01)

- Уведомления по mentions — только webhook в MVP.
- Права на комментарии: автор или admin; ACL проекта — на чтение.
- Часовой пояс для dueDate не хранится; UI показывает дату как есть.

## 7. Последствия

- Схема остаётся файловой и читаемой без миграции.
- Появляется динамическая zod-валидация на проект — цена на каждый create/update.
- Комментарии вынесены из task JSON, чтобы не раздувать горячий файл и сохранить append-only аудит.
