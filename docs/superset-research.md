# Исследование Superset (AI Code Editor): идеи для CSM Dashboard

> Дата: 2026-04-10
> Источник: https://github.com/superset-sh/superset (shallow clone, анализ архитектуры)
> Примечание: Это **не Apache Superset** (BI-платформа), а **"Superset — The Code Editor for AI Agents"** — Electron/Next.js приложение для оркестрации AI-кодинг агентов. По сути, прямой конкурент CSM в более зрелой реализации.

---

## 1. Обзор архитектуры Superset

### Общая структура
**Монорепозиторий** на Bun workspaces + Turborepo:
```
superset/
├── apps/
│   ├── web/        # Next.js 16 — веб-интерфейс
│   ├── desktop/    # Electron 40 — десктопное приложение
│   ├── admin/      # Next.js — админ-панель
│   ├── api/        # Next.js API-сервер
│   ├── mobile/     # Мобильное приложение
│   └── electric-proxy/  # Cloudflare Worker — прокси для Electric SQL
├── packages/
│   ├── ui/         # Shared UI-библиотека (Radix UI)
│   ├── panes/      # Система панелей/вкладок (workspace layout)
│   ├── trpc/       # tRPC роутеры (типобезопасный API)
│   ├── db/         # Drizzle ORM + PostgreSQL (Neon)
│   ├── auth/       # Better Auth (OAuth, JWT, API keys)
│   └── shared/     # Общие утилиты и константы
```

### Backend
- **Next.js 16** (App Router) — API-сервер
- **tRPC 11.7** — типобезопасный RPC вместо REST
- **Drizzle ORM** + **PostgreSQL (Neon serverless)** — база данных
- **Upstash Redis** — кэширование и rate limiting
- **Upstash QStash** — очередь задач (async jobs)
- **Electric SQL** — real-time синхронизация данных
- **Better Auth** — аутентификация (OAuth, JWT, API keys, sessions)
- **Stripe** — биллинг

### Frontend
- **React 19** + **TypeScript**
- **Zustand 5** — state management (легковесная альтернатива Redux)
- **TanStack React Query 5** — async data fetching
- **Radix UI** — headless UI-компоненты (50+ примитивов)
- **Tailwind CSS 4** + **CVA** — стилизация
- **Recharts** — графики и визуализация
- **@dnd-kit + react-dnd** — drag-and-drop
- **react-resizable-panels** — resizable панели
- **TipTap** — rich text editor
- **xterm** — встроенный терминал

### Real-time архитектура
- **Electric SQL** — real-time sync через shape protocol
- **TanStack React DB** с `useLiveQuery()` — реактивные запросы
- **SSE (Server-Sent Events)** — стриминг чатов (`/api/chat/[sessionId]/stream`)
- **tRPC WebSocket** — WS-канал для workspace
- Нет классического polling — данные обновляются реактивно через Electric

---

## 2. UI/UX идеи для CSM-дашборда

### 2.1 Система панелей (Panes) — ключевая находка
Superset использует рекурсивную древовидную систему layout:
```typescript
type LayoutNode =
  | { type: "pane"; paneId: string }
  | { type: "split"; direction: "horizontal" | "vertical";
      first: LayoutNode; second: LayoutNode; splitPercentage?: number }
```
- Панели можно **сплитить** горизонтально и вертикально (как в VS Code)
- **Drop zones** при перетаскивании показывают куда упадёт панель (top/right/bottom/left)
- **react-resizable-panels** для drag-to-resize границ
- Состояние layout хранится в Zustand store

**Идея для CSM**: Текущий 4-колоночный layout (Projects | Wishes | Tasks | Terminal) жёстко зафиксирован. Можно реализовать resizable панели — пользователь сможет сужать/расширять колонки, скрывать ненужные. Начать с `react-resizable-panels` (минимальные изменения).

### 2.2 Tabs + Workspaces
- Каждый workspace имеет **tabs** (вкладки)
- Каждый tab содержит свой **layout** (дерево panes)
- Drag-and-drop для переупорядочивания вкладок
- Tab bar с кнопками управления

**Идея для CSM**: Tabs для переключения между проектами или контекстами (вместо выбора проекта в sidebar). Каждый tab — свой набор видимых сессий/задач.

### 2.3 Zustand вместо глобального состояния
Superset использует множество мелких Zustand stores:
- `workspace-sidebar-state.ts` — состояние сайдбара
- `tasks-filter-state.ts` — фильтры задач
- `editor-state/` — состояние редактора
- `tabs/` — состояние вкладок

**Идея для CSM**: Текущий CSM хранит состояние в замыканиях и DOM. Zustand (или аналогичный паттерн с простыми store-модулями) упорядочит управление состоянием без перехода на React.

### 2.4 Контекстные меню
CSM уже имеет правый клик на проекте. Superset расширяет это:
- Контекстные действия зависят от типа элемента
- Nested menus для группировки действий
- Keyboard shortcuts для частых операций

### 2.5 Electric SQL для real-time
Вместо polling или даже WebSocket, Superset использует **Electric SQL** — real-time sync layer поверх PostgreSQL:
- Клиент подписывается на "shapes" (подмножества данных)
- Изменения в БД автоматически пушатся всем подписчикам
- `useLiveQuery()` — React hook для реактивных запросов

**Идея для CSM**: CSM уже использует WebSocket. Можно улучшить, сделав подписки более гранулярными — не "все обновления", а подписка на конкретный проект/сессию.

---

## 3. Система дашбордов и виджетов

### 3.1 Модель данных (из Drizzle schema)
```
Organizations → Members, Projects, Tasks, Workspaces
Tasks { id, slug, title, description, statusId, priority, assigneeId, 
        estimate, dueDate, labels, branch, prUrl }
TaskStatuses { id, name, color, type, position, progressPercent }
ChatSessions { id, organizationId, title, v2WorkspaceId }
V2Workspaces → V2Projects → V2Hosts → V2Clients
```

**Сравнение с CSM**:
| Superset | CSM |
|----------|-----|
| Organizations | Отсутствует (single-user) |
| Tasks с statusId + priority | Tasks с inline status |
| TaskStatuses (настраиваемые) | Фиксированные статусы |
| ChatSessions | Tmux sessions |
| Workspaces | Projects |

### 3.2 Task Management
- Задачи с slug, приоритетом, дедлайном, метками
- **Настраиваемые статусы** с цветом и progress %
- Привязка к branch и PR URL
- Назначение на участника (assignee)
- Фильтры: `tab: "all" | "active" | "backlog"`, assignee, search
- View modes: **table** и **board** (Kanban)

**Идея для CSM**: Добавить Kanban-доску как альтернативный вид задач (в дополнение к текущему списку). Колонки = статусы pipeline. Перетаскивание карточки между колонками меняет статус.

### 3.3 Интеграции
Superset имеет глубокие интеграции с:
- **GitHub** — синхронизация репозиториев, PR, installations
- **Linear** — двусторонняя синхронизация задач
- **Slack** — уведомления, упоминания
- **Stripe** — биллинг

**Идея для CSM**: GitHub интеграция для автоматической привязки PR к задачам (CSM уже создаёт worktrees и branches, но нет связки с PR).

### 3.4 UI-компоненты (Radix + Tailwind)
Библиотека `@superset/ui` содержит:
- accordion, alert-dialog, badge, button, calendar, card, carousel
- **chart** (обёртка над Recharts), checkbox, command palette
- context-menu, dialog, drawer, dropdown-menu, form, input
- **resizable** panels, slider, tabs, tooltip

**Ключевое**: каждый UI-компонент — тонкая обёртка над Radix primitive с Tailwind стилями. Минимум кода, максимум функциональности.

---

## 4. Визуализация данных

### 4.1 Recharts как библиотека визуализации
Superset использует **Recharts** — composable React charting:
- Line, Area, Bar, Pie, Radar, Composed charts
- ResponsiveContainer для автоматического sizing
- Обёрнуто в `ChartContainer` с:
  - Конфигурация через props (не код)
  - Dynamic CSS variable injection для темизации
  - `ChartTooltip` + `ChartLegend` как composable компоненты

**Для CSM**: Recharts — отличный выбор для vanilla JS проекта (можно использовать без React через CDN). Альтернатива: Chart.js или lightweight uPlot.

### 4.2 Применимые типы визуализаций

**Для мониторинга сессий:**
- **Sparklines** (мини-графики) в карточках проектов — тренд активности за 24ч
- **Progress bars** (сегментированные) — CSM уже использует, Superset подтверждает правильность подхода
- **Status dots** с анимацией — CSM уже имеет, но можно добавить пульсацию для active

**Для аналитики задач:**
- **Bar chart** — задачи по статусам (stacked bar: completed/running/pending)
- **Area chart** — тренд выполнения задач за неделю/месяц
- **Pie/Donut** — распределение задач по проектам

**Для operations:**
- **Timeline** — хронология событий сессии (создание → задачи → завершение)
- **Heatmap** — активность по часам/дням (когда работает большинство сессий)

### 4.3 Mesh Gradient фоны
Superset включает `mesh-gradient.tsx` — красивые градиентные фоны для карточек/заголовков. Мелочь, но добавляет visual polish.

---

## 5. API и архитектурные паттерны

### 5.1 tRPC вместо REST
```typescript
// Определение процедуры (сервер)
task: router({
  list: protectedProcedure
    .input(z.object({ tab: z.enum(["all", "active", "backlog"]) }))
    .query(async ({ ctx, input }) => {
      return db.select().from(tasks).where(...)
    }),
  create: protectedProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }) => { ... }),
})

// Вызов (клиент) — полная типобезопасность
const tasks = trpc.task.list.useQuery({ tab: "active" })
```

**Для CSM**: tRPC требует TypeScript на обоих концах. Но паттерн валидации input через Zod можно перенять — валидировать входные данные API endpoints через JSON Schema или Joi.

### 5.2 Процедуры с авторизацией
```
publicProcedure     — без авторизации
protectedProcedure  — требует сессию
jwtProcedure        — Bearer token
adminProcedure      — email в домене компании
```

**Для CSM**: Пока CSM single-user, но при добавлении multi-user будет нужна аналогичная система middleware для API.

### 5.3 Background Jobs (QStash)
- Jobs как HTTP endpoints: `/api/integrations/{service}/jobs/{jobName}`
- POST с подписанным payload
- Verification подписи при получении
- Использование: GitHub sync, Linear sync, Slack events, Stripe webhooks

**Для CSM**: Паттерн "job как HTTP endpoint" интересен для будущих интеграций. Сейчас CSM выполняет всё синхронно в server.js.

### 5.4 Electric SQL — real-time без polling
```typescript
// Клиент подписывается на "shape" (фильтрованное подмножество таблицы)
const shape = new ShapeStream({
  url: `${ELECTRIC_URL}/v1/shape`,
  params: { table: 'tasks', where: `organization_id = '${orgId}'` }
})

// React hook — автоматически обновляется при изменениях в БД
const tasks = useLiveQuery(db.collection('tasks').where({ status: 'active' }))
```

**Для CSM**: CSM уже использует WebSocket, что покрывает 90% потребностей. Electric SQL — overkill для file-based storage. Но идея гранулярных подписок (подписка на конкретную сессию, а не на все события) стоит реализовать в текущем WS.

### 5.5 Multi-tenancy паттерны
- Organizations → Members с ролями
- Automatic domain-based enrollment
- API key authentication для внешних интеграций
- Guest tokens для embedded views

**Для CSM**: Пока не нужно, но архитектурно полезно знать при возможном расширении.

---

## 6. Терминальная подсистема

### 6.1 Архитектура: xterm.js + node-pty (без tmux)

Superset **не использует tmux**. Вместо этого — полностью встроенный терминал:

```
User Input → xterm.js (React-компонент в pane)
           ↓
      WebSocket Transport (reconnect, exponential backoff)
           ↓
  Terminal Host Daemon (отдельный процесс, Unix socket)
           ↓
      node-pty v1.1.0 (PTY сессия)
           ↓
   Shell Process (bash/zsh, xterm-256color)
           ↓ (output)
  DataBatcher (16ms flush / 200KB auto-flush, UTF-8 aware)
           ↓
      IPC → WebSocket → xterm.js → WebGL/DOM рендеринг
```

### 6.2 xterm.js и аддоны

**Версия**: `@xterm/xterm@6.1.0-beta.195` (bleeding edge)

**Аддоны**:
- `addon-webgl` — GPU-ускоренный рендеринг (с fallback на DOM при ошибке)
- `addon-fit` — автоматический resize под контейнер
- `addon-search` — поиск по терминалу
- `addon-image` — inline отображение картинок
- `addon-ligatures` — лигатуры шрифтов (опционально, try-catch)
- `addon-clipboard` — буфер обмена
- `addon-serialize` — сериализация scrollback для persistence
- `addon-unicode11` — полная поддержка Unicode 11
- `addon-progress` — визуализация прогресс-баров

**Конфигурация терминала**:
- Scrollback: 5000 строк
- Cursor: block + outline при неактивном терминале
- Kitty keyboard protocol (улучшенная обработка клавиш)
- Bracketed paste
- Скроллбар скрыт (кастомный UI)

### 6.3 Terminal Host Daemon

Отдельный фоновый процесс, переживающий перезапуск приложения:
- **Socket**: `~/.superset/terminal-host.sock` (Unix domain socket)
- **Auth**: `~/.superset/terminal-host.token`
- **Протокол**: NDJSON через socket
- **Spawn limiter**: max 3 одновременных PTY spawn
- **Ready timeout**: 5s ожидание готовности PTY
- **Exit cleanup**: 5s задержка + fail-safe kill timer

### 6.4 DataBatcher — батчинг вывода

Ключевая оптимизация для плавного рендеринга:
- **Time-based**: flush каждые 16ms (60fps)
- **Size-based**: auto-flush при 200KB
- **UTF-8 aware**: StringDecoder для корректной обработки многобайтовых символов
- Существенно снижает overhead IPC-сообщений

### 6.5 Scrollback Persistence

- **localStorage**: `terminal-buffer:{terminalId}` — 1000 строк при detach
- **Headless terminal**: 5000 строк в памяти для replay при reconnect
- **SerializeAddon**: сериализация/десериализация состояния терминала
- Detects clear-scrollback sequences для сброса буфера

### 6.6 Pane-based мультиплексинг (вместо tmux)

Каждая pane = отдельный xterm.js + отдельная PTY сессия:
```typescript
type LayoutNode =
  | { type: "pane"; paneId: string }
  | { type: "split"; direction: "horizontal" | "vertical";
      first: LayoutNode; second: LayoutNode; splitPercentage?: number }
```
- Split горизонтально/вертикально через UI drop zones
- Независимый scrollback/state у каждой pane
- ResizeObserver → FitAddon → pty.resize(cols, rows)
- Registry: Map<terminalId, {runtime, transport, linkManager}>

### 6.7 Интеграция AI-агента с терминалом

```
launchTerminalAdapter() →
  1. Записывает промпт в .superset/task-prompt.md
  2. Создаёт terminal pane в workspace
  3. Устанавливает env: SUPERSET_PANE_ID, WORKSPACE_ID, WORKSPACE_PATH, PORT
  4. writeCommandInPane() — отправляет команду в PTY
  5. Флаг noExecute — записать без выполнения (для ручного запуска)
```

Файлы с промптами и вложениями (лимиты: 50MB/файл, 200MB total) пишутся в `.superset/` директорию проекта.

### 6.8 Веб-терминал (Hono)

Помимо Electron-десктопа, есть HTTP/WS-based терминал:
- `POST /terminal/sessions` — создать сессию
- `GET /terminal/:terminalId` — WebSocket upgrade
- `DELETE /terminal/sessions/:terminalId` — завершить
- Buffer replay для поздно подключившихся (64KB LRU)
- Поддержка нескольких WS-подключений к одной сессии

### 6.9 Сравнение с CSM

| Аспект | Superset | CSM |
|--------|----------|-----|
| Терминал | xterm.js + node-pty (встроенный) | tmux + capture-pane (внешний) |
| Мультиплексинг | UI panes (собственный) | tmux (нативный) |
| Вывод | PTY → DataBatcher → WS → xterm.js | tmux capture-pane → WS → ANSI-up |
| Persistence | localStorage + headless terminal | tmux scrollback buffer |
| Демон | Terminal Host Daemon (Unix socket) | tmux server (уже демон) |
| Resize | FitAddon → pty.resize() | Нативный tmux resize |
| Рендеринг | WebGL (GPU) с DOM fallback | HTML + ANSI-up (CPU) |

**Вывод**: CSM-подход с tmux проще и надёжнее — tmux-сервер уже является демоном, переживает перезапуски, имеет нативный scrollback и мультиплексинг. Superset по сути заново реализовал tmux в виде Terminal Host Daemon + pane system. Однако встроенный xterm.js даёт лучший UX (WebGL рендеринг, inline images, поиск по терминалу).

### 6.10 Что можно позаимствовать для CSM

| Идея | Описание | Сложность |
|------|----------|-----------|
| **DataBatcher для WS** | Батчить WS-сообщения terminal output (16ms/200KB). ~20 строк кода, заметное снижение нагрузки | Low |
| **In-memory replay buffer** | Хранить последние N строк вывода каждой сессии в памяти сервера для мгновенного показа при переключении (вместо capture-pane каждый раз) | Low-Medium |
| **Поиск по терминалу** | Ctrl+F поиск по выводу сессии. Можно реализовать поверх текущего ANSI-up рендера без xterm.js | Medium |
| **Link detection** | Кликабельные файловые пути и URL в терминальном выводе. Superset парсит ссылки с проверкой через stat() | Medium |

---

## 7. Конкретные рекомендации для CSM

> Обновлено с учётом анализа терминальной подсистемы

### Приоритет: HIGH (быстрый эффект, средняя сложность)

| # | Фича | Описание | Сложность |
|---|-------|----------|-----------|
| 1 | **Resizable панели** | Добавить `react-resizable-panels` или CSS `resize` для колонок дашборда. Позволит пользователю настраивать ширину Projects/Wishes/Tasks/Terminal | Low |
| 2 | **Kanban-доска для задач** | Альтернативный вид pipeline: колонки = статусы, карточки перетаскиваются между колонками. Toggle "List/Board" как в Superset | Medium |
| 3 | **Гранулярные WS-подписки** | Подписка на конкретный проект/сессию вместо broadcast всех событий. Снизит трафик, улучшит производительность | Low-Medium |
| 4 | **Input validation (Zod-style)** | Валидация входных данных на API endpoints. Предотвратит ошибки от невалидных данных | Low |
| 5 | **Рефакторинг server.js** | Разбить на модули: routes/, services/, models/. По аналогии с tRPC routers в Superset (task.ts, workspace.ts, etc.) | Medium |

### Приоритет: MEDIUM (хороший ROI, требует планирования)

| # | Фича | Описание | Сложность |
|---|-------|----------|-----------|
| 6 | **Tabs для проектов** | Вкладки вверху дашборда — каждая вкладка = workspace проекта со своими сессиями и задачами. Вместо текущего dropdown выбора проекта | Medium |
| 7 | **Sparklines в карточках** | Мини-графики тренда активности прямо в карточках проектов. uPlot или Chart.js sparkline | Low-Medium |
| 8 | **Настраиваемые статусы задач** | Вместо фиксированного pipeline (new→planned→...) — пользовательские статусы с цветом и порядком (как TaskStatuses в Superset) | Medium |
| 9 | **Command palette** | Cmd+K поиск по всем сущностям: сессии, задачи, wishes, действия. Radix UI Command используется в Superset | Medium |
| 10 | **Skeleton loading** | CSS skeleton заглушки при загрузке вместо спиннеров | Low |

### Приоритет: LOW (долгосрочные улучшения)

| # | Фича | Описание | Сложность |
|---|-------|----------|-----------|
| 11 | **Split-pane layout** | Полноценная система сплит-панелей (как в VS Code). Drag контент в зону → сплит экрана. Требует значительной переработки frontend | High |
| 12 | **GitHub PR интеграция** | Автоматическое создание/отслеживание PR из задач. Привязка branch → PR → merge status | Medium-High |
| 13 | **Analytics dashboard** | Отдельная вкладка с графиками: задачи за период, активность по проектам, heatmap по дням, token usage trends | Medium |
| 14 | **Zustand-like state management** | Перевод frontend на модульные stores вместо замыканий. Улучшит предсказуемость и дебаг | Medium-High |
| 15 | **Rich text для wishes/tasks** | TipTap-like WYSIWYG редактор для описаний задач (markdown + форматирование) | Medium |

---

## Ключевые выводы

### 1. Superset — прямой аналог CSM
Это не BI-инструмент, а полноценный AI-agent orchestrator. Electron-приложение для управления AI-кодинг сессиями с задачами, чатами и интеграциями. Архитектурно на порядок сложнее CSM, но решает ту же проблему.

### 2. Что CSM делает лучше
- **Простота** — vanilla JS, нет build step, мгновенный запуск
- **tmux-native** — прямая работа с терминальными сессиями
- **Wish → Task pipeline** с AI-планированием — у Superset нет аналога
- **Git worktree isolation** — продвинутая изоляция задач

### 3. Самое ценное для заимствования
- **Resizable панели** — минимальные усилия, большой UX-эффект
- **Kanban-доска** — визуальный pipeline задач
- **Гранулярные WS-подписки** — архитектурное улучшение
- **Command palette** (Cmd+K) — быстрый доступ ко всему
- **Модульный backend** — разбить server.js на роутеры

### 4. Что не стоит копировать
- **React/TypeScript/Zustand/tRPC** — overkill для текущего масштаба CSM, vanilla JS проще и быстрее
- **PostgreSQL/Drizzle** — SQLite + file storage достаточно
- **Electric SQL** — WebSocket покрывает потребности
- **Monorepo с Turborepo** — одно приложение не требует монорепо
- **Multi-tenancy** — CSM пока single-user

### 5. Архитектурный урок
Superset масштабируется через **модульность**: отдельные пакеты для UI, DB, auth, API роутеров. CSM может начать этот путь с разделения server.js на модули (routes/, services/) без полной перестройки архитектуры.
