import { info, warn, error as logError } from "@tauri-apps/plugin-log";

function fmt(context: string, msg: string) {
  return `[${context}] ${msg}`;
}

export const logger = {
  action: (name: string, details?: Record<string, unknown>) => {
    const msg = details ? `${name} — ${JSON.stringify(details)}` : name;
    info(fmt("ACTION", msg)).catch(() => console.info(fmt("ACTION", msg)));
  },

  info: (context: string, msg: string) => {
    info(fmt(context, msg)).catch(() => console.info(fmt(context, msg)));
  },

  warn: (context: string, msg: string) => {
    warn(fmt(context, msg)).catch(() => console.warn(fmt(context, msg)));
  },

  error: (context: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logError(fmt(context, msg)).catch(() => console.error(fmt(context, msg)));
  },
};
