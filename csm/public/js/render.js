/**
 * Rendering functions for all 4 columns
 */

function el(id) { return document.getElementById(id); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
/** Render markdown safely: escape HTML first (XSS prevention), then parse markdown */
function md(s) { return typeof marked !== 'undefined' ? marked.parse(esc(s || '')) : esc(s || ''); }
// Escape a string for safe use inside JS string literals in HTML attributes
function escJs(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

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
    return `
      <div class="project-item ${active}" onclick="selectProject('${escJs(name)}')">
        <div class="status-dot ${s.status}"></div>
        <div class="project-name">${esc(name)}</div>
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
    const cls = w.processed ? 'wish-item processed' : 'wish-item';
    const time = new Date(w.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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

    return `
      <div class="${cls}">
        <div class="wish-content markdown-body">${md(w.content)}</div>
        <div class="wish-meta">
          <span>${time} · ${w.processed ? 'processed' : 'new'}</span>
          <div class="wish-edit-actions">
            ${!w.processed ? `<button class="btn sm" onclick="editWish(${w.id})">Edit</button>` : ''}
            <button class="btn sm danger" onclick="removeWish(${w.id})">×</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Column 3: Tasks ─────────────────────────────

function renderTasks() {
  const list = el('taskList');
  if (State.tasks.length === 0) {
    list.innerHTML = '<div class="empty-msg">No tasks yet.<br>Add wishes and click Plan.</div>';
    el('taskCount').textContent = '';
    return;
  }

  const pending = State.tasks.filter(t => t.status === 'pending').length;
  const running = State.tasks.filter(t => t.status === 'running').length;
  el('taskCount').textContent = `(${pending}p${running ? ' ' + running + 'r' : ''})`;

  list.innerHTML = State.tasks.map(t => {
    const active = State.selectedTask === t.id ? 'active' : '';

    // Editing mode
    if (State.editingTask === t.id) {
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

    const expanded = State.selectedTask === t.id;
    const descHtml = expanded
      ? `<div class="task-desc expanded markdown-body">${md(t.description)}</div>`
      : `<div class="task-desc">${esc(t.description).substring(0, 120)}${(t.description || '').length > 120 ? '...' : ''}</div>`;

    return `
      <div class="task-item ${active}" onclick="selectTask(${t.id})">
        <div class="task-header">
          <span class="task-status ${t.status}">${t.status}</span>
          <span class="task-title">${esc(t.title)}</span>
        </div>
        ${descHtml}
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
  el('termBody').textContent = s.lastOutput || '(no output yet)';

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
