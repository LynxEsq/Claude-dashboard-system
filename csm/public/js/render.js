/**
 * Rendering functions for all 4 columns
 */

function el(id) { return document.getElementById(id); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ANSI → HTML converter for terminal output
const _ansiUp = new AnsiUp();
_ansiUp.escape_html = true; // XSS protection (default, but explicit)
/** Convert text with ANSI escape codes to safe HTML */
function ansiHtml(s) { return _ansiUp.ansi_to_html(s || ''); }
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

  if (State.loading) {
    list.innerHTML = Array.from({length: 3}, () =>
      '<div class="skeleton-project"><div class="skeleton skeleton-dot"></div><div style="flex:1"><div class="skeleton skeleton-line w60"></div></div></div>'
    ).join('');
    return;
  }

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
    const hasRunningTasks = tc && tc.running > 0;
    const hasPendingWork = tc && (tc.pending > 0 || tc.running > 0 || (tc.merge_pending || 0) > 0);
    const allDone = tc && tc.total > 0 && tc.completed === tc.total;
    // Green if tasks running, blue only if all done AND there was recent active work, otherwise session status
    const statusDotClass = hasRunningTasks ? 'working'
      : hasPendingWork ? s.status
      : s.status;  // all-done no longer overrides — use tmux session status

    let progressHtml = '';
    if (tc && tc.total > 0) {
      const pct = (count) => ((count / tc.total) * 100).toFixed(1);
      const mp = tc.merge_pending || 0;
      const tooltip = `${tc.completed}c ${tc.running}r ${tc.pending}p${mp ? ' ' + mp + 'm' : ''}${tc.failed ? ' ' + tc.failed + 'f' : ''} (${tc.completed}/${tc.total})`;
      progressHtml = `<div class="task-progress-bar" title="${tooltip}">`;
      if (tc.completed) progressHtml += `<div class="task-progress-segment completed" style="width:${pct(tc.completed)}%"></div>`;
      if (mp) progressHtml += `<div class="task-progress-segment merge-pending" style="width:${pct(mp)}%"></div>`;
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

function renderWishItem(w) {
  const isSelected = State.selectedWish === w.id;
  const isPlanning = State.planningWishIds.has(w.id);
  let cls = w.processed ? 'wish-item processed' : isPlanning ? 'wish-item wish-planning' : 'wish-item';
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
    : w.processed
    ? `<span class="wish-tasks-badge" style="opacity:0.5" onclick="event.stopPropagation(); selectWish(${w.id})">plan</span>`
    : '';

  const statusLabel = w.processed ? 'processed' : isPlanning ? '<span class="wish-planning-badge">Planning...</span>' : 'new';

  return `
    <div class="${cls}"${w.processed ? ` onclick="selectWish(${w.id})"` : ''}>
      <div class="wish-content markdown-body">${md(w.content)}</div>
      <div class="wish-meta">
        <span>${time} · ${statusLabel} ${tasksBadge}</span>
        <div class="wish-edit-actions">
          ${!w.processed && !isPlanning ? `<button class="btn sm" onclick="editWish(${w.id})">Edit</button>` : ''}
          <button class="btn sm danger" onclick="event.stopPropagation(); removeWish(${w.id})">×</button>
        </div>
      </div>
    </div>
  `;
}

function renderWishes() {
  const list = el('wishList');
  if (State.wishes.length === 0) {
    list.innerHTML = '<div class="empty-msg">No wishes yet.<br>Add one above!</div>';
    el('wishCount').textContent = '';
    return;
  }

  const newCount = State.wishes.filter(w => !w.processed).length;
  el('wishCount').textContent = newCount > 0 ? `(${newCount} new)` : '';

  const hasPlanning = State.planningWishIds.size > 0;

  if (!hasPlanning) {
    // No active planning — render flat list as before
    list.innerHTML = State.wishes.map(renderWishItem).join('');
    return;
  }

  // Split wishes into groups: planning, new (added after planning), processed
  const planningWishes = [];
  const newWishes = [];
  const processedWishes = [];

  for (const w of State.wishes) {
    if (w.processed) {
      processedWishes.push(w);
    } else if (State.planningWishIds.has(w.id)) {
      planningWishes.push(w);
    } else {
      newWishes.push(w);
    }
  }

  let html = '';

  if (planningWishes.length > 0) {
    html += planningWishes.map(renderWishItem).join('');
  }

  if (newWishes.length > 0) {
    if (planningWishes.length > 0) {
      html += '<div class="wish-group-separator">Added after planning</div>';
    }
    html += newWishes.map(renderWishItem).join('');
  }

  if (processedWishes.length > 0) {
    html += processedWishes.map(renderWishItem).join('');
  }

  list.innerHTML = html;
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

/** Check if a pending task has active (running/pending) blockers */
function getTaskActiveBlockers(taskId) {
  const deps = State.taskDependencies[taskId];
  if (!deps || !Array.isArray(deps)) return [];
  return deps.filter(d => d.blockerStatus === 'running' || d.blockerStatus === 'pending');
}

/** Render a single task item HTML (shared between top-level and nested) */
function renderTaskItem(t, { active, dimmed, highlighted, nested, blockerInfo }) {
  const isPlan = t.type === 'plan';
  const isBlocked = nested || false;
  const blockedClass = isBlocked ? 'task-blocked' : '';

  // Editing mode (not for plan tasks)
  if (State.editingTask === t.id && !isPlan) {
    return `
      <div class="task-item ${blockedClass}" style="border-color:var(--blue)">
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
    let statusInfo = '';
    if (t.status === 'running') {
      const elapsed = t.started_at ? Math.round((Date.now() - new Date(t.started_at + (t.started_at.includes('Z') ? '' : 'Z')).getTime()) / 1000) : 0;
      const stageText = elapsed < 5 ? 'Starting planning session...'
        : elapsed < 15 ? 'Launching Claude AI planner...'
        : elapsed < 30 ? 'AI is reading wishes and existing tasks...'
        : 'AI is analyzing and generating tasks...';
      statusInfo = `<div class="task-plan-result" style="color:var(--text2);font-style:italic">${stageText} (${elapsed}s)</div>`;
    }
    const resultHtml = resultText
      ? (expanded
        ? `<div class="task-plan-result expanded markdown-body">${md(resultText)}</div>`
        : `<div class="task-plan-result">${esc(resultText).substring(0, 150)}${resultText.length > 150 ? '...' : ''}</div>`)
      : statusInfo;

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

  // Blocker info label for nested tasks
  const blockerLabel = blockerInfo
    ? `<div class="task-blocker-label">\u26D4 \u0416\u0434\u0451\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F: ${esc(blockerInfo.blockerTitle || 'Task #' + blockerInfo.blockerTaskId)}${blockerInfo.reason ? ' \u2014 ' + esc(blockerInfo.reason) : ''}</div>`
    : '';

  // Worktree badge
  const hasWorktree = t.worktree_path || t.worktree_branch;
  const worktreeBadge = hasWorktree
    ? `<span class="task-wt-badge" title="Branch: ${esc(t.worktree_branch || '')}">WT</span>`
    : '';

  // Merged indicator for completed tasks
  const isMerged = t.status === 'completed' && (t.result || '').includes('Merged');
  const mergedLabel = isMerged
    ? '<span class="task-merged-label">Merged</span>'
    : '';

  const expanded = State.selectedTask === t.id;
  const descHtml = expanded
    ? `<div class="task-desc expanded markdown-body">${md(t.description)}</div>`
    : `<div class="task-desc">${esc(t.description).substring(0, 120)}${(t.description || '').length > 120 ? '...' : ''}</div>`;

  const hasBlockers = isBlocked && t.status === 'pending';

  // Result preview for completed/failed tasks
  const execLog = t.execution_log || '';
  const hasOutput = execLog.length > 0 && (t.status === 'completed' || t.status === 'failed');
  const resultPreviewHtml = hasOutput
    ? (expanded
      ? ''  // Full output shown in terminal pane when expanded
      : `<div class="task-result-preview">${esc(execLog.substring(execLog.length - 200).trim())}${execLog.length > 200 ? '...' : ''}</div>`)
    : '';

  // Worktree path (shown under description when expanded)
  const wtPathHtml = expanded && hasWorktree
    ? `<div class="task-wt-path" onclick="event.stopPropagation(); openWorktreeTerminal(${t.id})" title="Open in ${State.platform.terminal}">${esc(t.worktree_path)}</div>`
    : '';

  // Diff summary (loaded async, stored in State.taskDiffs)
  const diff = State.taskDiffs[t.id];
  const diffHtml = expanded && diff
    ? `<div class="task-diff-summary">${diff.files_changed} file${diff.files_changed !== 1 ? 's' : ''} changed, <span class="diff-ins">+${diff.insertions}</span> <span class="diff-del">-${diff.deletions}</span></div>`
    : '';

  // Merge conflict section (for merge_pending status)
  let mergeSection = '';
  if (t.status === 'merge_pending') {
    let conflicts = [];
    try { conflicts = JSON.parse(t.merge_conflict_files || '[]'); } catch { conflicts = []; }
    mergeSection = `
      <div class="task-merge-section">
        <div class="task-merge-actions">
          <button class="btn sm green" onclick="event.stopPropagation(); mergeTask(${t.id}, 'merge')">Merge</button>
          <button class="btn sm" onclick="event.stopPropagation(); mergeTask(${t.id}, 'rebase')">Rebase</button>
          <button class="btn sm danger" onclick="event.stopPropagation(); mergeTask(${t.id}, 'abort')">Abort</button>
        </div>
        ${conflicts.length > 0 ? `<div class="task-conflict-files"><div class="task-conflict-header">Conflicts:</div>${conflicts.map(f => `<div class="task-conflict-file">${esc(f)}</div>`).join('')}</div>` : ''}
      </div>
    `;
  }

  return `
    <div class="task-item ${active} ${dimmed} ${highlighted} ${blockedClass}" onclick="selectTask(${t.id})">
      <div class="task-header">
        <span class="task-status ${t.status}">${t.status === 'merge_pending' ? 'merge' : t.status}${t.status === 'running' && State.taskModes[t.id] ? ' (' + State.taskModes[t.id] + ')' : ''}</span>
        ${worktreeBadge}
        <span class="task-title">${esc(t.title)}</span>
        ${mergedLabel}
        ${wishLabel}
      </div>
      ${blockerLabel}
      ${descHtml}
      ${resultPreviewHtml}
      ${wtPathHtml}
      ${diffHtml}
      ${mergeSection}
      <div class="task-timestamps">
        ${t.status === 'running' && t.started_at ? `<span>Started: ${formatTaskTime(t.started_at)}</span>` : ''}
        ${t.status === 'completed' && t.completed_at ? `<span>Completed: ${formatTaskTime(t.completed_at)}</span>` : ''}
        ${t.status === 'merge_pending' && t.completed_at ? `<span>Ready: ${formatTaskTime(t.completed_at)}</span>` : ''}
        ${t.status === 'failed' && t.completed_at ? `<span>Failed: ${formatTaskTime(t.completed_at)}</span>` : ''}
        ${t.status === 'pending' ? `<span>Created: ${formatTaskTime(t.created_at)}</span>` : ''}
        ${t.updated_at && t.updated_at !== t.created_at ? `<span>Updated: ${formatTaskTime(t.updated_at)}</span>` : ''}
      </div>
      <div class="task-toolbar">
        <div class="task-toolbar-left">
          ${t.status === 'pending' ? `<button class="btn sm green${hasBlockers ? ' btn-blocked' : ''}" onclick="event.stopPropagation(); runTaskInteractive(${t.id})" title="${hasBlockers ? 'Blocked' : 'Run in Claude session (with worktree)'}">Run</button>` : ''}
          ${t.status === 'pending' ? `<button class="btn sm green${hasBlockers ? ' btn-blocked' : ''}" style="opacity:0.7" onclick="event.stopPropagation(); runTaskSilent(${t.id})" title="${hasBlockers ? 'Blocked' : 'Silent mode (with worktree)'}">Silent</button>` : ''}
          ${t.status === 'pending' ? `<button class="btn sm${hasBlockers ? ' btn-blocked' : ''}" style="opacity:0.6" onclick="event.stopPropagation(); runTaskInteractiveNoWt(${t.id})" title="${hasBlockers ? 'Blocked' : 'Run directly in project dir (no worktree)'}">Run*</button>` : ''}
          ${t.status === 'pending' ? `<button class="btn sm green${hasBlockers ? ' btn-blocked' : ''}" style="opacity:0.6" onclick="event.stopPropagation(); runTaskSilentNoWt(${t.id})" title="${hasBlockers ? 'Blocked' : 'Silent in project dir (no worktree)'}">Silent*</button>` : ''}
          ${hasWorktree && expanded ? `<button class="btn sm" onclick="event.stopPropagation(); openWorktreeTerminal(${t.id})" title="Open worktree in ${State.platform.terminal}">Terminal</button>` : ''}
          ${hasWorktree && expanded && (t.status === 'completed' || t.status === 'merge_pending') ? `<button class="btn sm" onclick="event.stopPropagation(); runAiReview(${t.id})" title="Run AI code review">Review</button>` : ''}
        </div>
        <div class="task-toolbar-right">
          <button class="btn sm" onclick="event.stopPropagation(); copyTaskText(${t.id})" title="Copy task description">Copy</button>
          ${t.status === 'pending' || t.status === 'running' ? `<button class="btn sm" style="color:var(--green);border-color:var(--green)" onclick="event.stopPropagation(); completeTask(${t.id})" title="Mark as done">Done</button>` : ''}
          ${t.status === 'completed' ? `<button class="btn sm" onclick="event.stopPropagation(); reopenTask(${t.id})" title="Reopen task">Reopen</button>` : ''}
          ${t.status === 'pending' ? `<button class="btn sm" onclick="event.stopPropagation(); editTask(${t.id})">Edit</button>` : ''}
          <button class="btn sm danger" onclick="event.stopPropagation(); removeTask(${t.id})">×</button>
        </div>
      </div>
    </div>
  `;
}

function renderNestedTasks(parentId, nestedUnder, hasWishFilter, linkedTaskIds) {
  if (!nestedUnder[parentId] || nestedUnder[parentId].length === 0) return '';
  let html = '<div class="task-dep-group">';
  for (const { task: nt, blockerInfo } of nestedUnder[parentId]) {
    const nActive = State.selectedTask === nt.id ? 'active' : '';
    const nLinked = hasWishFilter && linkedTaskIds.includes(nt.id);
    const nDimmed = hasWishFilter && !nLinked ? 'task-dimmed' : '';
    const nHighlighted = nLinked ? 'task-wish-linked' : '';
    html += renderTaskItem(nt, { active: nActive, dimmed: nDimmed, highlighted: nHighlighted, nested: true, blockerInfo });
    // Recurse: this nested task may also have tasks nested under it
    html += renderNestedTasks(nt.id, nestedUnder, hasWishFilter, linkedTaskIds);
  }
  html += '</div>';
  return html;
}

function renderTasks() {
  const list = el('taskList');

  if (State.loading) {
    list.innerHTML = Array.from({length: 3}, () =>
      '<div class="skeleton-task skeleton"><div class="skeleton skeleton-line w80"></div><div class="skeleton skeleton-line w60"></div></div>'
    ).join('');
    return;
  }

  if (State.taskView === 'board') {
    renderTasksBoard();
    return;
  }

  if (State.tasks.length === 0) {
    list.innerHTML = '<div class="empty-msg">No tasks yet.<br>Add wishes and click Plan.</div>';
    el('taskCount').textContent = '';
    return;
  }

  const pending = State.tasks.filter(t => t.status === 'pending' && t.type !== 'plan').length;
  const running = State.tasks.filter(t => t.status === 'running' && t.type !== 'plan').length;
  const merging = State.tasks.filter(t => t.status === 'merge_pending' && t.type !== 'plan').length;
  el('taskCount').textContent = `(${pending}p${running ? ' ' + running + 'r' : ''}${merging ? ' ' + merging + 'm' : ''})`;

  // Sort tasks: running > merge_pending > pending > completed > failed
  const sorted = [...State.tasks].sort((a, b) => {
    const oa = TASK_STATUS_ORDER[a.status] ?? 5;
    const ob = TASK_STATUS_ORDER[b.status] ?? 5;
    if (oa !== ob) return oa - ob;
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

  // Build dependency tree: nest blocked tasks under their blockers
  const taskById = {};
  for (const t of State.tasks) taskById[t.id] = t;

  // Map: blockerTaskId -> [{task, blockerInfo}]
  const nestedUnder = {};
  const nestedTaskIds = new Set();

  for (const t of sorted) {
    if (t.status !== 'pending' || t.type === 'plan') continue;
    const activeBlockers = getTaskActiveBlockers(t.id);
    if (activeBlockers.length === 0) continue;
    // Nest under the first blocker (running preferred, then pending)
    const blocker = activeBlockers.find(b => b.blockerStatus === 'running' && taskById[b.blockerTaskId])
      || activeBlockers.find(b => taskById[b.blockerTaskId]);
    if (blocker) {
      const bid = blocker.blockerTaskId;
      if (!nestedUnder[bid]) nestedUnder[bid] = [];
      nestedUnder[bid].push({ task: t, blockerInfo: blocker });
      nestedTaskIds.add(t.id);
    }
  }

  let html = '';
  for (const t of sorted) {
    // Skip tasks that are nested under a running blocker
    if (nestedTaskIds.has(t.id)) continue;

    const active = State.selectedTask === t.id ? 'active' : '';
    const isLinked = hasWishFilter && linkedTaskIds.includes(t.id);
    const dimmed = hasWishFilter && !isLinked ? 'task-dimmed' : '';
    const highlighted = isLinked ? 'task-wish-linked' : '';

    html += renderTaskItem(t, { active, dimmed, highlighted, nested: false });

    // Render nested blocked tasks (recursive for chains)
    html += renderNestedTasks(t.id, nestedUnder, hasWishFilter, linkedTaskIds);
  }

  list.innerHTML = html;
}

// ─── Kanban Board View ──────────────────────────

function renderTasksBoard() {
  const list = el('taskList');
  if (State.tasks.length === 0) {
    list.innerHTML = '<div class="empty-msg">No tasks yet.<br>Add wishes and click Plan.</div>';
    el('taskCount').textContent = '';
    return;
  }

  const pending = State.tasks.filter(t => t.status === 'pending' && t.type !== 'plan').length;
  const running = State.tasks.filter(t => t.status === 'running' && t.type !== 'plan').length;
  const merging = State.tasks.filter(t => t.status === 'merge_pending' && t.type !== 'plan').length;
  el('taskCount').textContent = `(${pending}p${running ? ' ' + running + 'r' : ''}${merging ? ' ' + merging + 'm' : ''})`;

  const columns = [
    { key: 'pending', label: 'Pending', droppable: true },
    { key: 'running', label: 'Running', droppable: false },
    { key: 'merge_pending', label: 'Merge', droppable: false },
    { key: 'completed', label: 'Done', droppable: true },
    { key: 'failed', label: 'Failed', droppable: true },
  ];

  const grouped = {};
  for (const col of columns) grouped[col.key] = [];
  for (const t of State.tasks) {
    if (t.type === 'plan') continue;
    if (grouped[t.status]) grouped[t.status].push(t);
  }

  let html = '<div class="kanban-board">';
  for (const col of columns) {
    const tasks = grouped[col.key];
    const dropAttrs = col.droppable
      ? `ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="this.classList.remove('drag-over');dropTask(event,'${col.key}')"`
      : '';
    html += `<div class="kanban-column" ${dropAttrs}>`;
    html += `<div class="kanban-col-header"><span>${col.label}</span><span class="kanban-count">${tasks.length}</span></div>`;
    html += '<div class="kanban-col-body">';
    for (const t of tasks) {
      const activeClass = State.selectedTask === t.id ? ' active' : '';
      html += `<div class="kanban-card${activeClass}" draggable="true" ondragstart="dragTask(event,${t.id})" onclick="selectTask(${t.id})">`;
      html += `<div class="kanban-card-title">${esc(t.title)}</div>`;
      if (t.description) {
        html += `<div class="kanban-card-desc">${esc(t.description).substring(0, 80)}</div>`;
      }
      html += '</div>';
    }
    html += '</div></div>';
  }
  html += '</div>';
  list.innerHTML = html;
}

// ─── Column 4: Terminal ──────────────────────────

/** Linkify URLs and file paths in terminal output by walking DOM text nodes */
function linkifyTerminalDOM(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const text = node.textContent;
    // Match URLs or file paths with line numbers
    const re = /(https?:\/\/[^\s<>"')\]]+)|((?:\/[\w./-]+\.[\w]+)(?::\d+(?::\d+)?)?)|(\.\/[\w./-]+\.[\w]+(?::\d+(?::\d+)?)?)/g;
    let match;
    const parts = [];
    let lastIdx = 0;

    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push({ type: 'text', value: text.slice(lastIdx, match.index) });
      }
      if (match[1]) {
        parts.push({ type: 'url', value: match[1] });
      } else if (match[2] || match[3]) {
        const path = match[2] || match[3];
        // Filter out false positives (too short or common non-paths)
        if (path.length > 4 && path.includes('/')) {
          parts.push({ type: 'path', value: path });
        } else {
          parts.push({ type: 'text', value: path });
        }
      }
      lastIdx = match.index + match[0].length;
    }

    if (parts.length === 0) continue;
    if (lastIdx < text.length) {
      parts.push({ type: 'text', value: text.slice(lastIdx) });
    }

    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (p.type === 'url') {
        const a = document.createElement('a');
        a.className = 'term-link';
        a.href = p.value;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = p.value;
        frag.appendChild(a);
      } else if (p.type === 'path') {
        const span = document.createElement('span');
        span.className = 'term-file-link';
        span.textContent = p.value;
        span.title = 'Click to copy';
        span.onclick = () => copyFilePath(p.value);
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(p.value));
      }
    }
    node.parentNode.replaceChild(frag, node);
  }
}

/** Copy a file path to clipboard and show toast */
function copyFilePath(filePath) {
  const clean = filePath.replace(/:\d+(:\d+)?$/, '');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(clean).then(() => showToast('Copied: ' + clean, 'info', { duration: 2000 })).catch(() => {
      showToast('Copy failed', 'error');
    });
  } else {
    showToast(clean, 'info', { duration: 3000 });
  }
}

/** Set terminal body content: use innerHTML with ANSI rendering for live output, textContent for static messages */
function setTermContent(text, isAnsi) {
  const body = el('termBody');
  if (isAnsi) {
    body.innerHTML = ansiHtml(text);
  } else {
    body.textContent = text;
  }
  linkifyTerminalDOM(body);
}

function renderTerminal() {
  if (!State.selected || !State.sessions[State.selected]) {
    setTermContent('Select a project to see output...', false);
    el('termTitle').textContent = 'Terminal';
    el('termDot').className = 'status-dot';
    return;
  }

  // If a task is selected, show task-specific content
  if (State.selectedTask) {
    const t = State.tasks.find(t => t.id === State.selectedTask);
    if (t) {
      const isPlan = t.type === 'plan';
      const titlePrefix = isPlan ? 'Plan' : 'Task';
      el('termTitle').textContent = `${titlePrefix}: ${t.title}`;
      el('termDot').className = `status-dot ${t.status}`;

      // Don't overwrite if pollTaskOutput is managing content (running tasks)
      // or if live mode is off (user is reading)
      if (t.status !== 'running' && State.liveMode) {
        if (isPlan) {
          const content = t.result || t.description || '(no planning output)';
          setTermContent(content, false);
        } else if (t.status === 'completed' || t.status === 'failed') {
          // For completed/failed tasks, show execution_log; fetchTaskTerminal will replace with full output
          const content = t.execution_log || t.result || t.description || (t.status === 'completed' ? 'Task completed.' : 'Task failed.');
          setTermContent(content, false);
        } else {
          const content = t.execution_log || t.result || t.description || '(no output)';
          setTermContent(content, false);
        }
      }
    }
    return;
  }

  if (!State.liveMode) return;

  const s = State.sessions[State.selected];
  el('termTitle').textContent = State.selected;
  el('termDot').className = `status-dot ${s.status}`;

  if (s.paneBuffer) {
    setTermContent(s.paneBuffer, true);
  } else if (s.lastOutput) {
    setTermContent(s.lastOutput, true);
  } else if (s.status === 'offline') {
    setTermContent(`Session offline: ${s.detail || 'tmux pane not available'}.\nCheck that the tmux session exists and the pane target is correct.`, false);
    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn restart-terminal-btn';
    restartBtn.textContent = 'Restart Terminal';
    restartBtn.onclick = async () => {
      restartBtn.disabled = true;
      restartBtn.textContent = 'Restarting...';
      try {
        const r = await fetch(`/api/sessions/${encodeURIComponent(State.selected)}/recreate-tmux`, { method: 'POST' });
        const data = await r.json();
        if (!r.ok) restartBtn.textContent = data.error || 'Failed';
      } catch (e) {
        restartBtn.textContent = 'Error: ' + e.message;
        restartBtn.disabled = false;
      }
    };
    el('termBody').appendChild(restartBtn);
  } else if (s.status === 'working') {
    setTermContent(`Claude is working... (${s.detail || 'processing'})\nWaiting for terminal output to appear.`, false);
  } else {
    setTermContent('(no output yet)', false);
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
