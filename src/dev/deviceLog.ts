/**
 * Dev server only. Mirrors this page's errors and XR session attempts to the
 * dev server's log, so problems that happen inside the headset can be read on
 * the computer (`npx @iwsdk/cli dev logs`). Never included in production.
 */

const client = Math.random().toString(36).slice(2, 6);
// The IWER emulator spoofs a Quest user agent and replaces navigator.xr, so
// check whether navigator.xr is the browser's own XRSystem.
const emulated = navigator.xr?.constructor?.name !== 'XRSystem';
const device = emulated ? 'emulator' : /OculusBrowser/.test(navigator.userAgent) ? 'QUEST' : 'browser';

function send(level: string, message: string): void {
  fetch('/__arcana/log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client, device, level, message: message.slice(0, 2000) }),
    keepalive: true,
  }).catch(() => {});
}

const describe = (value: unknown): string => {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'object' && value !== null) {
    const v = value as { name?: string; message?: string };
    if (v.name || v.message) return `${v.name ?? ''}: ${v.message ?? ''}`;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

for (const level of ['error', 'warn', 'info'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    const text = args.map(describe).join(' ');
    if (level !== 'info' || text.includes('[arcana]')) send(level, text);
  };
}
window.addEventListener('error', (event) => send('error', `uncaught ${event.message} at ${event.filename}:${event.lineno}`));
window.addEventListener('unhandledrejection', (event) => send('error', `unhandled rejection ${describe(event.reason)}`));

// Trace every attempt to open the headset view and how it ends.
const xr = navigator.xr as (XRSystem & { offerSession?: XRSystem['requestSession'] }) | undefined;
if (xr) {
  for (const method of ['requestSession', 'offerSession'] as const) {
    const original = xr[method]?.bind(xr);
    if (!original) continue;
    xr[method] = ((mode: XRSessionMode, init?: XRSessionInit) => {
      send('info', `${method}(${mode}) optional=${JSON.stringify(init?.optionalFeatures ?? [])} required=${JSON.stringify(init?.requiredFeatures ?? [])}`);
      return original(mode, init).then(
        (session) => {
          send('info', `${method} -> ${session ? 'session started' : 'no session'}`);
          return session;
        },
        (error: unknown) => {
          send('error', `${method} failed: ${describe(error)}`);
          throw error;
        },
      );
    }) as XRSystem['requestSession'];
  }
}

(async () => {
  const supported = async (mode: XRSessionMode) => {
    try {
      return (await xr?.isSessionSupported(mode)) ?? false;
    } catch (error) {
      return `error ${describe(error)}`;
    }
  };
  send(
    'info',
    `page loaded: secureContext=${window.isSecureContext} xr=${!!xr} ar=${await supported('immersive-ar')} vr=${await supported('immersive-vr')} ua="${navigator.userAgent}"`,
  );
})();

export {};
