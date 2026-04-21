import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Kimi usage status extension.
 *
 * Shows a compact footer status only when the active model provider is `kimi-coding`.
 * Example:
 *   Kimi · 7d 6% 6d20h · 5h 28% 1h40m
 *
 * Auth resolution order:
 *   1. KIMI_API_KEY env var
 *   2. ~/.pi/agent/auth.json -> kimi-coding.key
 *      - literal key
 *      - env var name
 *      - shell command prefixed with !
 */
const EXT_ID = "kimi-usage";
const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");
const USAGE_URL = process.env.KIMI_CODE_BASE_URL?.trim()
  ? `${process.env.KIMI_CODE_BASE_URL.trim().replace(/\/+$/, "")}/usages`
  : "https://api.kimi.com/coding/v1/usages";
const REFRESH_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const GLOBAL_TIMER_KEY = "__pi_kimi_usage_timer__";

type AuthEntry = { type?: string; key?: string };
type AuthFile = Record<string, AuthEntry>;
type ThemeLike = { fg: (role: string, text: string) => string };
type UiLike = {
  theme: ThemeLike;
  setStatus: (key: string, value: string | undefined) => void;
  setWidget: (key: string, value: string[] | undefined) => void;
  notify: (message: string, kind?: string) => void;
};
type CtxLike = {
  hasUI?: boolean;
  ui: UiLike;
  model?: { provider?: string; id?: string };
};

type UsageResponse = {
  user?: {
    membership?: {
      level?: string;
    };
  };
  usage?: {
    limit?: string | number;
    used?: string | number;
    remaining?: string | number;
    resetTime?: string;
    reset_at?: string;
  };
  limits?: Array<{
    window?: {
      duration?: number;
      timeUnit?: string;
    };
    detail?: {
      limit?: string | number;
      used?: string | number;
      remaining?: string | number;
      resetTime?: string;
      reset_at?: string;
    };
  }>;
  parallel?: {
    limit?: string | number;
  };
  subType?: string;
};

function resolveKeyValue(raw?: string): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value.startsWith("!")) {
    try {
      const output = execSync(value.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return output || undefined;
    } catch {
      return undefined;
    }
  }
  if (/^[A-Z_][A-Z0-9_]*$/i.test(value) && process.env[value]?.trim()) {
    return process.env[value]?.trim();
  }
  return value;
}

function getApiKey(): string | undefined {
  const envKey = process.env.KIMI_API_KEY?.trim();
  if (envKey) return envKey;
  if (!existsSync(AUTH_PATH)) return undefined;
  try {
    const auth = JSON.parse(readFileSync(AUTH_PATH, "utf8")) as AuthFile;
    const kimi = auth["kimi-coding"];
    if (kimi?.type === "api_key" && typeof kimi.key === "string") {
      return resolveKeyValue(kimi.key);
    }
  } catch {
    // ignore
  }
  return undefined;
}

function toNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function pct(used?: number, limit?: number): number | undefined {
  if (used === undefined || limit === undefined || limit <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

function formatReset(reset?: string): string | undefined {
  if (!reset) return undefined;
  const at = Date.parse(reset);
  if (!Number.isFinite(at)) return undefined;
  const diff = at - Date.now();
  if (diff <= 0) return "soon";
  const mins = Math.round(diff / 60000);
  const days = Math.floor(mins / (60 * 24));
  const hours = Math.floor((mins % (60 * 24)) / 60);
  const minutes = mins % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes && days === 0) parts.push(`${minutes}m`);
  return parts.length ? parts.join("") : "soon";
}

function colorize(theme: ThemeLike, usedPct?: number): ((s: string) => string) {
  if (usedPct === undefined) return (s) => theme.fg("dim", s);
  if (usedPct >= 90) return (s) => theme.fg("warning", s);
  return (s) => theme.fg("success", s);
}

function durationLabel(duration?: number, unit?: string): string {
  if (!duration || !unit) return "window";
  const u = unit.toUpperCase();
  if (u.includes("MINUTE")) {
    if (duration % 60 === 0) return `${duration / 60}h`;
    return `${duration}m`;
  }
  if (u.includes("HOUR")) return `${duration}h`;
  if (u.includes("DAY")) return `${duration}d`;
  return `${duration}`;
}

async function fetchUsage(key: string): Promise<UsageResponse> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "User-Agent": "pi-kimi-usage-extension/1.0",
    },
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as UsageResponse;
}

export default function kimiUsageExtension(pi: ExtensionAPI) {
  let timer: NodeJS.Timeout | undefined;
  let activeProvider: string | undefined;
  let inFlight: Promise<void> | undefined;

  const clearTimer = () => {
    const globalTimer = (globalThis as Record<string, unknown>)[GLOBAL_TIMER_KEY] as NodeJS.Timeout | undefined;
    if (globalTimer) clearInterval(globalTimer);
    if (timer) clearInterval(timer);
    (globalThis as Record<string, unknown>)[GLOBAL_TIMER_KEY] = undefined;
    timer = undefined;
  };

  const clearUi = (ctx: CtxLike) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(EXT_ID, undefined);
    ctx.ui.setWidget(EXT_ID, undefined);
  };

  const isKimiSelected = (ctx: CtxLike): boolean => {
    const provider = activeProvider ?? ctx.model?.provider;
    return provider === "kimi-coding";
  };

  const render = async (ctx: CtxLike) => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      if (!isKimiSelected(ctx)) {
        clearUi(ctx);
        return;
      }
      const key = getApiKey();
      if (!key) {
        if (ctx.hasUI) {
          ctx.ui.setStatus(EXT_ID, ctx.ui.theme.fg("warning", "Kimi: no API key"));
        }
        return;
      }

      try {
        const data = await fetchUsage(key);
        if (!ctx.hasUI) return;

        const theme = ctx.ui.theme;
        const weeklyLimit = toNum(data.usage?.limit);
        const weeklyUsed = toNum(data.usage?.used);
        const weeklyUsedPct = pct(weeklyUsed, weeklyLimit);
        const weeklyReset = formatReset(data.usage?.resetTime || data.usage?.reset_at);

        const rate = data.limits?.[0];
        const rateLimit = toNum(rate?.detail?.limit);
        const rateUsed = toNum(rate?.detail?.used);
        const rateUsedPct = pct(rateUsed, rateLimit);
        const rateReset = formatReset(rate?.detail?.resetTime || rate?.detail?.reset_at);
        const rateWindow = durationLabel(rate?.window?.duration, rate?.window?.timeUnit);

        const weeklyColor = colorize(theme, weeklyUsedPct);
        const rateColor = colorize(theme, rateUsedPct);

        const statusParts = [
          theme.fg("accent", "Kimi"),
          weeklyColor(`7d ${weeklyUsedPct ?? "?"}%${weeklyReset ? ` ${weeklyReset}` : ""}`),
          rateColor(`${rateWindow} ${rateUsedPct ?? "?"}%${rateReset ? ` ${rateReset}` : ""}`),
        ];
        ctx.ui.setStatus(EXT_ID, statusParts.join(theme.fg("dim", " · ")));
      } catch (_error) {
        if (!ctx.hasUI) return;
        ctx.ui.setStatus(EXT_ID, ctx.ui.theme.fg("warning", "Kimi: usage unavailable"));
      }
    })();

    try {
      await inFlight;
    } finally {
      inFlight = undefined;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    activeProvider = ctx.model?.provider;
    clearTimer();
    clearUi(ctx);
    await render(ctx);
    timer = setInterval(() => {
      void render(ctx);
    }, REFRESH_MS);
    (globalThis as Record<string, unknown>)[GLOBAL_TIMER_KEY] = timer;
  });

  pi.on("model_select", async (event, ctx) => {
    activeProvider = event.model.provider;
    if (isKimiSelected(ctx)) await render(ctx);
    else clearUi(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await render(ctx);
  });

  pi.on("session_end", async (_event, ctx) => {
    clearTimer();
    clearUi(ctx);
  });

  pi.registerCommand("kimi-usage-refresh", {
    description: "Refresh Kimi usage widget/status",
    handler: async (_args, ctx) => {
      await render(ctx);
      if (ctx.hasUI) ctx.ui.notify("Refreshed Kimi usage", "info");
    },
  });
}
