/**
 * WebSocket connection and message handling
 */
let ws = null;

function handleMessage(msg) {
    switch (msg.type) {
      case 'state':
        State.sessions = msg.data;
        State.loading = false;
        renderProjects();
        loadAllTaskCounts();
        break;

      case 'update':
        State.sessions[msg.data.name] = msg.data.session;
        renderProjects();
        if (State.selected === msg.data.name) renderTerminal();
        break;

      case 'statusChange':
        renderProjects();
        break;

      case 'alerts':
        State.alerts = msg.data;
        renderAlerts();
        break;

      case 'alert':
        renderAlerts();
        break;

      case 'wishAdded':
        if (msg.data.sessionName === State.selected) loadWishes();
        break;

      case 'planStarted':
        State.planningProjects.add(msg.data.sessionName);
        // Track which wishes are being planned
        if (msg.data.sessionName === State.selected) {
          if (msg.data.wishIds) {
            State.planningWishIds = new Set(msg.data.wishIds);
            renderWishes();
          }
          // Immediately load tasks so plan card appears
          loadTasks();
        }
        renderProjects();
        break;

      case 'planFinished':
        State.planningProjects.delete(msg.data.sessionName);
        // Clear planning wish tracking
        if (msg.data.sessionName === State.selected) {
          State.planningWishIds = new Set();
          loadWishes();
          loadTasks();
        }
        renderProjects();
        break;

      case 'taskCreated':
      case 'taskStarted':
        if (msg.type === 'taskStarted' && msg.data.taskId && msg.data.mode) {
          State.taskModes[msg.data.taskId] = msg.data.mode;
        }
        if (msg.data.dependencies) {
          parseDependencies(msg.data.dependencies);
        }
        if (msg.data.sessionName === State.selected) {
          loadTasks();
        } else {
          reloadTaskCountsFor(msg.data.sessionName);
        }
        break;

      case 'planApplied':
        State.planningProjects.delete(msg.data.sessionName);
        if (msg.data.dependencies) {
          parseDependencies(msg.data.dependencies);
        }
        if (msg.data.sessionName === State.selected) {
          loadTasks();
        } else {
          reloadTaskCountsFor(msg.data.sessionName);
        }
        break;

      case 'taskMerged':
        if (msg.data.sessionName === State.selected) {
          // Clear cached diff for this task
          delete State.taskDiffs[msg.data.taskId];
          loadTasks();
          showToast(`Task #${msg.data.taskId} merged successfully`, 'success');
        } else {
          reloadTaskCountsFor(msg.data.sessionName);
        }
        break;

      case 'taskMergeConflict':
        if (msg.data.sessionName === State.selected) {
          loadTasks();
          showToast('Merge conflict — resolve or abort', 'warning');
        }
        break;

      case 'taskMergeAborted':
        if (msg.data.sessionName === State.selected) {
          delete State.taskDiffs[msg.data.taskId];
          loadTasks();
        } else {
          reloadTaskCountsFor(msg.data.sessionName);
        }
        break;
    }
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  window._ws = ws;

  ws.onopen = () => el('connDot').classList.remove('off');

  ws.onclose = () => {
    el('connDot').classList.add('off');
    setTimeout(connectWS, 3000);
  };

  ws.onmessage = (event) => {
    const raw = JSON.parse(event.data);
    const messages = Array.isArray(raw) ? raw : [raw];
    for (const msg of messages) {
      handleMessage(msg);
    }
  };
}

/**
 * Parse dependency data from WS messages and store in State.
 * @param {Object} deps - { taskId: [{blockerTaskId, blockerTitle, blockerStatus, reason}] }
 */
function parseDependencies(deps) {
  if (!deps || typeof deps !== 'object') return;
  for (const [taskId, blockers] of Object.entries(deps)) {
    if (Array.isArray(blockers) && blockers.length > 0) {
      State.taskDependencies[taskId] = blockers;
    } else {
      delete State.taskDependencies[taskId];
    }
  }
}
