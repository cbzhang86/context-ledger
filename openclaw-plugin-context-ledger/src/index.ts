/**
 * context-ledger — native OpenClaw context-engine plugin.
 *
 * Fully-automatic, model-transparent conversation compression:
 *  - Every `before_prompt_build` we inspect the session transcript (read-only,
 *    history is frozen — we never edit it), mirror it into the block ledger,
 *    and when the session grows past a threshold we inject a compacted
 *    "ledger view" (summary blocks + recent live messages) as prependContext,
 *    plus a compression reminder listing compressible ranges.
 *  - The ledger persists per session key, so resumed/invalidated sessions get
 *    their compacted context restored automatically.
 */

import {
  estimateTokens,
  Kernel,
  Store,
  type Conversation,
  type Msg,
} from "./kernel.js";

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

interface PluginConfig {
  enabled?: boolean;
  dataDir?: string;
  compressThresholdTokens?: number;
  viewTokens?: number;
  autoAppend?: boolean;
}

interface PluginAPI {
  config: PluginConfig;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  on(event: string, handler: (event: any) => Promise<any> | any): void;
}

interface PromptBuildEvent {
  sessionKey?: string;
  /** Frozen history leaves. Read-only: we mirror, never mutate. */
  history?: Array<{ role?: string; content?: unknown }>;
  continuity?: { state?: string };
}

interface PromptBuildResult {
  prependContext?: string;
  appendContext?: string;
}

// ---------------------------------------------------------------------------
// transcript mirroring
// ---------------------------------------------------------------------------

/**
 * Map a history entry to a ledger Msg. Mirroring is position-based: the
 * ledger conversation is keyed by sessionKey and we keep an index cursor —
 * only NEW entries (beyond what we already mirrored) get appended, so the
 * ledger stays monotonic and stable even though history objects may be
 * regenerated between turns.
 */
class Mirror {
  private kernel: Kernel;
  private convId: string;
  /** Number of history entries already mirrored. */
  private cursor = 0;
  /** Monotonic mirror-id cursor for the ledger conversation. */
  private ledgerSeq = 0;

  constructor(kernel: Kernel, convId: string) {
    this.kernel = kernel;
    this.convId = convId;
  }

  static roleOf(entry: { role?: string }): Msg["role"] {
    const r = (entry.role ?? "user").toLowerCase();
    if (r.startsWith("assistant") || r.startsWith("model")) return "assistant";
    if (r.startsWith("tool") || r.startsWith("function")) return "tool";
    return "user";
  }

  /** Append any not-yet-mirrored history entries. Returns count added. */
  sync(history: Array<{ role?: string; content?: unknown }>): number {
    let added = 0;
    for (; this.cursor < history.length; this.cursor++) {
      const entry = history[this.cursor];
      const content = contentToText(entry?.content);
      if (!content) continue;
      // ledger ids are per-conversation monotonic: m00001, m00002, ...
      this.ledgerSeq++;
      const id = `m${String(this.ledgerSeq).padStart(5, "0")}`;
      appendDirect(this.kernel, this.convId, id, Mirror.roleOf(entry), content);
      added++;
    }
    return added;
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((part: any) =>
        typeof part === "string"
          ? part
          : typeof part?.text === "string"
            ? part.text
            : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  if (typeof (content as any)?.text === "string") return (content as any).text;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * Append a message with an explicit id. Kernel.append assigns ids itself, so
 * for mirror-stable ids we go one level down: load → push → save.
 */
function appendDirect(
  kernel: Kernel,
  convId: string,
  id: string,
  role: Msg["role"],
  content: string,
): void {
  // Access the store through the kernel's public surface is not exposed, so
  // we re-implement append here against the same Store instance the kernel
  // uses — achieved by a tiny cast. (Kernel deliberately keeps store private;
  // the plugin needs explicit-id appends for mirror stability.)
  const store = (kernel as unknown as { store: Store }).store;
  const conv: Conversation = store.load(convId);
  if (conv.msgs.some((m) => m.id === id)) return; // already mirrored
  conv.msgs.push({
    id,
    role,
    tokens: estimateTokens(content),
    time: new Date().toISOString(),
    content,
  });
  store.save(conv);
}

// ---------------------------------------------------------------------------
// plugin entry
// ---------------------------------------------------------------------------

export function definePluginEntry(ctx: {
  id: string;
  name: string;
  description: string;
  configSchema?: unknown;
  register: (api: PluginAPI) => void;
}): unknown {
  return ctx;
}

export default definePluginEntry({
  id: "context-ledger",
  name: "Context Ledger",
  description:
    "Automatic billion-context-style compression: mirrors the transcript into a block ledger and injects the compacted view before prompt build.",
  register(api: PluginAPI) {
    const cfg: Required<Pick<PluginConfig, "compressThresholdTokens" | "viewTokens" | "autoAppend">> & PluginConfig = {
      enabled: api.config?.enabled ?? true,
      compressThresholdTokens: api.config?.compressThresholdTokens ?? 8000,
      viewTokens: api.config?.viewTokens ?? 2000,
      autoAppend: api.config?.autoAppend ?? false,
      ...api.config,
    };

    const dataDir =
      cfg.dataDir ??
      process.env.CONTEXT_LEDGER_DATA ??
      joinDefaultDir();

    const store = new Store(dataDir);
    const kernel = new Kernel(store);
    const mirrors = new Map<string, Mirror>();

    api.logger.info(
      `context-ledger: data dir ${dataDir}, threshold ${cfg.compressThresholdTokens} tokens`,
    );

    const getMirror = (sessionKey: string): Mirror => {
      let m = mirrors.get(sessionKey);
      if (!m) {
        m = new Mirror(kernel, sessionKey);
        mirrors.set(sessionKey, m);
      }
      return m;
    };

    // Kill switch: config enabled:false, or env CONTEXT_LEDGER_DISABLE set
    // to a non-empty value other than "0"/"false". Checked at every hook
    // invocation so the plugin can be turned off without a restart.
    const envDisabled = (): boolean => {
      const v = (process.env.CONTEXT_LEDGER_DISABLE ?? "").trim().toLowerCase();
      return v !== "" && v !== "0" && v !== "false";
    };

    api.on("before_prompt_build", (event: PromptBuildEvent): PromptBuildResult => {
      if (cfg.enabled === false || envDisabled()) return {};
      const sessionKey = event?.sessionKey ?? "default";
      const history = event?.history ?? [];
      if (history.length === 0) return {};

      try {
        const mirror = getMirror(sessionKey);
        const added = mirror.sync(history);
        const st = kernel.status(sessionKey);
        const rawTokens = st.tokens.raw;

        // Small session: nothing to do.
        if (rawTokens < cfg.compressThresholdTokens) return {};

        // Session crossed the threshold — act.
        const view = kernel.renderView(
          sessionKey,
          cfg.viewTokens > 0 ? cfg.viewTokens : undefined,
        );
        const ranges = st.compressibleRanges
          .map((r) => `${r.startId}–${r.endId} (~${r.tokens} tok)`)
          .join(", ");

        if (cfg.autoAppend) {
          // Full-auto: hand the model the compacted view directly.
          return {
            prependContext:
              `[context-ledger] This session exceeded ${cfg.compressThresholdTokens} tokens. ` +
              `Below is the compacted ledger view (📦 = compressed summary block; ` +
              `recent messages stay verbatim). Trust this view as authoritative history:\n\n${view}`,
          };
        }

        // Reminder mode: tell the model what it can compress and how.
        return {
          prependContext:
            `[context-ledger] This session is ~${rawTokens} tokens (raw). ` +
            `Compressible ranges: ${ranges || "(none — compress m00001 up to the tail guard)"}.\n` +
            `Use mcp_context-ledger_compress (or the ledger CLI) to compress the oldest ` +
            `range now; keep summaries self-contained (paths, signatures, errors, ` +
            `decisions, open objectives). The last 4 messages must stay live.`,
        };
      } catch (err) {
        api.logger.warn(`context-ledger: hook failed: ${(err as Error)?.message ?? err}`);
        return {};
      }
    });
  },
});

function joinDefaultDir(): string {
  // OpenClaw exposes its state dir via env in most installs; fall back to cwd.
  return (
    process.env.OPENCLAW_STATE_DIR
      ? `${process.env.OPENCLAW_STATE_DIR}/context-ledger`
      : ".context-ledger"
  );
}
