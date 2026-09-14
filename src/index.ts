import path from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { generateFiles, isInsideDir, type LocaleCache, syncOutput } from "./codegen.js";
import { PLUGIN_NAME, toPluginErrorMessage, toRollupError } from "./errors.js";

export interface PluginOptions {
  /** Directory containing flat JSON translation resources. Relative to the Vite root. Default: "src/i18n/resources". */
  srcDir?: string;
  /** Directory where generated TypeScript files are written. Relative to the Vite root. Default: "src/i18n". */
  outDir?: string;
}

export type {
  GeneratedFile,
  CodegenOptions,
  LocaleCache,
  LocaleCacheEntry,
  ParsedLocale,
  TranslationEntry,
} from "./codegen.js";
export { CodegenError } from "./errors.js";

type WatcherEvent = "add" | "change" | "unlink" | "addDir" | "unlinkDir";
type WatcherListener = [WatcherEvent, (target: string) => void];

export function i18nCodegen(options: Partial<PluginOptions> = {}): Plugin {
  let config: ResolvedConfig | undefined;
  let server: ViteDevServer | undefined;
  let srcDir = "";
  let outDir = "";
  const previous = new Map<string, string>();
  const cache: LocaleCache = new Map();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let listeners: WatcherListener[] = [];

  function resolvePaths(resolved: ResolvedConfig): void {
    srcDir = path.resolve(resolved.root, options.srcDir ?? "src/i18n/resources");
    outDir = path.resolve(resolved.root, options.outDir ?? "src/i18n");
  }

  function regenerate(): void {
    if (srcDir.length === 0 || outDir.length === 0) return;
    const files = generateFiles({ srcDir, outDir }, cache);
    syncOutput(files, previous, outDir);
  }

  function reportDevError(err: unknown): void {
    const message = toPluginErrorMessage(err);
    const display = `[${PLUGIN_NAME}] ${message.message}`;
    const logger = server?.config.logger ?? config?.logger;
    if (logger) {
      logger.error(display, {
        timestamp: true,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    } else {
      console.error(display);
    }
    if (!server) return;
    try {
      server.ws.send({ type: "error", err: { ...message, message: display } });
    } catch {
      // Ignore failures while broadcasting to the overlay.
    }
  }

  function scheduleRegenerate(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      try {
        regenerate();
      } catch (err) {
        reportDevError(err);
      }
    }, 100);
  }

  return {
    name: PLUGIN_NAME,

    configResolved(resolved) {
      config = resolved;
      resolvePaths(resolved);
    },

    buildStart() {
      if (!config) return;
      try {
        regenerate();
      } catch (err) {
        if (config.command === "serve") {
          reportDevError(err);
        } else {
          this.error(toRollupError(err));
        }
      }
    },

    configureServer(currentServer) {
      server = currentServer;
      if (srcDir.length === 0 || outDir.length === 0) {
        resolvePaths(currentServer.config);
      }
      currentServer.watcher.add(srcDir);

      const onFileEvent = (filePath: string): void => {
        if (!filePath.endsWith(".json")) return;
        if (!isInsideDir(srcDir, filePath)) return;
        scheduleRegenerate();
      };
      // Removing or restoring the resources directory itself does not always emit
      // per-file events, so react to directory events covering srcDir too.
      const onDirEvent = (dirPath: string): void => {
        if (dirPath !== srcDir && !isInsideDir(srcDir, dirPath)) return;
        scheduleRegenerate();
      };

      listeners = [
        ["add", onFileEvent],
        ["change", onFileEvent],
        ["unlink", onFileEvent],
        ["addDir", onDirEvent],
        ["unlinkDir", onDirEvent],
      ];
      for (const [event, listener] of listeners) {
        currentServer.watcher.on(event, listener);
      }
    },

    closeServer() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = undefined;
      if (server) {
        for (const [event, listener] of listeners) {
          server.watcher.removeListener(event, listener);
        }
      }
      listeners = [];
      server = undefined;
      previous.clear();
      cache.clear();
    },
  };
}
