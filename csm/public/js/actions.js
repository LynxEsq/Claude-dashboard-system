/**
 * User actions: selection, CRUD, execution
 */

// ─── Selection ───────────────────────────────────

function selectProject(name) {
  State.selected = name;
  State.selectedTask = null;
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
      el('planBtn').disabled = true;
      el('planBtn').textContent = 'Planning...';
      pollPlanStatus();
    } else {
      State.planningSession = null;
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
      el('termBody').textContent = t.execution_log || 'Running...';
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

    if (status.preview) {
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

// ─── Data Loading ────────────────────────────────

async function loadWishes() {
  if (!State.selected) return;
  State.wishes = await API.getWishes(State.selected);
  renderWishes();
}

async function loadTasks() {
  if (!State.selected) return;
  State.tasks = await API.getTasks(State.selected);
  renderTasks();
}

// ─── Wishes CRUD ─────────────────────────────────

async function addWish() {
  if (!State.selected) return;
  const text = el('wishText').value.trim();
  if (!text) return;
  await API.addWish(State.selected, text);
  el('wishText').value = '';
  loadWishes();
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
  await API.updateWish(id, content);
  State.editingWish = null;
  loadWishes();
}

async function removeWish(id) {
  if (!confirm('Delete this wish?')) return;
  await API.deleteWish(id);
  loadWishes();
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
  await API.updateTask(id, { title, description: desc });
  State.editingTask = null;
  loadTasks();
}

async function removeTask(id) {
  if (!confirm('Delete this task?')) return;
  await API.deleteTask(id);
  loadTasks();
}

async function completeTask(id) {
  await API.updateTask(id, { status: 'completed' });
  loadTasks();
}

async function reopenTask(id) {
  await API.updateTask(id, { status: 'pending' });
  loadTasks();
}

async function addManualTask() {
  if (!State.selected) return;
  const title = el('t-title').value.trim();
  const desc = el('t-desc').value.trim();
  const priority = parseInt(el('t-priority').value) || 5;
  if (!title) return alert('Title is required');

  await API.addTask(State.selected, { title, description: desc, priority });
  hideModal('task');
  el('t-title').value = '';
  el('t-desc').value = '';
  el('t-priority').value = '5';
  loadTasks();
}

// ─── Pipeline Actions ────────────────────────────

async function planFromWishes() {
  if (!State.selected) return;
  el('planBtn').disabled = true;
  el('planBtn').textContent = 'Starting...';

  try {
    const result = await API.plan(State.selected);
    if (!result.planned && result.status !== 'running') {
      alert(result.reason || 'Nothing to plan');
      el('planBtn').disabled = false;
      el('planBtn').textContent = 'Plan';
      return;
    }

    // Show planning session info
    State.planningSession = result.tmuxSession;
    el('planBtn').innerHTML = 'Planning... <span style="font-size:9px;opacity:0.7">click Terminal to watch</span>';

    // Poll for completion
    pollPlanStatus();
  } catch (err) {
    alert('Planning error: ' + err.message);
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
      alert('Planning failed: ' + (status.reason || 'Unknown error'));
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
}

function openPlanningTerminal() {
  if (State.planningSession) {
    API.openTerminal(State.selected);
  }
}

async function runTaskInteractive(taskId) {
  if (!State.selected) return;
  const result = await API.executeInteractive(State.selected, taskId);
  if (!result.started) {
    alert(result.reason || 'Cannot start');
    return;
  }
  loadTasks();
}

async function runTaskSilent(taskId) {
  if (!State.selected) return;
  const result = await API.executeSilent(State.selected, taskId);
  if (!result.started) {
    alert(result.reason || 'Cannot start');
    return;
  }
  loadTasks();
  pollTaskExec(taskId, result.tmuxSession);
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
  const result = await API.executeNext(State.selected);
  if (result.started) loadTasks();
  else alert(result.reason || 'Cannot start');
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

  const result = await API.createSession({
    name,
    projectPath: el('c-path').value.trim() || null,
    startClaude: el('c-claude').checked,
  });

  if (!result.success) return alert('Error: ' + result.error);
  hideModal('create');
  el('c-name').value = '';
  el('c-path').value = '';
}

// ─── Delete Project ──────────────────────────────

async function deleteProject(name) {
  if (!confirm(`Delete project "${name}"?\nThis will kill tmux sessions and remove all wishes/tasks.`)) return;
  await API.deleteProject(name);
  if (State.selected === name) {
    State.selected = null;
    State.wishes = [];
    State.tasks = [];
  }
  // Refresh
  const d = await API.getSessions();
  State.sessions = d;
  renderProjects();
  renderTerminal();
  el('wishList').innerHTML = '<div class="empty-msg">Select a project</div>';
  el('taskList').innerHTML = '<div class="empty-msg">Select a project</div>';
}

// ─── Live Mode ──────────────────────────────────

function toggleLive() {
  State.liveMode = el('termLive').checked;
  if (State.liveMode) {
    renderTerminal();
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

async function toggleTmuxPanel() {
  const panel = el('tmuxPanel');
  if (panel.classList.contains('visible')) {
    panel.classList.remove('visible');
    return;
  }

  const data = await API.getTmuxSessions();
  const list = el('tmuxPanelList');
  if (data.all.length === 0) {
    list.innerHTML = '<div class="empty-msg">No tmux sessions</div>';
  } else {
    list.innerHTML = data.all.map(name => {
      const isTracked = data.tracked.includes(name);
      return `
        <div class="tmux-panel-item" onclick="attachTmux('${escJs(name)}')">
          <span class="tmux-panel-name">${esc(name)}</span>
          ${isTracked ? '<span class="tmux-panel-tag">tracked</span>' : ''}
        </div>
      `;
    }).join('');
  }

  panel.classList.add('visible');
}

async function attachTmux(tmuxName) {
  el('tmuxPanel').classList.remove('visible');
  await API.openTmuxSession('_', tmuxName);
}

function toggleAlerts() {
  // TODO: alerts panel
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
    el('tmuxCount').textContent = data.all.length;
  } catch {}
}
setInterval(refreshTmuxCount, 5000);
refreshTmuxCount();

// ─── Modal Helpers ───────────────────────────────

function showModal(name) { el(`modal-${name}`).classList.add('visible'); }
function hideModal(name) { el(`modal-${name}`).classList.remove('visible'); }
