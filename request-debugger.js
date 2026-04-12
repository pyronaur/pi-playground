import { appendFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatClock(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatFileStamp(date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    "-",
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join("");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function toText(value) {
  try {
    const text = JSON.stringify(value, null, 2);
    if (text !== undefined) return text;
  } catch {}

  return inspect(value, {
    depth: null,
    colors: false,
    compact: false,
    breakLength: 120,
  });
}

function maskSecret(value) {
  if (!value) return value;
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactHeaders(headers) {
  if (!headers) return undefined;

  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower.includes("authorization") || lower.includes("api-key") || lower.includes("token")) {
      result[key] = maskSecret(value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

export class RequestDebugger {
  constructor(name = "provider-request") {
    this.name = name;
    this.enabled = false;
    this.turn = 0;
    this.logPath = undefined;
  }

  getDir(cwd) {
    return join(cwd, ".pi", "playground");
  }

  getFlagPath(cwd) {
    return join(this.getDir(cwd), `${this.name}.enabled`);
  }

  makeLogPath(cwd, date = new Date()) {
    return join(this.getDir(cwd), `${this.name}-${formatFileStamp(date)}.log`);
  }

  ensureDir(cwd) {
    mkdirSync(this.getDir(cwd), { recursive: true });
  }

  isEnabled() {
    return this.enabled;
  }

  getLogPath() {
    return this.logPath;
  }

  load(cwd) {
    this.ensureDir(cwd);
    this.enabled = existsSync(this.getFlagPath(cwd));
    return this.enabled;
  }

  writeFlag(cwd, enabled) {
    this.ensureDir(cwd);

    if (enabled) {
      writeFileSync(this.getFlagPath(cwd), "1\n");
      return;
    }

    if (existsSync(this.getFlagPath(cwd))) {
      unlinkSync(this.getFlagPath(cwd));
    }
  }

  ensureLogPath(cwd, date = new Date()) {
    if (this.logPath) return this.logPath;
    this.logPath = this.makeLogPath(cwd, date);
    return this.logPath;
  }

  append(cwd, text, date = new Date()) {
    const path = this.ensureLogPath(cwd, date);
    appendFileSync(path, text);
    return path;
  }

  notify(ctx, message, type = "info") {
    if (!ctx.hasUI) return;
    ctx.ui.notify(`${formatClock(new Date())} ${message}`, type);
  }

  clip(text, max = 140) {
    const oneLine = String(text).replace(/\s+/g, " ").trim();
    if (oneLine.length <= max) return oneLine;
    return `${oneLine.slice(0, max - 1)}…`;
  }

  extractNotifyText(payload) {
    const inputText = this.extractFromInputArray(payload?.input);
    if (inputText) return inputText;

    const messageText = this.extractFromMessageArray(payload?.messages);
    if (messageText) return messageText;

    return this.extractLastText(payload);
  }

  extractFromInputArray(input) {
    if (!Array.isArray(input)) return undefined;

    for (let i = input.length - 1; i >= 0; i--) {
      const item = input[i];
      if (!item || item.role !== "user") continue;
      const text = this.extractFromContent(item.content);
      if (text) return text;
    }

    return undefined;
  }

  extractFromMessageArray(messages) {
    if (!Array.isArray(messages)) return undefined;

    for (let i = messages.length - 1; i >= 0; i--) {
      const item = messages[i];
      if (!item || item.role !== "user") continue;
      const text = this.extractFromContent(item.content);
      if (text) return text;
    }

    return undefined;
  }

  extractFromContent(content) {
    if (typeof content === "string") return this.clip(content, 160);
    if (!Array.isArray(content)) return undefined;

    for (let i = content.length - 1; i >= 0; i--) {
      const item = content[i];
      if (!item) continue;
      if (typeof item === "string") {
        const text = this.clip(item, 160);
        if (text) return text;
        continue;
      }
      if (typeof item.text === "string") {
        const text = this.clip(item.text, 160);
        if (text) return text;
        continue;
      }
      if (typeof item.input_text === "string") {
        const text = this.clip(item.input_text, 160);
        if (text) return text;
      }
    }

    return undefined;
  }

  extractLastText(value) {
    const texts = [];
    this.collectTexts(value, texts, 0);
    return texts.length > 0 ? texts[texts.length - 1] : undefined;
  }

  collectTexts(value, texts, depth) {
    if (depth > 6 || texts.length >= 20 || value == null) return;

    if (typeof value === "string") {
      const text = this.clip(value, 220);
      if (text) texts.push(text);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.collectTexts(item, texts, depth + 1);
        if (texts.length >= 20) return;
      }
      return;
    }

    if (typeof value !== "object") return;

    const candidateKeys = ["text", "input_text", "content", "input", "messages", "prompt", "instructions"];
    for (const key of candidateKeys) {
      if (!(key in value)) continue;
      this.collectTexts(value[key], texts, depth + 1);
      if (texts.length >= 20) return;
    }
  }

  onSessionStart(event, ctx) {
    this.turn = 0;
    this.logPath = undefined;

    if (!this.load(ctx.cwd)) return;

    const date = new Date();
    const path = this.ensureLogPath(ctx.cwd, date);
    this.append(
      ctx.cwd,
      [
        `=== ${date.toISOString()} debug active ===`,
        `reason: ${event.reason}`,
        `cwd: ${ctx.cwd}`,
        `log: ${path}`,
        "",
      ].join("\n"),
      date,
    );

    this.notify(ctx, `playground request debug active -> ${path}`);
  }

  onSessionShutdown(ctx) {
    this.turn = 0;
    this.logPath = undefined;
  }

  onTurnStart(event) {
    this.turn = event.turnIndex;
  }

  toggle(ctx) {
    const next = !this.load(ctx.cwd);
    this.enabled = next;
    this.writeFlag(ctx.cwd, next);
    this.turn = 0;

    if (!next) {
      const path = this.logPath;
      this.logPath = undefined;
      this.notify(ctx, path ? `playground request debug off (${path})` : "playground request debug off");
      return { enabled: false, logPath: path };
    }

    const date = new Date();
    const path = this.ensureLogPath(ctx.cwd, date);
    this.append(
      ctx.cwd,
      [
        `=== ${date.toISOString()} debug enabled ===`,
        `cwd: ${ctx.cwd}`,
        `log: ${path}`,
        "",
      ].join("\n"),
      date,
    );
    this.notify(ctx, `playground request debug on -> ${path}`);
    return { enabled: true, logPath: path };
  }

  async recordBeforeProviderRequest(event, ctx) {
    if (!this.enabled) return;

    const date = new Date();
    const payloadText = toText(event.payload);
    const payloadBytes = Buffer.byteLength(payloadText, "utf8");
    const model = ctx.model;
    const modelLabel = model ? `${model.provider}/${model.id}` : "unknown-model";
    const notifyText = this.extractNotifyText(event.payload) ?? `${modelLabel} ${formatBytes(payloadBytes)}`;

    let auth;
    if (model) {
      try {
        auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      } catch {}
    }

    const authBlock = auth?.ok
      ? {
          apiKey: auth.apiKey ? maskSecret(auth.apiKey) : undefined,
          headers: redactHeaders(auth.headers),
        }
      : undefined;

    this.append(
      ctx.cwd,
      [
        `=== ${date.toISOString()} before_provider_request ===`,
        `turn: ${this.turn}`,
        `model: ${modelLabel}`,
        model?.api ? `api: ${model.api}` : undefined,
        model?.baseUrl ? `baseUrl: ${model.baseUrl}` : undefined,
        authBlock ? `auth: ${toText(authBlock)}` : undefined,
        `payloadBytes: ${payloadBytes}`,
        "payload:",
        payloadText,
        "",
      ]
        .filter(Boolean)
        .join("\n"),
      date,
    );

    this.notify(ctx, this.clip(notifyText, 160));
  }
}