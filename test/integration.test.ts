import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build, createServer, type ViteDevServer } from "vite";
import { i18nCodegen } from "../src/index.js";

const servers: ViteDevServer[] = [];

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-codegen-dev-"));
  fs.mkdirSync(path.join(root, "src", "i18n", "resources"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "i18n", "resources", "en.json"),
    JSON.stringify({ hello: "Hello, {name}!" }, null, 2),
  );
  fs.writeFileSync(path.join(root, "index.html"), '<div id="app"></div>');
  return root;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

describe("dev server integration", () => {
  it("generates on startup and regenerates on change/add/remove", async () => {
    const root = makeProject();
    const server = await createServer({
      root,
      logLevel: "error",
      server: { watch: { interval: 50 } },
      plugins: [i18nCodegen()],
    });
    servers.push(server);
    await server.listen();

    try {
      await vi.waitFor(() => {
        expect(fs.readFileSync(path.join(root, "src", "i18n", "en.ts"), "utf8")).toContain(
          "Hello, ${name}!",
        );
      });
      expect(fs.readFileSync(path.join(root, "src", "i18n", "index.ts"), "utf8")).toContain(
        'export type Locale = "en";',
      );

      fs.writeFileSync(
        path.join(root, "src", "i18n", "resources", "en.json"),
        JSON.stringify({ hello: "Bonjour, {name}!", goodbye: "Au revoir" }, null, 2),
      );
      await vi.waitFor(() => {
        const file = fs.readFileSync(path.join(root, "src", "i18n", "en.ts"), "utf8");
        expect(file).toContain("Bonjour, ${name}!");
        expect(file).toContain("goodbye");
      });

      fs.writeFileSync(
        path.join(root, "src", "i18n", "resources", "fr.json"),
        JSON.stringify({ hello: "Salut, {name}!", goodbye: "À plus" }, null, 2),
      );
      await vi.waitFor(() => {
        expect(fs.existsSync(path.join(root, "src", "i18n", "fr.ts"))).toBe(true);
        expect(fs.readFileSync(path.join(root, "src", "i18n", "index.ts"), "utf8")).toContain(
          'export type Locale = "en" | "fr";',
        );
      });

      fs.rmSync(path.join(root, "src", "i18n", "resources", "fr.json"));
      await vi.waitFor(() => {
        expect(fs.existsSync(path.join(root, "src", "i18n", "fr.ts"))).toBe(false);
        expect(fs.readFileSync(path.join(root, "src", "i18n", "index.ts"), "utf8")).not.toContain(
          "import fr",
        );
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("surfaces source errors in the CLI logger and the websocket overlay", async () => {
    const root = makeProject();
    const server = await createServer({
      root,
      logLevel: "error",
      server: { watch: { interval: 50 } },
      plugins: [i18nCodegen()],
    });
    servers.push(server);
    await server.listen();

    const sendSpy = vi.spyOn(server.ws, "send");
    const loggerError = vi.spyOn(server.config.logger, "error");

    try {
      await vi.waitFor(() => {
        expect(fs.existsSync(path.join(root, "src", "i18n", "index.ts"))).toBe(true);
      });

      fs.writeFileSync(path.join(root, "src", "i18n", "resources", "bad.json"), "{ invalid json ");

      await vi.waitFor(() => {
        expect(
          sendSpy.mock.calls.some(([payload]) => (payload as { type?: string })?.type === "error"),
        ).toBe(true);
      });

      const errorPayload = sendSpy.mock.calls
        .map(
          ([payload]) => payload as { type?: string; err?: { message?: string; plugin?: string } },
        )
        .find((payload) => payload.type === "error");
      expect(errorPayload?.err?.message).toMatch(/not valid JSON/);
      expect(errorPayload?.err?.plugin).toBe("vite-plugin-i18n-codegen");
      expect(
        loggerError.mock.calls.some(([message]) => String(message).includes("not valid JSON")),
      ).toBe(true);

      fs.rmSync(path.join(root, "src", "i18n", "resources", "bad.json"));
      await vi.waitFor(() => {
        expect(fs.readFileSync(path.join(root, "src", "i18n", "index.ts"), "utf8")).toContain(
          'export type Locale = "en";',
        );
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("build integration", () => {
  it("generates files during vite build", async () => {
    const root = makeProject();
    try {
      await build({
        root,
        logLevel: "error",
        plugins: [i18nCodegen()],
        build: { write: false },
      });
      expect(fs.existsSync(path.join(root, "src", "i18n", "en.ts"))).toBe(true);
      expect(fs.existsSync(path.join(root, "src", "i18n", "index.ts"))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("aborts the build when a source file is invalid", async () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, "src", "i18n", "resources", "bad.json"), "nope");
    try {
      await expect(
        build({
          root,
          logLevel: "error",
          plugins: [i18nCodegen()],
          build: { write: false },
        }),
      ).rejects.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
