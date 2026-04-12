import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { RequestDebugger } from "./request-debugger.js";

const LABEL = "Playground";
const SOFT_GREEN = "\u001b[38;2;166;219;180m";
const RESET = "\u001b[0m";

let closeBadge;
let badgeHandle;
const requestDebugger = new RequestDebugger();

function showBadge(ctx) {
  if (!ctx.hasUI || closeBadge) return;

  void ctx.ui.custom(
    (_tui, theme, _keybindings, done) => {
      closeBadge = () => done(undefined);
      return makeBadge(theme);
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "top-left",
        width: "100%",
        margin: 0,
        offsetX: 0,
        offsetY: 0,
        nonCapturing: true,
      },
      onHandle: (handle) => {
        badgeHandle = handle;
      },
    },
  ).catch(() => {});
}

function getLogPath(cwd) {
  return join(cwd, ".pi", "logs", "playground.jsonl");
}

function log(cwd, event, details = {}) {
  const path = getLogPath(cwd);
  mkdirSync(join(cwd, ".pi", "logs"), { recursive: true });
  appendFileSync(
    path,
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...details,
    }) + "\n",
  );
}

function clearBadge() {
  if (!closeBadge) return;
  const close = closeBadge;
  closeBadge = undefined;
  badgeHandle?.focus?.();
  badgeHandle = undefined;
  close();
}

function makeBadge(theme) {
  return {
    render(width) {
      const top = " ".repeat(width);
      const text = "  " + SOFT_GREEN + LABEL + RESET;
      const pad = " ".repeat(Math.max(0, width - 2 - LABEL.length));
      const line = theme.fg("dim", "─".repeat(width));
      return [top, text + pad, line];
    },
    invalidate() {},
  };
}

export default function (pi) {
  pi.registerCommand("debug-playground", {
    description: "Toggle provider request debugging",
    handler: async (_args, ctx) => {
      const result = requestDebugger.toggle(ctx);
      if (result.enabled) {
        showBadge(ctx);
        return;
      }

      clearBadge();
    },
  });

  pi.on("session_start", (event, ctx) => {
    log(ctx.cwd, "session_start", { reason: event.reason, hasUI: ctx.hasUI });
    if (!ctx.hasUI) return;

    requestDebugger.onSessionStart(event, ctx);

    clearBadge();
    if (requestDebugger.isEnabled()) {
      showBadge(ctx);
    }

    ctx.ui.notify(`pi-playground loaded (${event.reason})`, "info");
  });

  pi.on("turn_start", (event) => {
    requestDebugger.onTurnStart(event);
  });

  pi.on("before_provider_request", async (event, ctx) => {
    await requestDebugger.recordBeforeProviderRequest(event, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    log(ctx.cwd, "session_shutdown", { hasUI: ctx.hasUI });
    requestDebugger.onSessionShutdown(ctx);
    if (!ctx.hasUI) return;
    clearBadge();
  });
}