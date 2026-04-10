/**
 * Resizable column panels
 */
(function () {
  const columns = document.querySelector('.columns');
  if (!columns) return;

  const handles = document.querySelectorAll('.col-resize');
  const STORAGE_KEY = 'csm-col-widths';
  const MIN_WIDTH = 120;

  // Restore saved widths
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      if (saved.col0) columns.style.setProperty('--col0', saved.col0 + 'px');
      if (saved.col1) columns.style.setProperty('--col1', saved.col1 + 'px');
    }
  } catch {}

  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const colIdx = parseInt(handle.dataset.col);

      // Get the column element before this handle
      const cols = columns.querySelectorAll('.col');
      const col = cols[colIdx];
      if (!col) return;

      const startX = e.clientX;
      const startWidth = col.getBoundingClientRect().width;

      function onMove(e) {
        const delta = e.clientX - startX;
        const newWidth = Math.max(MIN_WIDTH, Math.round(startWidth + delta));

        if (colIdx <= 1) {
          // Fixed-width columns (Projects, Wishes)
          columns.style.setProperty(`--col${colIdx}`, newWidth + 'px');
        }
        // Columns 2,3 (Tasks, Terminal) use 1fr — resizing them would require
        // switching to pixel values which breaks responsive layout. Skip for now.
      }

      function onUp() {
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);

        // Save to localStorage
        const widths = {};
        const style = getComputedStyle(columns);
        const col0 = style.getPropertyValue('--col0');
        const col1 = style.getPropertyValue('--col1');
        if (col0) widths.col0 = parseInt(col0);
        if (col1) widths.col1 = parseInt(col1);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
})();
