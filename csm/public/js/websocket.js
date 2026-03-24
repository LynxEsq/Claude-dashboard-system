/**
 * WebSocket connection and message handling
 */
let ws = null;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => el('connDot').classList.remove('off');

  ws.onclose = () => {
    el('connDot').classList.add('off');
    setTimeout(connectWS, 3000);
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'state':
        State.sessions = msg.data;
        renderProjects();
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

      case 'taskCreated':
      case 'planApplied':
      case 'taskStarted':
        if (msg.data.sessionName === State.selected) loadTasks();
        break;
    }
  };
}
