type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = (process.env.LOG_LEVEL as Level) || 'info';

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  if (ORDER[level] < ORDER[minLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  if (extra === undefined) out(line);
  else out(line, typeof extra === 'string' ? extra : JSON.stringify(extra));
}

export function logger(scope: string) {
  return {
    debug: (m: string, x?: unknown) => emit('debug', scope, m, x),
    info: (m: string, x?: unknown) => emit('info', scope, m, x),
    warn: (m: string, x?: unknown) => emit('warn', scope, m, x),
    error: (m: string, x?: unknown) => emit('error', scope, m, x),
  };
}
export type Logger = ReturnType<typeof logger>;
