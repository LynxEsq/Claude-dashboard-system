/**
 * User actions: selection, CRUD, execution
 */

// ─── Selection ───────────────────────────────────

function selectProject(name) {
  State.selected = name;
  State.selectedTask = null;
  State.selectedWish = null;
  State.editingWish = null;
  State.editingTask = null;
  renderProjects();
  renderTerminal();

  el('addWishBtn').disabled = false;
  el('planBtn').disabled = false;
  el('execBtn').disabled = false;
  el('addTaskBtn').disabled = false;
  el('wishHint').textContent = `Adding to: ${name}`;

  loadWishes();
  loadTasks();
  checkPlanStatus();
}

async function checkPlanStatus() {
  if (!State.selected) return;
  try {
    const status = await API.planStatus(State.selected);
    if (status.status === 'running') {
      State.planningSession = status.tmuxSession;
      State.planningProjects.add(State.selected);
      renderProjects();
      el('planBtn').disabled = true;
      el('planBtn').textContent = 'Planning...';
      pollPlanStatus();
    } else {
      State.planningSession = null;
      State.planningProjects.delete(State.selected);
    }
  } catch {}
}

function selectTask(id) {
  // Deselect if clicking same task
  if (State.selectedTask === id) {
    State.selectedTask = null;
    renderTasks();
    renderTerminal();
    return;
  }

  State.selectedTask = id;
  renderTasks();

  const t = State.tasks.find(t => t.id === id);
  if (t) {
    el('termTitle').textContent = `Task: ${t.title}`;
    el('termDot').className = `status-dot ${t.status}`;

    if (t.status === 'running') {
      // Poll live output from task's tmux session
      // Show session's terminal output as fallback instead of bare "Running..."
      const sessionOutput = State.sessions[State.selected]?.lastOutput;
      el('termBody').textContent = t.execution_log || sessionOutput || 'Running... waiting for output';
      pollTaskOutput(id);
    } else {
      el('termBody').textContent = t.execution_log || t.description;
    }
  }
}

async function pollTaskOutput(taskId) {
  if (State.selectedTask !== taskId || !State.selected) return;

  try {
    const status = await API.taskExecStatus(State.selected, taskId);
    if (State.selectedTask !== taskId) return; // switched away

    // Only update content and scroll when live mode is on
    if (State.liveMode && status.preview) {
      el('termBody').textContent = status.preview;
      const body = el('termBody');
      body.scrollTop = body.scrollHeight;
    }

    if (status.status === 'running') {
      setTimeout(() => pollTaskOutput(taskId), 2000);
    } else {
      // Finished — reload tasks to get final status
      loadTasks();
    }
  } catch {}
}

// ─── Wish ↔ Task Links ──────────────────────────

function selectWish(wishId) {
  // Toggle off if same wish clicked
  if (State.selectedWish === wishId) {
    clearWishSelection();
    return;
  }
  State.selectedWish = wishId;
  renderWishes();
  renderTasks();
}

function clearWishSelection() {
  State.selectedWish = null;
  renderWishes();
  renderTasks();
}

function getLinkedTaskIds(wish) {
  if (!wish || !wish.task_ids) return [];
  try { return JSON.parse(wish.task_ids); } catch { return []; }
}

function getLinkedWishIds(task) {
  if (!task || !task.wish_ids) return [];
  try { return JSON.parse(task.wish_ids); } catch { return []; }
}

// ─── Data Loading ────────────────────────────────

async function loadWishes() {
  if (!State.selected) return;
  try {
    State.wishes = await API.getWishes(State.selected);
    renderWishes();
  } catch (err) { handleApiError(err, 'loadWishes'); }
}

async function loadTasks() {
  if (!State.selected) return;
  try {
    State.tasks = await API.getTasks(State.selected);
    updateTaskCountsFromTasks(State.selected, State.tasks);
    renderTasks();
    renderProjects();
  } catch (err) { handleApiError(err, 'loadTasks'); }
}

async function loadAllTaskCounts() {
  const names = Object.keys(State.sessions);
  await Promise.all(names.map(async (name) => {
    try {
      const tasks = await API.getTasks(name);
      updateTaskCountsFromTasks(name, tasks);
    } catch (e) { /* ignore */ }
  }));
  renderProjects();
}

async function reloadTaskCountsFor(name) {
  try {
    const tasks = await API.getTasks(name);
    updateTaskCountsFromTasks(name, tasks);
    renderProjects();
  } catch (e) { /* ignore */ }
}

function updateTaskCountsFromTasks(name, tasks) {
  const counts = { completed: 0, running: 0, pending: 0, failed: 0, total: tasks.length };
  for (const t of tasks) {
    if (counts[t.status] !== undefined) counts[t.status]++;
  }
  State.taskCounts[name] = counts;
}

// ─── Wishes CRUD ─────────────────────────────────

async function addWish() {
  if (!State.selected) return;
  const text = el('wishText').value.trim();
  if (!text) return;
  try {
    await API.addWish(State.selected, text);
    el('wishText').value = '';
    loadWishes();
  } catch (err) { handleApiError(err, 'addWish'); }
}

function editWish(id) {
  State.editingWish = id;
  renderWishes();
  // Focus the textarea
  setTimeout(() => {
    const ta = document.getElementById(`wish-edit-${id}`);
    if (ta) { ta.focus(); ta.selectionStart = ta.value.length; }
  }, 50);
}

function cancelEditWish() {
  State.editingWish = null;
  renderWishes();
}

async function saveWish(id) {
  const ta = document.getElementById(`wish-edit-${id}`);
  if (!ta) return;
  const content = ta.value.trim();
  if (!content) return;
  try {
    await API.updateWish(id, content);
    State.editingWish = null;
    loadWishes();
  } catch (err) { handleApiError(err, 'saveWish'); }
}

async function removeWish(id) {
  if (!confirm('Delete this wish?')) return;
  try {
    await API.deleteWish(id);
    loadWishes();
  } catch (err) { handleApiError(err, 'removeWish'); }
}

// ─── Tasks CRUD ──────────────────────────────────

function editTask(id) {
  State.editingTask = id;
  renderTasks();
  setTimeout(() => {
    const inp = document.getElementById(`task-edit-title-${id}`);
    if (inp) inp.focus();
  }, 50);
}

function cancelEditTask() {
  State.editingTask = null;
  renderTasks();
}

async function saveTask(id) {
  const title = document.getElementById(`task-edit-title-${id}`)?.value.trim();
  const desc = document.getElementById(`task-edit-desc-${id}`)?.value.trim();
  if (!title) return;
  try {
    await API.updateTask(id, { title, description: desc });
    State.editingTask = null;
    loadTasks();
  } catch (err) { handleApiError(err, 'saveTask'); }
}

async function removeTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await API.deleteTask(id);
    loadTasks();
  } catch (err) { handleApiError(err, 'removeTask'); }
}

async function completeTask(id) {
  try {
    await API.updateTask(id, { status: 'completed' });
    loadTasks();
  } catch (err) { handleApiError(err, 'completeTask'); }
}

async function reopenTask(id) {
  try {
    await API.updateTask(id, { status: 'pending' });
    loadTasks();
  } catch (err) { handleApiError(err, 'reopenTask'); }
}

async function addManualTask() {
  if (!State.selected) return;
  const title = el('t-title').value.trim();
  const desc = el('t-desc').value.trim();
  const priority = parseInt(el('t-priority').value) || 5;
  if (!title) return alert('Title is required');

  try {
    await API.addTask(State.selected, { title, description: desc, priority });
    hideModal('task');
    el('t-title').value = '';
    el('t-desc').value = '';
    el('t-priority').value = '5';
    loadTasks();
  } catch (err) { handleApiError(err, 'addManualTask'); }
}

// ─── Pipeline Actions ────────────────────────────

async function planFromWishes() {
  if (!State.selected) return;
  el('planBtn').disabled = true;
  el('planBtn').textContent = 'Starting...';

  try {
    const result = await API.plan(State.selected);
    if (!result.planned && result.status !== 'running') {
      showToast(result.reason || 'Нечего планировать — добавьте wishes', 'info');
      el('planBtn').disabled = false;
      el('planBtn').textContent = 'Plan';
      return;
    }

    // Show planning session info
    State.planningSession = result.tmuxSession;
    State.planningProjects.add(State.selected);
    renderProjects();
    el('planBtn').innerHTML = 'Planning... <span style="font-size:9px;opacity:0.7">click Terminal to watch</span>';

    // Poll for completion
    pollPlanStatus();
  } catch (err) {
    handleApiError(err, 'planFromWishes');
    el('planBtn').disabled = false;
    el('planBtn').textContent = 'Plan';
  }
}

async function pollPlanStatus() {
  if (!State.selected) return;

  try {
    const status = await API.planStatus(State.selected);

    if (status.status === 'running') {
      const secs = Math.round((status.elapsed || 0) / 1000);
      el('planBtn').textContent = `Planning... ${secs}s`;
      setTimeout(pollPlanStatus, 2000);
      return;
    }

    if (status.status === 'done') {
      loadWishes();
      loadTasks();
      el('planBtn').disabled = false;
      el('planBtn').textContent = `Plan (${status.count || 0} tasks created)`;
      setTimeout(() => { el('planBtn').textContent = 'Plan'; }, 3000);
    } else if (status.status === 'error') {
      showToast('Планирование не удалось: ' + (status.reason || 'Неизвестная ошибка'), 'error');
      el('planBtn').disabled = false;
      el('planBtn').textContent = 'Plan';
    } else {
      // idle — planning finished or was never started
      el('planBtn').disabled = false;
      el('planBtn').textContent = 'Plan';
    }
  } catch (err) {
    el('planBtn').disabled = false;
    el('planBtn').textContent = 'Plan';
  }

  State.planningSession = null;
  if (State.selected) State.planningProjects.delete(State.selected);
  renderProjects();
}

function openPlanningTerminal() {
  if (State.planningSession) {
    API.openTerminal(State.selected);
  }
}

async function runTaskInteractive(taskId) {
  if (!State.selected) return;
  try {
    const result = await API.executeInteractive(State.selected, taskId);
    if (!result.started) {
      showToast(result.reason || 'Не удалось запустить задачу', 'warning');
      return;
    }
    loadTasks();
  } catch (err) { handleApiError(err, 'runTaskInteractive'); }
}

async function runTaskSilent(taskId) {
  if (!State.selected) return;
  try {
    const result = await API.executeSilent(State.selected, taskId);
    if (!result.started) {
      showToast(result.reason || 'Не удалось запустить задачу', 'warning');
      return;
    }
    loadTasks();
    pollTaskExec(taskId, result.tmuxSession);
  } catch (err) { handleApiError(err, 'runTaskSilent'); }
}

async function pollTaskExec(taskId, tmuxSession) {
  if (!State.selected) return;
  try {
    const status = await API.taskExecStatus(State.selected, taskId);
    if (status.status === 'running') {
      setTimeout(() => pollTaskExec(taskId, tmuxSession), 3000);
      return;
    }
    // Done or error
    loadTasks();
  } catch {}
}

async function executeNext() {
  if (!State.selected) return;
  try {
    const result = await API.executeNext(State.selected);
    if (result.started) loadTasks();
    else showToast(result.reason || 'Нет задач для выполнения', 'info');
  } catch (err) { handleApiError(err, 'executeNext'); }
}

// ─── Terminal Actions ────────────────────────────

async function sendInput() {
  if (!State.selected) return;
  const input = el('termInput');
  if (!input.value.trim()) return;
  await API.sendInput(State.selected, input.value);
  input.value = '';
}

async function focusSelected() {
  if (!State.selected) return;
  await API.focusSession(State.selected);
}

async function restartSelected() {
  if (!State.selected) return;
  if (!confirm(`Restart Claude in "${State.selected}"?`)) return;
  await API.restartSession(State.selected);
}

async function openTerminal() {
  if (!State.selected) return;

  // Priority: selected task > planning session > project session
  if (State.selectedTask) {
    // Check if this task has a running tmux session
    try {
      const status = await API.taskExecStatus(State.selected, State.selectedTask);
      if (status.tmuxSession) {
        await fetch(`/api/sessions/${encodeURIComponent(State.selected)}/terminal?tmux=${encodeURIComponent(status.tmuxSession)}`, {
          method: 'POST'
        });
        return;
      }
    } catch {}
  }

  if (State.planningSession) {
    await fetch(`/api/sessions/${encodeURIComponent(State.selected)}/terminal?tmux=${encodeURIComponent(State.planningSession)}`, {
      method: 'POST'
    });
  } else {
    await API.openTerminal(State.selected);
  }
}

async function sendRawKeys(keys) {
  if (!State.selected) return;
  await API.sendKeys(State.selected, keys);
  // Refresh terminal output after a short delay
  setTimeout(() => {
    API.getSessions().then(d => { State.sessions = d; renderTerminal(); });
  }, 500);
}

function handleTermKey(event) {
  if (event.key === 'Enter') {
    sendInput();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    sendRawKeys('Up');
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    sendRawKeys('Down');
  } else if (event.key === 'c' && event.ctrlKey) {
    event.preventDefault();
    sendRawKeys('C-c');
  } else if (event.key === 'd' && event.ctrlKey) {
    event.preventDefault();
    sendRawKeys('C-d');
  } else if (event.key === 'Escape') {
    event.preventDefault();
    sendRawKeys('Escape');
  }
}

// ─── Project Creation ────────────────────────────

async function createProject() {
  const name = el('c-name').value.trim();
  if (!name) return alert('Name is required');

  try {
    const result = await API.createSession({
      name,
      projectPath: el('c-path').value.trim() || null,
      startClaude: el('c-claude').checked,
    });

    if (!result.success) {
      showToast(result.error || 'Не удалось создать проект', 'error');
      return;
    }
    hideModal('create');
    el('c-name').value = '';
    el('c-path').value = '';
  } catch (err) { handleApiError(err, 'createProject'); }
}

// ─── Delete Project ──────────────────────────────

async function deleteProject(name) {
  if (!confirm(`Delete project "${name}"?\nThis will kill tmux sessions and remove all wishes/tasks.`)) return;
  try {
    await API.deleteProject(name);
    if (State.selected === name) {
      State.selected = null;
      State.wishes = [];
      State.tasks = [];
    }
    const d = await API.getSessions();
    State.sessions = d;
    renderProjects();
    renderTerminal();
    el('wishList').innerHTML = '<div class="empty-msg">Select a project</div>';
    el('taskList').innerHTML = '<div class="empty-msg">Select a project</div>';
  } catch (err) { handleApiError(err, 'deleteProject'); }
}

// ─── Live Mode ──────────────────────────────────

function toggleLive() {
  State.liveMode = el('termLive').checked;
  const termCol = document.querySelector('.col-terminal');
  if (State.liveMode) {
    // Re-enable: refresh content and scroll to bottom
    if (termCol) termCol.classList.remove('live-paused');
    if (State.selectedTask) {
      // Re-render selected task output
      selectTask(State.selectedTask);
    } else {
      renderTerminal();
    }
  } else {
    // Paused: add visual indicator
    if (termCol) termCol.classList.add('live-paused');
  }
}

// ─── Permissions ─────────────────────────────────

const PERM_PRESETS = [
  { label: 'Read files', perm: 'Read' },
  { label: 'Edit files', perm: 'Edit' },
  { label: 'Write files', perm: 'Write' },
  { label: 'Bash(*)', perm: 'Bash(*)' },
  { label: 'Bash(ls:*)', perm: 'Bash(ls:*)' },
  { label: 'Bash(git:*)', perm: 'Bash(git:*)' },
  { label: 'Bash(npm:*)', perm: 'Bash(npm:*)' },
  { label: 'Bash(node:*)', perm: 'Bash(node:*)' },
  { label: 'Bash(cat:*)', perm: 'Bash(cat:*)' },
  { label: 'Bash(find:*)', perm: 'Bash(find:*)' },
  { label: 'Bash(grep:*)', perm: 'Bash(grep:*)' },
  { label: 'Bash(python3:*)', perm: 'Bash(python3:*)' },
  { label: 'Bash(curl:*)', perm: 'Bash(curl:*)' },
  { label: 'WebSearch', perm: 'WebSearch' },
  { label: 'WebFetch(*)', perm: 'WebFetch' },
];

let currentPerms = [];

async function showPermsModal() {
  if (!State.selected) return alert('Select a project first');
  el('perms-project').textContent = State.selected;

  const data = await API.getPermissions(State.selected);
  currentPerms = data.permissions || [];

  renderPermsPresets();
  renderPermsList();
  showModal('perms');
}

function renderPermsPresets() {
  el('permsPresets').innerHTML = PERM_PRESETS.map(p => {
    const active = currentPerms.includes(p.perm);
    return `<button class="btn sm ${active ? 'primary' : ''}" onclick="togglePerm('${p.perm}')">${p.label}</button>`;
  }).join('');
}

function renderPermsList() {
  if (currentPerms.length === 0) {
    el('permsList').innerHTML = '<div class="empty-msg">No permissions set</div>';
    return;
  }
  el('permsList').innerHTML = currentPerms.map(p =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;font-size:12px;font-family:monospace;background:var(--bg);border-radius:4px;margin-bottom:2px">
      <span>${esc(p)}</span>
      <button class="btn sm danger" onclick="removePerm('${escJs(p)}')" style="padding:0 4px">&times;</button>
    </div>`
  ).join('');
}

async function togglePerm(perm) {
  if (currentPerms.includes(perm)) {
    currentPerms = currentPerms.filter(p => p !== perm);
  } else {
    currentPerms.push(perm);
  }
  await API.setPermissions(State.selected, currentPerms);
  renderPermsPresets();
  renderPermsList();
}

async function removePerm(perm) {
  currentPerms = currentPerms.filter(p => p !== perm);
  await API.setPermissions(State.selected, currentPerms);
  renderPermsPresets();
  renderPermsList();
}

async function addCustomPerm() {
  const val = el('perms-custom').value.trim();
  if (!val) return;
  if (!currentPerms.includes(val)) {
    currentPerms.push(val);
    await API.setPermissions(State.selected, currentPerms);
  }
  el('perms-custom').value = '';
  renderPermsPresets();
  renderPermsList();
}

// ─── Tmux Panel ─────────────────────────────────

const SERVICE_SESSION_RE = /^csm-(exec|plan|task)-/;
// STATUS_LABELS defined in state.js

async function toggleTmuxPanel() {
  const panel = el('tmuxPanel');
  if (panel.classList.contains('visible')) {
    panel.classList.remove('visible');
    return;
  }

  await refreshTmuxPanelContent();
  panel.classList.add('visible');
}

async function refreshTmuxPanelContent() {
  const data = await API.getTmuxSessions();
  const list = el('tmuxPanelList');

  if (data.all.length === 0) {
    list.innerHTML = '<div class="empty-msg">No tmux sessions found</div>';
    return;
  }

  const showService = el('tmuxShowService')?.checked;
  const tracked = data.tracked || [];
  const serviceSessions = (data.untracked || []).filter(n => SERVICE_SESSION_RE.test(n));
  const discoveredNonService = (data.untracked || []).filter(n => !SERVICE_SESSION_RE.test(n));

  let html = '';

  // --- Tracked section ---
  if (tracked.length > 0) {
    html += '<div class="tmux-section-header"><span>Tracked</span><span class="tmux-section-hint">monitored by CSM</span></div>';
    html += tracked.map(tmuxName => {
      const sessEntry = Object.entries(State.sessions).find(([, s]) => s.tmuxSession === tmuxName);
      const csmName = sessEntry ? sessEntry[0] : null;
      const status = sessEntry ? sessEntry[1].status : 'offline';
      const statusLabel = STATUS_LABELS[status] || status;

      return `
        <div class="tmux-panel-item">
          <div class="tmux-panel-left">
            <div class="status-dot ${status}"></div>
            <div class="tmux-panel-info">
              <span class="tmux-panel-name">${esc(csmName || tmuxName)}</span>
              ${csmName && csmName !== tmuxName ? `<span class="tmux-panel-sub">${esc(tmuxName)}</span>` : ''}
            </div>
            <span class="tmux-panel-status ${status}">${statusLabel}</span>
          </div>
          <div class="tmux-panel-actions">
            ${csmName ? `<button class="btn sm" onclick="event.stopPropagation(); selectProject('${escJs(csmName)}'); closeTmuxPanel()" title="Select in dashboard">Select</button>` : ''}
            <button class="btn sm" onclick="event.stopPropagation(); attachTmux('${escJs(tmuxName)}')" title="Open in Terminal.app">Terminal</button>
            ${csmName ? `<button class="btn sm" onclick="event.stopPropagation(); focusTmuxSession('${escJs(csmName)}')" title="Switch tmux focus">Focus</button>` : ''}
            ${csmName ? `<button class="btn sm danger" onclick="event.stopPropagation(); untrackSession('${escJs(csmName)}')" title="Stop monitoring (keeps tmux alive)">Untrack</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Discovered (untracked, non-service) section ---
  if (discoveredNonService.length > 0) {
    html += '<div class="tmux-section-header"><span>Discovered</span><span class="tmux-section-hint">not tracked by CSM</span></div>';
    html += discoveredNonService.map(name => `
      <div class="tmux-panel-item">
        <div class="tmux-panel-left">
          <div class="status-dot offline"></div>
          <div class="tmux-panel-info">
            <span class="tmux-panel-name">${esc(name)}</span>
            <span class="tmux-panel-sub">tmux session — not monitored</span>
          </div>
        </div>
        <div class="tmux-panel-actions">
          <button class="btn sm primary" onclick="event.stopPropagation(); trackTmuxSession('${escJs(name)}')" title="Start monitoring this session">Track</button>
          <button class="btn sm" onclick="event.stopPropagation(); attachTmux('${escJs(name)}')" title="Open in Terminal.app">Terminal</button>
        </div>
      </div>
    `).join('');
  }

  // --- Service sessions section (pipeline: csm-task-*, csm-plan-*, csm-exec-*) ---
  if (serviceSessions.length > 0) {
    html += `<div class="tmux-section-header tmux-section-service">
      <span>Pipeline Sessions</span>
      <span class="tmux-section-hint">${serviceSessions.length} internal</span>
      <label class="tmux-service-toggle" onclick="event.stopPropagation()">
        <input type="checkbox" id="tmuxShowService" ${showService ? 'checked' : ''} onchange="refreshTmuxPanelContent()">
        show
      </label>
      <button class="btn sm danger" onclick="event.stopPropagation(); cleanupOrphanedSessions()" title="Kill all orphaned pipeline sessions" style="margin-left:8px;font-size:11px">Cleanup</button>
    </div>`;
    if (showService) {
      html += serviceSessions.map(name => {
        const typeLabel = classifyPipelineSession(name);
        return `
        <div class="tmux-panel-item tmux-service-item">
          <div class="tmux-panel-left">
            <div class="status-dot idle" style="opacity:0.4"></div>
            <div class="tmux-panel-info">
              <span class="tmux-panel-name" style="opacity:0.7;font-size:12px">${esc(name)}</span>
              <span class="tmux-panel-sub">${esc(typeLabel)}</span>
            </div>
          </div>
          <div class="tmux-panel-actions">
            <button class="btn sm" onclick="event.stopPropagation(); attachTmux('${escJs(name)}')" title="Open in Terminal.app">Terminal</button>
            <button class="btn sm danger" onclick="event.stopPropagation(); killPipelineSession('${escJs(name)}')" title="Kill this session">Kill</button>
          </div>
        </div>
      `}).join('');
    }
  }

  if (!html) {
    html = '<div class="empty-msg">No tmux sessions found</div>';
  }

  list.innerHTML = html;
}

function closeTmuxPanel() {
  el('tmuxPanel').classList.remove('visible');
}

async function attachTmux(tmuxName) {
  closeTmuxPanel();
  await API.openTmuxSession('_', tmuxName);
}

async function focusTmuxSession(name) {
  closeTmuxPanel();
  await API.focusSession(name);
}

async function trackTmuxSession(tmuxName) {
  const sessionName = prompt(`Track "${tmuxName}" as:\n(CSM display name)`, tmuxName);
  if (!sessionName) return;
  const projectPath = prompt('Project path (optional):', '') || null;
  await API.trackSession(sessionName, tmuxName, projectPath);
  const d = await API.getSessions();
  State.sessions = d;
  renderProjects();
  refreshTmuxPanelContent();
}

async function untrackSession(name) {
  if (!confirm(`Untrack "${name}"?\nThe tmux session will keep running, but CSM will stop monitoring it.`)) return;
  await API.untrackSession(name);
  if (State.selected === name) {
    State.selected = null;
    State.wishes = [];
    State.tasks = [];
  }
  const d = await API.getSessions();
  State.sessions = d;
  renderProjects();
  renderTerminal();
  refreshTmuxPanelContent();
}

function toggleAlerts() {
  // TODO: alerts panel
}

// ─── Context Menu on Projects ────────────────────

let ctxMenuTarget = null;

function showProjectCtxMenu(e, name) {
  e.preventDefault();
  e.stopPropagation();
  ctxMenuTarget = name;

  const menu = el('projectCtxMenu');
  menu.style.top = e.clientY + 'px';
  menu.style.left = e.clientX + 'px';
  menu.classList.add('visible');
}

function hideProjectCtxMenu() {
  el('projectCtxMenu')?.classList.remove('visible');
  ctxMenuTarget = null;
}

async function ctxAction(action) {
  const name = ctxMenuTarget;
  hideProjectCtxMenu();
  if (!name) return;

  switch (action) {
    case 'select':
      selectProject(name);
      break;
    case 'focus':
      await API.focusSession(name);
      break;
    case 'terminal':
      await API.openTerminal(name);
      break;
    case 'perms':
      selectProject(name);
      setTimeout(() => showPermsModal(), 100);
      break;
    case 'untrack':
      await untrackSession(name);
      break;
    case 'delete':
      await deleteProject(name);
      break;
  }
}

document.addEventListener('click', () => hideProjectCtxMenu());
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.project-item')) hideProjectCtxMenu();
});

/**
 * Classify a pipeline session name into a human-readable type.
 * Naming convention: csm-{type}-{safeName}-{taskId}
 */
function classifyPipelineSession(name) {
  if (name.startsWith('csm-task-')) {
    const match = name.match(/^csm-task-(.+)-(\d+)$/);
    if (match) return `Interactive task #${match[2]} (${match[1]})`;
    return 'Interactive task session';
  }
  if (name.startsWith('csm-exec-')) {
    const match = name.match(/^csm-exec-(.+)-(\d+)$/);
    if (match) return `Silent execution #${match[2]} (${match[1]})`;
    return 'Silent execution session';
  }
  if (name.startsWith('csm-plan-')) {
    const match = name.match(/^csm-plan-(.+)$/);
    if (match) return `Planning session (${match[1]})`;
    return 'Planning session';
  }
  return 'Pipeline session';
}

async function killPipelineSession(tmuxName) {
  if (!confirm(`Kill pipeline session "${tmuxName}"?`)) return;
  try {
    await fetch('/api/tmux/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmuxSession: tmuxName }),
    });
    refreshTmuxPanelContent();
  } catch (e) {
    console.error('Failed to kill session:', e);
  }
}

async function cleanupOrphanedSessions() {
  if (!confirm('Kill all orphaned pipeline sessions (csm-task-*, csm-plan-*, csm-exec-*)?')) return;
  try {
    const res = await fetch('/api/tmux/cleanup-pipeline', { method: 'POST' });
    const data = await res.json();
    refreshTmuxPanelContent();
    refreshTmuxCount();
    if (data.killed > 0) {
      console.log(`Cleaned up ${data.killed} pipeline session(s)`);
    }
  } catch (e) {
    console.error('Cleanup failed:', e);
  }
}

// Close tmux panel on outside click
document.addEventListener('click', (e) => {
  const panel = el('tmuxPanel');
  const badge = el('tmuxCount');
  if (panel && !panel.contains(e.target) && e.target !== badge) {
    panel.classList.remove('visible');
  }
});

// Refresh tmux count periodically
async function refreshTmuxCount() {
  try {
    const data = await API.getTmuxSessions();
    const service = data.all.filter(n => SERVICE_SESSION_RE.test(n)).length;
    const count = data.all.length - service;
    el('tmuxCount').textContent = count;
    el('tmuxCount').title = `${data.tracked.length} tracked, ${data.untracked.length - service} discovered${service ? ', ' + service + ' service' : ''}`;
  } catch {}
}
setInterval(refreshTmuxCount, 5000);
refreshTmuxCount();

// ─── Modal Helpers ───────────────────────────────

function showModal(name) { el(`modal-${name}`).classList.add('visible'); }
function hideModal(name) { el(`modal-${name}`).classList.remove('visible'); }
