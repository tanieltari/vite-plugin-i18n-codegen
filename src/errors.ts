export const PLUGIN_NAME = "vite-plugin-i18n-codegen";

export class CodegenError extends Error {
  readonly id?: string;

  constructor(message: string, id?: string) {
    super(message);
    this.name = "CodegenError";
    this.id = id;
  }
}

export interface PluginErrorMessage {
  message: string;
  stack: string;
  id?: string;
  plugin: string;
}

export function toPluginErrorMessage(err: unknown): PluginErrorMessage {
  const base = err instanceof Error ? err : new Error(String(err));
  return {
    message: base.message,
    stack: base.stack ?? "",
    id: err instanceof CodegenError ? err.id : undefined,
    plugin: PLUGIN_NAME,
  };
}

export function toRollupError(err: unknown): {
  name: string;
  message: string;
  stack: string;
  id?: string;
  plugin: string;
} {
  const base = err instanceof Error ? err : new Error(String(err));
  return {
    name: base.name,
    message: base.message,
    stack: base.stack ?? "",
    id: err instanceof CodegenError ? err.id : undefined,
    plugin: PLUGIN_NAME,
  };
}
