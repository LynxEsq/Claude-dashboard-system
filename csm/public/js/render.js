/**
 * Rendering functions for all 4 columns
 */

function el(id) { return document.getElementById(id); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
/** Render markdown safely: escape HTML first (XSS prevention), then parse markdown */
function md(s) { return typeof marked !== 'undefined' ? marked.parse(esc(s || '')) : esc(s || ''); }
// Escape a string for safe use inside JS string literals in HTML attributes
function escJs(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

// ─── Toast Notifications ────────────────────────

/**
 * Show a toast notification with a user-friendly message.
 * @param {string} message - Main message text
 * @param {'error'|'warning'|'success'|'info'} type - Toast type
 * @param {object} opts - Optional: { hint, duration, retry }
 */
function showToast(message, type = 'error', opts = {}) {
  const container = el('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const title = type === 'error' ? 'Ошибка' : type === 'warning' ? 'Внимание' : type === 'success' ? 'Готово' : 'Инфо';

  let html = `
    <div class="toast-header">
      <span class="toast-title">${esc(title)}</span>
      <button class="toast-close" onclick="this.closest('.toast').remove()">&times;</button>
    </div>
    <div class="toast-message">${esc(message)}</div>
  `;

  if (opts.hint) {
    html += `<div class="toast-hint">${esc(opts.hint)}</div>`;
  }

  if (opts.retry) {
    html += `<div class="toast-actions"><button class="btn sm" onclick="this.closest('.toast').remove(); (${opts.retry})()">Повторить</button></div>`;
  }

  toast.innerHTML = html;
  container.appendChild(toast);

  const duration = opts.duration || (type === 'error' ? 8000 : 4000);
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Handle an API error: show a toast with the error details.
 * Use this in catch blocks for all API calls.
 */
function handleApiError(err, context) {
  console.error(`[${context}]`, err);

  if (err instanceof ApiError) {
    showToast(err.message, 'error', { hint: err.hint });
  } else if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
    showToast('Нет соединения с сервером CSM', 'error', {
      hint: 'Убедитесь, что сервер запущен (node src/index.js web)',
    });
  } else {
    showToast(err.message || 'Неизвестная ошибка', 'error');
  }
}

// ─── Column 1: Projects ──────────────────────────

function renderProjects() {
  const list = el('projectList');
  const names = Object.keys(State.sessions);

  if (names.length === 0) {
    list.innerHTML = '<div class="empty-msg">No projects yet.<br>Click + to create one.</div>';
    return;
  }

  list.innerHTML = names.map(name => {
    const s = State.sessions[name];
    const active = State.selected === name ? 'active' : '';
    let tokenHtml = '';
    if (s.tokens?.percentage != null) {
      const lvl = s.tokens.percentage >= 80 ? 'high' : s.tokens.percentage >= 60 ? 'med' : 'low';
      tokenHtml = `<div class="token-mini"><div class="token-mini-bar"><div class="token-mini-fill ${lvl}" style="width:${s.tokens.percentage}%"></div></div>${s.tokens.percentage}%</div>`;
    }
    const planning = State.planningProjects.has(name);
    const planDot = planning ? '<div class="planning-dot" title="AI Planning in progress"></div>' : '';

    // Task progress bar
    const tc = State.taskCounts[name];
    const allDone = tc && tc.total > 0 && tc.completed === tc.total;
    const statusDotClass = allDone ? 'all-done' : s.status;

    let progressHtml = '';
    if (tc && tc.total > 0) {
      const pct = (count) => ((count / tc.total) * 100).toFixed(1);
      const tooltip = `${tc.completed}c ${tc.running}r ${tc.pending}p${tc.failed ? ' ' + tc.failed + 'f' : ''} (${tc.completed}/${tc.total})`;
      progressHtml = `<div class="task-progress-bar" title="${tooltip}">`;
      if (tc.completed) progressHtml += `<div class="task-progress-segment completed" style="width:${pct(tc.completed)}%"></div>`;
      if (tc.running) progressHtml += `<div class="task-progress-segment running" style="width:${pct(tc.running)}%"></div>`;
      if (tc.pending) progressHtml += `<div class="task-progress-segment pending" style="width:${pct(tc.pending)}%"></div>`;
      if (tc.failed) progressHtml += `<div class="task-progress-segment failed" style="width:${pct(tc.failed)}%"></div>`;
      progressHtml += `</div>`;
    }

    return `
      <div class="project-item ${active}" onclick="selectProject('${escJs(name)}')" oncontextmenu="showProjectCtxMenu(event, '${escJs(name)}')">
        <div class="status-dot ${statusDotClass}"></div>
        <div class="project-info">
          <div class="project-name">${esc(name)}${planDot}</div>
          ${progressHtml}
        </div>
        ${tokenHtml}
        <button class="btn sm danger project-del" onclick="event.stopPropagation(); deleteProject('${escJs(name)}')" title="Delete project">&times;</button>
      </div>
    `;
  }).join('');
}

// ─── Column 2: Wishes ────────────────────────────

function renderWishes() {
  const list = el('wishList');
  if (State.wishes.length === 0) {
    list.innerHTML = '<div class="empty-msg">No wishes yet.<br>Add one above!</div>';
    el('wishCount').textContent = '';
    return;
  }

  const newCount = State.wishes.filter(w => !w.processed).length;
  el('wishCount').textContent = newCount > 0 ? `(${newCount} new)` : '';

  list.innerHTML = State.wishes.map(w => {
    const isSelected = State.selectedWish === w.id;
    let cls = w.processed ? 'wish-item processed' : 'wish-item';
    if (isSelected) cls += ' wish-selected';
    const time = new Date(w.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const taskIds = getLinkedTaskIds(w);

    // Editing mode
    if (State.editingWish === w.id) {
      return `
        <div class="${cls}" style="border-color:var(--blue)">
          <textarea id="wish-edit-${w.id}" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px;font-size:12px;font-family:inherit;resize:vertical;min-height:40px">${esc(w.content)}</textarea>
          <div class="wish-meta" style="margin-top:6px">
            <span>${time}</span>
            <div class="wish-edit-actions">
              <button class="btn sm primary" onclick="saveWish(${w.id})">Save</button>
              <button class="btn sm" onclick="cancelEditWish()">Cancel</button>
            </div>
          </div>
        </div>
      `;
    }

    const tasksBadge = w.processed && taskIds.length > 0
      ? `<span class="wish-tasks-badge${isSelected ? ' active' : ''}" onclick="event.stopPropagation(); selectWish(${w.id})">${taskIds.length} task${taskIds.length !== 1 ? 's' : ''}</span>`
      : '';

    return `
      <div class="${cls}"${w.processed && taskIds.length > 0 ? ` onclick="selectWish(${w.id})"` : ''}>
        <div class="wish-content markdown-body">${md(w.content)}</div>
        <div class="wish-meta">
          <span>${time} · ${w.processed ? 'processed' : 'new'} ${tasksBadge}</span>
          <div class="wish-edit-actions">
            ${!w.processed ? `<button class="btn sm" onclick="editWish(${w.id})">Edit</button>` : ''}
            <button class="btn sm danger" onclick="event.stopPropagation(); removeWish(${w.id})">×</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Column 3: Tasks ─────────────────────────────

/** Format a timestamp as relative time (e.g. "5m ago") or short absolute (HH:MM) */
function formatTaskTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'));
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 0 || isNaN(diff)) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderTasks() {
  const list = el('taskList');
  if (State.tasks.length === 0) {
    list.innerHTML = '<div class="empty-msg">No tasks yet.<br>Add wishes and click Plan.</div>';
    el('taskCount').textContent = '';
    return;
  }

  const pending = State.tasks.filter(t => t.status === 'pending' && t.type !== 'plan').length;
  const running = State.tasks.filter(t => t.status === 'running' && t.type !== 'plan').length;
  el('taskCount').textContent = `(${pending}p${running ? ' ' + running + 'r' : ''})`;

  // Sort tasks: running > pending > completed > failed; within group by priority/time
  const statusOrder = { running: 0, pending: 1, completed: 2, failed: 3 };
  const sorted = [...State.tasks].sort((a, b) => {
    const oa = statusOrder[a.status] ?? 4;
    const ob = statusOrder[b.status] ?? 4;
    if (oa !== ob) return oa - ob;
    // Within same status group
    if (a.status === 'running') return (b.priority || 0) - (a.priority || 0) || (a.started_at || '').localeCompare(b.started_at || '');
    if (a.status === 'pending') return (b.priority || 0) - (a.priority || 0) || (a.created_at || '').localeCompare(b.created_at || '');
    if (a.status === 'completed' || a.status === 'failed') return (b.completed_at || '').localeCompare(a.completed_at || '');
    return 0;
  });

  // Determine which task IDs are linked to the selected wish
  const selectedWish = State.selectedWish
    ? State.wishes.find(w => w.id === State.selectedWish)
    : null;
  const linkedTaskIds = selectedWish ? getLinkedTaskIds(selectedWish) : [];
  const hasWishFilter = linkedTaskIds.length > 0;

  list.innerHTML = sorted.map(t => {
    const active = State.selectedTask === t.id ? 'active' : '';
    const isLinked = hasWishFilter && linkedTaskIds.includes(t.id);
    const dimmed = hasWishFilter && !isLinked ? 'task-dimmed' : '';
    const highlighted = isLinked ? 'task-wish-linked' : '';
    const isPlan = t.type === 'plan';

    // Editing mode (not for plan tasks)
    if (State.editingTask === t.id && !isPlan) {
      return `
        <div class="task-item" style="border-color:var(--blue)">
          <div class="fg" style="margin-bottom:6px">
            <input id="task-edit-title-${t.id}" value="${esc(t.title)}" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 8px;font-size:12px">
          </div>
          <div class="fg" style="margin-bottom:0">
            <textarea id="task-edit-desc-${t.id}" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px;font-size:11px;font-family:inherit;resize:vertical;min-height:60px">${esc(t.description)}</textarea>
          </div>
          <div class="task-edit-actions">
            <button class="btn sm primary" onclick="saveTask(${t.id})">Save</button>
            <button class="btn sm" onclick="cancelEditTask()">Cancel</button>
          </div>
        </div>
      `;
    }

    // Plan-type task rendering
    if (isPlan) {
      const expanded = State.selectedTask === t.id;
      const resultText = t.result || '';
      const resultHtml = resultText
        ? (expanded
          ? `<div class="task-plan-result expanded markdown-body">${md(resultText)}</div>`
          : `<div class="task-plan-result">${esc(resultText).substring(0, 150)}${resultText.length > 150 ? '...' : ''}</div>`)
        : (t.status === 'running'
          ? `<div class="task-plan-result" style="color:var(--text2);font-style:italic">AI is analyzing wishes...</div>`
          : '');

      return `
        <div class="task-item task-plan ${active} ${dimmed} ${highlighted}" onclick="selectTask(${t.id})">
          <div class="task-header">
            <span class="task-status plan-${t.status}">Plan</span>
            <span class="task-title">${esc(t.title)}</span>
          </div>
          ${resultHtml}
          <div class="task-timestamps">
            ${t.status === 'running' && t.started_at ? `<span>Started: ${formatTaskTime(t.started_at)}</span>` : ''}
            ${t.status === 'completed' && t.completed_at ? `<span>Completed: ${formatTaskTime(t.completed_at)}</span>` : ''}
            ${t.status === 'failed' && t.completed_at ? `<span>Failed: ${formatTaskTime(t.completed_at)}</span>` : ''}
          </div>
          <div class="task-toolbar">
            <div class="task-toolbar-left"></div>
            <div class="task-toolbar-right">
              <button class="btn sm danger" onclick="event.stopPropagation(); removeTask(${t.id})">×</button>
            </div>
          </div>
        </div>
      `;
    }

    // Wish origin label
    const wishIds = getLinkedWishIds(t);
    const wishLabel = wishIds.length > 0
      ? `<span class="task-wish-origin" onclick="event.stopPropagation(); selectWish(${wishIds[0]})" title="From wish #${wishIds.join(', #')}">wish #${wishIds[0]}</span>`
      : '';

    const expanded = State.selectedTask === t.id;
    const descHtml = expanded
      ? `<div class="task-desc expanded markdown-body">${md(t.description)}</div>`
      : `<div class="task-desc">${esc(t.description).substring(0, 120)}${(t.description || '').length > 120 ? '...' : ''}</div>`;

    return `
      <div class="task-item ${active} ${dimmed} ${highlighted}" onclick="selectTask(${t.id})">
        <div class="task-header">
          <span class="task-status ${t.status}">${t.status}</span>
          <span class="task-title">${esc(t.title)}</span>
          ${wishLabel}
        </div>
        ${descHtml}
        <div class="task-timestamps">
          ${t.status === 'running' && t.started_at ? `<span>Started: ${formatTaskTime(t.started_at)}</span>` : ''}
          ${t.status === 'completed' && t.completed_at ? `<span>Completed: ${formatTaskTime(t.completed_at)}</span>` : ''}
          ${t.status === 'failed' && t.completed_at ? `<span>Failed: ${formatTaskTime(t.completed_at)}</span>` : ''}
          ${t.status === 'pending' ? `<span>Created: ${formatTaskTime(t.created_at)}</span>` : ''}
          ${t.updated_at && t.updated_at !== t.created_at ? `<span>Updated: ${formatTaskTime(t.updated_at)}</span>` : ''}
        </div>
        <div class="task-toolbar">
          <div class="task-toolbar-left">
            ${t.status === 'pending' ? `<button class="btn sm green" onclick="event.stopPropagation(); runTaskInteractive(${t.id})" title="Run in Claude session">Run</button>` : ''}
            ${t.status === 'pending' ? `<button class="btn sm green" style="opacity:0.7" onclick="event.stopPropagation(); runTaskSilent(${t.id})" title="Run with --print (silent)">Silent</button>` : ''}
          </div>
          <div class="task-toolbar-right">
            ${t.status === 'pending' || t.status === 'running' ? `<button class="btn sm" style="color:var(--green);border-color:var(--green)" onclick="event.stopPropagation(); completeTask(${t.id})" title="Mark as done">Done</button>` : ''}
            ${t.status === 'completed' ? `<button class="btn sm" onclick="event.stopPropagation(); reopenTask(${t.id})" title="Reopen task">Reopen</button>` : ''}
            ${t.status === 'pending' ? `<button class="btn sm" onclick="event.stopPropagation(); editTask(${t.id})">Edit</button>` : ''}
            <button class="btn sm danger" onclick="event.stopPropagation(); removeTask(${t.id})">×</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Column 4: Terminal ──────────────────────────

function renderTerminal() {
  if (!State.selected || !State.sessions[State.selected]) {
    el('termBody').textContent = 'Select a project to see output...';
    el('termTitle').textContent = 'Terminal';
    el('termDot').className = 'status-dot';
    return;
  }

  // If a task is selected or live mode is off, don't overwrite
  if (State.selectedTask) return;
  if (!State.liveMode) return;

  const s = State.sessions[State.selected];
  el('termTitle').textContent = State.selected;
  el('termDot').className = `status-dot ${s.status}`;

  if (s.lastOutput) {
    el('termBody').textContent = s.lastOutput;
  } else if (s.status === 'offline') {
    el('termBody').textContent = `Session offline: ${s.detail || 'tmux pane not available'}.\nCheck that the tmux session exists and the pane target is correct.`;
  } else if (s.status === 'working') {
    el('termBody').textContent = `Claude is working... (${s.detail || 'processing'})\nWaiting for terminal output to appear.`;
  } else {
    el('termBody').textContent = '(no output yet)';
  }

  const body = el('termBody');
  body.scrollTop = body.scrollHeight;
}

// ─── Alerts ──────────────────────────────────────

function renderAlerts() {
  const badge = el('alertCount');
  if (State.alerts.length > 0) {
    badge.classList.add('visible');
    badge.textContent = State.alerts.length;
  } else {
    badge.classList.remove('visible');
  }
}
