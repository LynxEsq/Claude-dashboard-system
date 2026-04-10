// Safe wrapper: catches sync/async errors and returns JSON
function safe(fn) {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

function classifyError(err) {
  const msg = err.message || '';
  const code = err.code || '';

  // PipelineError — already user-friendly
  if (err.name === 'PipelineError') {
    return { status: 500, message: msg, code: err.code };
  }

  // Network errors
  if (code === 'ECONNRESET' || msg.includes('ECONNRESET')) {
    return {
      status: 502, code: 'ECONNRESET',
      message: 'Соединение с API было сброшено',
      hint: 'Проверьте подключение к интернету и доступность API. Если проблема повторяется — возможно, API-ключ недействителен или превышен лимит запросов.',
    };
  }
  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
    return {
      status: 502, code: 'ECONNREFUSED',
      message: 'Не удалось подключиться к API',
      hint: 'API-сервер недоступен. Проверьте подключение к интернету.',
    };
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || msg.includes('ETIMEDOUT')) {
    return {
      status: 504, code: 'ETIMEDOUT',
      message: 'Превышено время ожидания ответа от API',
      hint: 'Попробуйте повторить операцию позже.',
    };
  }
  if (code === 'ENOTFOUND' || msg.includes('ENOTFOUND')) {
    return {
      status: 502, code: 'ENOTFOUND',
      message: 'DNS: не удалось найти сервер API',
      hint: 'Проверьте подключение к интернету и DNS-настройки.',
    };
  }

  // Claude CLI not found
  if (msg.includes('claude') && (msg.includes('not found') || msg.includes('ENOENT'))) {
    return {
      status: 500, code: 'CLAUDE_NOT_FOUND',
      message: 'Claude CLI не найден',
      hint: 'Установите: npm install -g @anthropic-ai/claude-code',
    };
  }

  // tmux errors
  if (msg.includes('tmux') && (msg.includes('no server') || msg.includes('not found'))) {
    return {
      status: 500, code: 'TMUX_ERROR',
      message: 'tmux не доступен',
      hint: 'Убедитесь, что tmux запущен: tmux new-session -d',
    };
  }

  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('Too Many Requests')) {
    return {
      status: 429, code: 'RATE_LIMITED',
      message: 'Превышен лимит запросов к API',
      hint: 'Подождите несколько минут и попробуйте снова.',
    };
  }

  // Default
  return {
    status: 500, code: 'INTERNAL_ERROR',
    message: msg || 'Внутренняя ошибка сервера',
  };
}

function errorHandler(err, req, res, _next) {
  console.error(`[API Error] ${req.method} ${req.path}:`, err.message);

  const classified = classifyError(err);
  res.status(classified.status).json({
    error: classified.message,
    code: classified.code,
    hint: classified.hint || null,
  });
}

module.exports = { safe, classifyError, errorHandler };
