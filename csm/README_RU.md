# CSM — Claude Session Manager

Дашборд и CLI для мониторинга и управления множественными сессиями Claude Code, работающими в tmux.

## Что делает

- Определение статуса каждой сессии в реальном времени (Working, Needs Input, Idle, Error, Offline)
- Веб-дашборд с live-обновлениями через WebSocket
- Просмотр вывода терминала и отправка ввода без переключения tmux
- Отслеживание использования токенов с настраиваемыми алертами
- **Pipeline**: Inbox (Wishes) → AI-планирование → Выполнение задач
- Автообнаружение сессий Claude в tmux
- Персистентные маппинги сессий с восстановлением после рестарта
- **Кросс-платформенность**: macOS, Linux, Windows (WSL)
- **Удалённый доступ**: автодетекция локального/удалённого клиента, генерация SSH-команд

## Установка

### Требования

- **Node.js** 18+
- **tmux** 3.0+
- **Claude Code** CLI установлен и авторизован

### Вариант 1: Локальная машина (macOS / Linux)

```bash
git clone https://github.com/LynxEsq/Claude-dashboard-system.git
cd Claude-dashboard-system

# Автоустановка зависимостей и запуск
./start.sh

# Или вручную
cd csm
npm install
node src/index.js web
```

Дашборд откроется на http://localhost:9847

### Вариант 2: Windows (WSL)

```bash
# Внутри WSL (Ubuntu/Debian)
git clone https://github.com/LynxEsq/Claude-dashboard-system.git
cd Claude-dashboard-system/csm
npm install

# Только локальный доступ (по умолчанию)
node src/index.js web

# Или разрешить доступ из браузера Windows
node src/index.js web --host 0.0.0.0
```

Откройте `http://localhost:9847` в WSL или `http://<wsl-ip>:9847` из браузера Windows.

### Вариант 3: Удалённая dev-станция

Запустите CSM на сервере, откройте дашборд с любого устройства в сети:

```bash
# На сервере
node src/index.js web --host 0.0.0.0

# С ноутбука — откройте в браузере:
# http://<ip-сервера>:9847
```

При удалённом доступе кнопка «Terminal» автоматически переключается в SSH-режим — показывает копируемую команду `ssh -t user@host "tmux attach -t session"` вместо попытки открыть окно терминала на сервере.

## Конфигурация

Хранится в `~/.csm/config.json`:

```json
{
  "port": 9847,
  "host": "localhost",
  "pollInterval": 3000,
  "historyRetention": 30,
  "alerts": {
    "needsInputTimeout": 300,
    "idleTimeout": 600,
    "tokenThreshold": 80
  },
  "sessions": []
}
```

| Параметр | По умолчанию | Описание |
|----------|-------------|----------|
| `port` | 9847 | Порт веб-сервера |
| `host` | `localhost` | Адрес привязки. `0.0.0.0` для удалённого доступа |
| `pollInterval` | 3000 | Интервал опроса tmux (мс) |
| `historyRetention` | 30 | Дней хранения истории |
| `alerts.needsInputTimeout` | 300 | Секунд до алерта «ожидает ввод» |
| `alerts.idleTimeout` | 600 | Секунд до алерта «простаивает» |
| `alerts.tokenThreshold` | 80 | % использования токенов для алерта |

> **Безопасность**: при `host: "0.0.0.0"` сервер доступен из сети без аутентификации. Используйте только в доверенных сетях.

## Архитектура

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  tmux panes │────▶│  Monitor     │────▶│  WebSocket      │
│  (Claude    │     │  (опрос      │     │  broadcast всем │
│   sessions) │     │   каждые 3с) │     │  клиентам       │
└─────────────┘     └──────┬───────┘     └────────┬────────┘
                           │                      │
                    ┌──────▼───────┐     ┌────────▼────────┐
                    │  SQLite DB   │     │  Веб-дашборд    │
                    │  (история,   │     │  (SPA, 4 колонки)│
                    │   pipeline)  │     │                  │
                    └──────────────┘     └─────────────────┘
```

### Backend
- **Runtime**: Node.js
- **CLI**: Commander.js (`csm/src/index.js`)
- **Monitor**: EventEmitter, опрашивает tmux panes, детектит статус через regex
- **Веб-сервер**: Express + WebSocket (ws), REST API + обновления в реальном времени
- **База данных**: SQLite3 (better-sqlite3, WAL mode)
- **Платформа**: автодетекция macOS, Linux, WSL (`csm/src/lib/platform.js`)

### Frontend
- Vanilla JS SPA, без фреймворков
- 4-колоночный layout: **Projects** → **Inbox** → **Tasks** → **Terminal**
- CSS Grid, тёмная тема
- WebSocket для live-обновлений с автопереподключением

## CLI-команды

```bash
csm status [--watch]              # Статус сессий (автообновление с --watch)
csm add <name> <tmux-session>    # Зарегистрировать сессию
  [--window W] [--pane P] [--dir PATH]
csm remove <name>                 # Удалить сессию
csm list                          # Список всех сессий
csm web [-p PORT] [-H HOST]      # Запустить веб-дашборд
  [--no-open]                     #   --host 0.0.0.0 для удалённого доступа
csm send <name> <input...>        # Отправить ввод в сессию
csm focus <name>                  # Переключить tmux фокус
csm discover [--cleanup]          # Найти сессии Claude в tmux
csm config [--show] [--set K=V]   # Просмотр/изменение конфигурации
```

### Discover

`csm discover` сканирует все tmux-сессии и определяет те, в которых запущен Claude Code. С флагом `--cleanup` также убивает осиротевшие pipeline-сессии (csm-task-\*, csm-plan-\*, csm-exec-\*).

## Веб-дашборд

4-колоночный layout:

| Колонка | Содержимое |
|---------|-----------|
| **Projects** | Список сессий с индикаторами статуса, полосками токенов, состоянием планирования |
| **Inbox** | Текстовое поле для wishes, список wishes с редактированием/удалением |
| **Tasks** | Список задач по статусам (pending/running/completed/failed), кнопки Plan и Run |
| **Terminal** | Live-вывод терминала, кнопки raw keys, текстовый ввод для Claude |

### Модальные окна
- **Create Project** — имя, путь проекта с браузером каталогов, автозапуск Claude
- **Project Settings** — просмотр/редактирование имени, tmux-сессии, пути; список всех tmux-сессий проекта (основная + задачи) со статусами и кнопками подключения
- **Directory Browser** — навигация по файловой системе, индикаторы git-репозитория и CLAUDE.md, двойной клик для входа в каталог
- **Add Manual Task** — заголовок, описание, приоритет
- **Permissions** — быстрые пресеты + ручной ввод разрешений
- **SSH Command** (удалённо) — копируемая SSH-команда для подключения к tmux-сессии

### Кросс-платформенная кнопка Terminal

Кнопка «Terminal» адаптируется к окружению:

| Платформа | Поведение |
|-----------|----------|
| **macOS** | Открывает Terminal.app с `tmux attach` |
| **WSL** | Открывает Windows Terminal (или cmd.exe как fallback) |
| **Linux** | Пробует gnome-terminal, konsole, xfce4-terminal, xterm |
| **Удалённый доступ** | Показывает модалку с SSH-командой и кнопкой Copy |

Определение удалённого/локального доступа автоматическое — по IP-адресу клиента.

## Система Pipeline

Pipeline трансформирует идеи в выполненные задачи:

```
Wishes (Inbox) ──▶ AI-планирование ──▶ Tasks ──▶ Выполнение
```

### Wishes
Свободный текст в Inbox. Несколько wishes можно объединить для планирования.

### AI-планирование
Запускает выделенную сессию Claude (`csm-plan-{name}`), которая читает необработанные wishes и существующие задачи, затем выдаёт JSON-план с действиями создания/обновления/удаления задач и определением зависимостей.

### Tasks
Каждая задача имеет: заголовок, описание, статус, приоритет, связанные wishes и опциональные зависимости (blocked_by).

**Статусы**: `pending` → `running` → `completed` | `failed`

### Зависимости задач
Задачи могут зависеть от других задач. Задача с неразрешёнными блокерами отображается, но не будет автоматически выполнена до завершения зависимостей.

### Режимы выполнения

| Режим | Паттерн сессии | Описание |
|-------|---------------|----------|
| **Interactive** | `csm-task-{name}-{id}` | Выделенная сессия Claude, вставка промпта через буфер, детекция завершения |
| **Silent** | `csm-exec-{name}-{id}` | `claude --print --no-session-persistence`, вывод через файл |
| **Direct** | Основная сессия | Отправка промпта в существующую сессию Claude |

### Маппинги сессий и восстановление после рестарта
Активные маппинги задача↔tmux-сессия сохраняются в SQLite. При рестарте сервера `restoreSessionMappings()` проверяет, какие tmux-сессии ещё живы, и восстанавливает отслеживание, либо помечает задачи как завершённые, если сессия исчезла.

## Permissions

Чтение и запись `.claude/settings.local.json` для каждого проекта для управления разрешениями Claude Code.

```json
{
  "permissions": {
    "allow": ["Bash(npm test)", "Read", "Write"]
  }
}
```

Доступно через API и модальное окно дашборда с быстрыми пресетами.

## REST API

Базовый URL: `http://localhost:9847`

### Сессии

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/sessions` | Все сессии |
| GET | `/api/sessions/:name` | Одна сессия |
| POST | `/api/sessions/create` | Создать сессию + автозапуск Claude |
| POST | `/api/sessions/:name/send` | Отправить текстовый ввод |
| POST | `/api/sessions/:name/keys` | Отправить raw tmux keys |
| POST | `/api/sessions/:name/focus` | Переключить tmux фокус |
| POST | `/api/sessions/:name/terminal` | Открыть в терминале (кросс-платформенно) |
| GET | `/api/sessions/:name/tmux-sessions` | Список всех tmux-сессий проекта (основная + задачи) |
| POST | `/api/sessions/:name/restart` | Ctrl+C + перезапуск Claude |
| POST | `/api/sessions/:name/kill` | Убить tmux-сессию |
| POST | `/api/sessions/:name/destroy` | Полная очистка (убить, удалить конфиг, очистить БД) |

### Permissions

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/sessions/:name/permissions` | Получить разрешения проекта |
| POST | `/api/sessions/:name/permissions` | Обновить разрешения проекта |

### Платформа и доступ

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/platform` | ОС сервера и информация о терминале |
| GET | `/api/access-info` | Детекция local/remote, данные для SSH-подключения |
| GET | `/api/fs/list?path=...` | Обзор каталогов (для браузера директорий) |

### История

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/history/:name/status` | История статусов (?hours=24) |
| GET | `/api/history/:name/tokens` | История токенов (?hours=24) |
| GET | `/api/history/tokens` | История токенов всех сессий |
| GET | `/api/history/:name/timeline` | Таймлайн сессии |

### Алерты

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/alerts` | Неподтверждённые алерты |
| POST | `/api/alerts/:id/acknowledge` | Подтвердить алерт |

### Конфигурация

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/config` | Текущая конфигурация |
| POST | `/api/config/session` | Добавить/обновить сессию |
| DELETE | `/api/config/session/:name` | Удалить сессию |

### tmux

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/tmux/sessions` | Список всех tmux-сессий (отслеживаемые/нет) |
| POST | `/api/tmux/kill` | Убить конкретную tmux-сессию |
| POST | `/api/tmux/cleanup-pipeline` | Убить осиротевшие pipeline-сессии |

### Pipeline — Wishes

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/pipeline/:name/wishes` | Получить wishes |
| POST | `/api/pipeline/:name/wishes` | Создать wish `{content}` |
| PUT | `/api/pipeline/wishes/:id` | Обновить wish `{content}` |
| DELETE | `/api/pipeline/wishes/:id` | Удалить wish |

### Pipeline — Tasks

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/pipeline/:name/tasks` | Получить задачи (?status=...) |
| POST | `/api/pipeline/:name/tasks` | Создать задачу `{title, description, wishIds, priority, blocked_by}` |
| PUT | `/api/pipeline/tasks/:id` | Обновить поля задачи |
| PUT | `/api/pipeline/tasks/:id/status` | Обновить статус `{status, outputSummary}` |
| DELETE | `/api/pipeline/tasks/:id` | Удалить задачу |

### Pipeline — Зависимости

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/pipeline/tasks/:id/dependencies` | Получить блокеры и зависимые |
| POST | `/api/pipeline/tasks/:id/dependencies` | Установить блокеры `{blocked_by}` |

### Pipeline — Планирование и выполнение

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/api/pipeline/:name/plan` | Запустить AI-планирование |
| GET | `/api/pipeline/:name/plan/status` | Проверить прогресс планирования |
| POST | `/api/pipeline/:name/apply-plan` | Применить план `{tasksJson, wishIds}` |
| POST | `/api/pipeline/:name/execute` | Выполнить следующую pending-задачу (interactive) |
| POST | `/api/pipeline/:name/execute-interactive` | Выполнить конкретную задачу интерактивно `{taskId}` |
| POST | `/api/pipeline/:name/execute-silent` | Выполнить конкретную задачу тихо `{taskId}` |
| GET | `/api/pipeline/:name/task-status/:taskId` | Опрос статуса выполнения |
| GET | `/api/pipeline/:name/executions` | История выполнений |

## WebSocket

Подключение: `ws://localhost:9847`

### Сообщения сервер → клиент

| Тип | Данные | Описание |
|-----|--------|----------|
| `state` | `{sessionName: {...}}` | Полный снимок состояния при подключении |
| `update` | `{name, session}` | Обновление одной сессии |
| `statusChange` | `{name, from, to, detail}` | Смена статуса |
| `alert` | `{...alert}` | Новый алерт |
| `alerts` | `[...alerts]` | Список алертов |
| `wishAdded` | `{sessionName, id, content}` | Создан новый wish |
| `planStarted` | `{sessionName, tmuxSession}` | AI-планирование запущено |
| `planFinished` | `{sessionName, status}` | AI-планирование завершено |
| `taskCreated` | `{sessionName, id, title, blocked_by}` | Создана новая задача |
| `taskStarted` | `{sessionName, taskId, tmuxSession, mode}` | Запущено выполнение задачи |
| `planApplied` | `{sessionName, success, taskIds, tasks}` | План применён к задачам |

## Детекция статусов

Определяется через regex-паттерны в `csm/src/lib/detector.js`:

| Статус | Индикаторы |
|--------|-----------|
| **Working** | Spinner-символы (⏳✻⠋-⠏), "Thinking", "Searching", "Reading", "Writing", "Executing" |
| **Needs Input** | Prompt-символы (❯$#%), вопросы, (y/n), "Press Enter", "Allow" |
| **Error** | "Error:", "Failed", rate limit, connection errors, SIGTERM |
| **Idle** | Нет недавней активности |
| **Offline** | tmux-сессия не найдена |

## Поддержка Git Worktrees

Задачи могут быть изолированы в отдельных git worktrees для избежания конфликтов:

- Worktrees хранятся в `~/.csm/worktrees/task-{taskId}/`
- Именование веток: `csm/task-{taskId}`
- Автоматическое создание и очистка

## Хранение данных

| Файл | Расположение | Содержимое |
|------|-------------|-----------|
| config.json | `~/.csm/config.json` | Сессии и настройки |
| history.db | `~/.csm/history.db` | Логи статусов, снимки токенов, алерты |
| pipeline.db | `~/.csm/pipeline.db` | Wishes, задачи, логи выполнения, зависимости, маппинги сессий |
| worktrees/ | `~/.csm/worktrees/` | Git worktrees для изоляции задач |

### Таблицы БД

**history.db**: `status_log`, `token_snapshots`, `alerts`

**pipeline.db**: `wishes`, `tasks`, `execution_log`, `task_dependencies`, `session_mappings`

## Автоочистка

- Старые данные истории удаляются ежедневно (настраиваемый период хранения)
- Осиротевшие pipeline tmux-сессии очищаются каждые 5 минут
- При удалении проекта: все связанные tmux-сессии убиваются, записи БД очищаются

## Технологии

| Компонент | Технология |
|-----------|-----------|
| Runtime | Node.js |
| CLI | Commander.js |
| Веб-сервер | Express 4 |
| WebSocket | ws |
| База данных | better-sqlite3 (WAL mode) |
| Терминал | tmux |
| Frontend | Vanilla JS, CSS Grid |
| Платформа | macOS, Linux, WSL |

## Лицензия

MIT
