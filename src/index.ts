import path from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { generateFiles, syncOutput } from "./codegen.js";
import { PLUGIN_NAME, toPluginErrorMessage, toRollupError } from "./errors.js";

export interface PluginOptions {
  /** Directory containing flat JSON translation resources. Relative to the Vite root. Default: "src/i18n/resources". */
  srcDir?: string;
  /** Directory where generated TypeScript files are written. Relative to the Vite root. Default: "src/i18n". */
  outDir?: string;
}

export type { GeneratedFile, CodegenOptions, ParsedLocale, TranslationEntry } from "./codegen.js";
export { CodegenError } from "./errors.js";

export function i18nCodegen(options: PluginOptions = {}): Plugin {
  let config: ResolvedConfig | undefined;
  let server: ViteDevServer | undefined;
  let srcDir = "";
  let outDir = "";
  const previous = new Map<string, string>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let fsEventListener: ((filePath: string) => void) | undefined;

  function resolvePaths(resolved: ResolvedConfig): void {
    srcDir = path.resolve(resolved.root, options.srcDir ?? "src/i18n/resources");
    outDir = path.resolve(resolved.root, options.outDir ?? "src/i18n");
  }

  function regenerate(): void {
    if (srcDir.length === 0 || outDir.length === 0) return;
    const files = generateFiles({ srcDir, outDir });
    syncOutput(files, previous);
  }

  function reportDevError(err: unknown): void {
    if (!server) return;
    const message = toPluginErrorMessage(err);
    const display = `[${PLUGIN_NAME}] ${message.message}`;
    server.config.logger.error(display, {
      error: err instanceof Error ? err : new Error(String(err)),
    });
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
        if (config.command === "serve" && server) {
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

      const onFsEvent = (filePath: string): void => {
        if (!filePath.endsWith(".json")) return;
        if (!filePath.startsWith(srcDir)) return;
        scheduleRegenerate();
      };
      fsEventListener = onFsEvent;
      currentServer.watcher.on("add", onFsEvent);
      currentServer.watcher.on("change", onFsEvent);
      currentServer.watcher.on("unlink", onFsEvent);
    },

    closeServer() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = undefined;
      if (server && fsEventListener) {
        server.watcher.removeListener("add", fsEventListener);
        server.watcher.removeListener("change", fsEventListener);
        server.watcher.removeListener("unlink", fsEventListener);
      }
    },
  };
}
