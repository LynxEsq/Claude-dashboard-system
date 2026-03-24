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
    : '';

  const statusLabel = w.processed ? 'processed' : isPlanning ? '<span class="wish-planning-badge">Planning...</span>' : 'new';

  return `
    <div class="${cls}"${w.processed && taskIds.length > 0 ? ` onclick="selectWish(${w.id})"` : ''}>
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
          ${t.status === 'pending' ? `<button class="btn sm green${hasBlockers ? ' btn-blocked' : ''}" onclick="event.stopPropagation(); runTaskInteractive(${t.id})" title="${hasBlockers ? 'Blocked — blocker still running' : 'Run in Claude session'}">Run</button>` : ''}
          ${t.status === 'pending' ? `<button class="btn sm green${hasBlockers ? ' btn-blocked' : ''}" style="opacity:0.7" onclick="event.stopPropagation(); runTaskSilent(${t.id})" title="${hasBlockers ? 'Blocked — blocker still running' : 'Run with --print (silent)'}">Silent</button>` : ''}
          ${hasWorktree && expanded ? `<button class="btn sm" onclick="event.stopPropagation(); openWorktreeTerminal(${t.id})" title="Open worktree in ${State.platform.terminal}">Terminal</button>` : ''}
          ${hasWorktree && expanded && (t.status === 'completed' || t.status === 'merge_pending') ? `<button class="btn sm" onclick="event.stopPropagation(); runAiReview(${t.id})" title="Run AI code review">Review</button>` : ''}
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

  // Build dependency tree: find pending tasks blocked by running tasks
  const taskById = {};
  for (const t of State.tasks) taskById[t.id] = t;

  // Map: runningTaskId -> [pending tasks blocked by it]
  const nestedUnder = {};  // blockerTaskId -> [{task, blockerInfo}]
  const nestedTaskIds = new Set();

  for (const t of sorted) {
    if (t.status !== 'pending' || t.type === 'plan') continue;
    const activeBlockers = getTaskActiveBlockers(t.id);
    // Find the first running blocker to nest under
    const runningBlocker = activeBlockers.find(b => b.blockerStatus === 'running' && taskById[b.blockerTaskId]);
    if (runningBlocker) {
      const bid = runningBlocker.blockerTaskId;
      if (!nestedUnder[bid]) nestedUnder[bid] = [];
      nestedUnder[bid].push({ task: t, blockerInfo: runningBlocker });
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

    // Render nested blocked tasks under this running task
    if (nestedUnder[t.id] && nestedUnder[t.id].length > 0) {
      html += '<div class="task-dep-group">';
      for (const { task: nt, blockerInfo } of nestedUnder[t.id]) {
        const nActive = State.selectedTask === nt.id ? 'active' : '';
        const nLinked = hasWishFilter && linkedTaskIds.includes(nt.id);
        const nDimmed = hasWishFilter && !nLinked ? 'task-dimmed' : '';
        const nHighlighted = nLinked ? 'task-wish-linked' : '';
        html += renderTaskItem(nt, { active: nActive, dimmed: nDimmed, highlighted: nHighlighted, nested: true, blockerInfo });
      }
      html += '</div>';
    }
  }

  list.innerHTML = html;
}

// ─── Column 4: Terminal ──────────────────────────

/** Set terminal body content: use innerHTML with ANSI rendering for live output, textContent for static messages */
function setTermContent(text, isAnsi) {
  const body = el('termBody');
  if (isAnsi) {
    body.innerHTML = ansiHtml(text);
  } else {
    body.textContent = text;
  }
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
        } else if (t.tmux_status === 'ended' || (t.tmux_session_name && t.tmux_status !== 'active')) {
          setTermContent(t.execution_log || t.result || `Session ended: ${t.tmux_session_name || 'unknown'}\n\n${t.description || '(no output saved)'}`, false);
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

  if (s.lastOutput) {
    setTermContent(s.lastOutput, true);
  } else if (s.status === 'offline') {
    setTermContent(`Session offline: ${s.detail || 'tmux pane not available'}.\nCheck that the tmux session exists and the pane target is correct.`, false);
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
