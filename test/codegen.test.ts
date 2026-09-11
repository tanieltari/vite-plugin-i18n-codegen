import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { generateFiles, parseTranslationFile, syncOutput } from "../src/codegen.js";
import { CodegenError } from "../src/errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const basicFixture = path.join(here, "fixtures", "basic");

const createdDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-codegen-test-"));
  createdDirs.push(dir);
  return dir;
}

function writeResources(root: string, files: Record<string, string>): string {
  const srcDir = path.join(root, "resources");
  fs.mkdirSync(srcDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(srcDir, name), content);
  }
  return srcDir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("generateFiles", () => {
  it("generates the exact expected files for the basic fixture", () => {
    const outDir = tmpDir();
    const files = generateFiles({
      srcDir: path.join(basicFixture, "resources"),
      outDir,
    });

    const byName = new Map(files.map((file) => [path.basename(file.path), file]));
    expect([...byName.keys()].sort()).toEqual(["de.ts", "en_US.ts", "index.ts"]);

    for (const name of ["de.ts", "en_US.ts", "index.ts"]) {
      const expected = fs.readFileSync(path.join(basicFixture, "expected", name), "utf8");
      expect(byName.get(name)?.content).toBe(expected);
    }
  });

  it("matches the example locale files byte-for-byte", () => {
    const files = generateFiles({
      srcDir: path.join(basicFixture, "resources"),
      outDir: tmpDir(),
    });
    const exampleDir = path.join(here, "fixtures", "basic", "expected");

    for (const name of ["de.ts", "en_US.ts"]) {
      const file = files.find((f) => path.basename(f.path) === name);
      const expected = fs.readFileSync(path.join(exampleDir, name), "utf8");
      expect(file?.content).toBe(expected);
    }
  });

  it("dedupes repeated placeholders and keeps first-appearance order", () => {
    const srcDir = writeResources(tmpDir(), {
      "en.json": JSON.stringify({ greet: "Hi, {name} and {name} and {other} {name}" }),
    });
    const [file] = generateFiles({ srcDir, outDir: tmpDir() });
    expect(file.content).toContain(
      "greet: (name: string, other: string) => `Hi, ${name} and ${name} and ${other} ${name}`,",
    );
  });

  it("escapes backticks, backslashes and newlines in template literals", () => {
    const srcDir = writeResources(tmpDir(), {
      "en.json": JSON.stringify({
        code: "Use `code`, ${x} and back\\slash",
        lines: "first\nsecond\tthird",
      }),
    });
    const [file] = generateFiles({ srcDir, outDir: tmpDir() });
    expect(file.content).toContain(
      "code: (x: string) => `Use \\`code\\`, $${x} and back\\\\slash`,",
    );
    expect(file.content).toContain("lines: () => `first\\nsecond\\tthird`,");
  });

  it("errors on invalid JSON and carries the offending file id", () => {
    const srcDir = writeResources(tmpDir(), { "bad.json": "{ not json " });
    let caught: unknown;
    try {
      generateFiles({ srcDir, outDir: tmpDir() });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CodegenError);
    expect((caught as CodegenError).id).toBe(path.join(srcDir, "bad.json"));
    expect((caught as CodegenError).message).toMatch(/not valid JSON/);
  });

  it("errors on nested values", () => {
    const srcDir = writeResources(tmpDir(), {
      "en.json": JSON.stringify({ menu: { home: "Home" } }),
    });
    expect(() => generateFiles({ srcDir, outDir: tmpDir() })).toThrowError(
      /"menu" in en.json must be a string/,
    );
  });

  it("errors when a locale is missing a key from the reference", () => {
    const srcDir = writeResources(tmpDir(), {
      "de.json": JSON.stringify({ welcome: "Willkommen", hello: "Hallo" }),
      "en.json": JSON.stringify({ welcome: "Welcome" }),
    });
    expect(() => generateFiles({ srcDir, outDir: tmpDir() })).toThrowError(
      /en.json is missing translation key "hello"/,
    );
  });

  it("errors when placeholders differ between locales", () => {
    const srcDir = writeResources(tmpDir(), {
      "de.json": JSON.stringify({ welcome: "Willkommen, {name}!" }),
      "en.json": JSON.stringify({ welcome: "Welcome, {fullName}!" }),
    });
    expect(() => generateFiles({ srcDir, outDir: tmpDir() })).toThrowError(
      /Placeholders for "welcome"/,
    );
  });

  it("errors on invalid placeholder names", () => {
    const srcDir = writeResources(tmpDir(), {
      "en.json": JSON.stringify({ welcome: "Welcome, {first name}!" }),
    });
    expect(() => generateFiles({ srcDir, outDir: tmpDir() })).toThrowError(
      /Invalid placeholder "\{first name\}"/,
    );
  });

  it("errors on unmatched braces", () => {
    const srcDir = writeResources(tmpDir(), {
      "en.json": JSON.stringify({ welcome: "Welcome, {name" }),
    });
    expect(() => generateFiles({ srcDir, outDir: tmpDir() })).toThrowError(
      /Unmatched "\{" or "\}"/,
    );
  });

  it("returns no files when the source directory has no JSON resources", () => {
    const srcDir = writeResources(tmpDir(), {});
    expect(generateFiles({ srcDir, outDir: tmpDir() })).toEqual([]);
  });

  it("errors when the source directory does not exist", () => {
    const missing = path.join(tmpDir(), "nope");
    expect(() => generateFiles({ srcDir: missing, outDir: tmpDir() })).toThrowError(
      /does not exist/,
    );
  });

  it("allows locale names with only letters, numbers and underscores", () => {
    const srcDir = writeResources(tmpDir(), {
      "en1.json": JSON.stringify({ hello: "Hello" }),
      "en_US.json": JSON.stringify({ hello: "Hello" }),
    });
    const files = generateFiles({ srcDir, outDir: tmpDir() });
    const index = files.find((file) => path.basename(file.path) === "index.ts");
    expect(index?.content).toContain('export type Locale = "en_US" | "en1";');
    expect(index?.content).toContain(
      "export const dictionary: Dictionary = { en_US: en_US, en1: en1 };",
    );
  });

  it("errors when a locale name contains a hyphen", () => {
    const srcDir = writeResources(tmpDir(), {
      "de.json": JSON.stringify({ hello: "Hallo" }),
      "en-US.json": JSON.stringify({ hello: "Hello" }),
    });
    expect(() => generateFiles({ srcDir, outDir: tmpDir() })).toThrowError(
      /Locale names may only contain letters, numbers, and underscores/,
    );
  });

  it("prefixes reserved words when used as identifiers", () => {
    const srcDir = writeResources(tmpDir(), {
      "if.json": JSON.stringify({ hello: "If" }),
    });
    const files = generateFiles({ srcDir, outDir: tmpDir() });
    const index = files.find((file) => path.basename(file.path) === "index.ts");
    expect(index?.content).toContain('import _if from "./if";');
    expect(index?.content).toContain("export const dictionary: Dictionary = { if: _if };");
  });

  it("uses explicit dictionary keys when locale names are not shorthand-safe", () => {
    const srcDir = writeResources(tmpDir(), {
      "123.json": JSON.stringify({ hello: "Hello" }),
    });
    const files = generateFiles({ srcDir, outDir: tmpDir() });
    const index = files.find((file) => path.basename(file.path) === "index.ts");
    expect(index?.content).toContain('import _123 from "./123";');
    expect(index?.content).toContain("export const dictionary: Dictionary = { 123: _123 };");
  });

  it("quotes dictionary keys that are valid locale names but not object property names", () => {
    const srcDir = writeResources(tmpDir(), {
      "1a.json": JSON.stringify({ hello: "Hello" }),
    });
    const files = generateFiles({ srcDir, outDir: tmpDir() });
    const index = files.find((file) => path.basename(file.path) === "index.ts");
    expect(index?.content).toContain('import _1a from "./1a";');
    expect(index?.content).toContain('export const dictionary: Dictionary = { "1a": _1a };');
  });

  it("errors when two locales sanitize to the same identifier", () => {
    const srcDir = writeResources(tmpDir(), {
      "1.json": JSON.stringify({ hello: "A" }),
      "_1.json": JSON.stringify({ hello: "B" }),
    });
    expect(() => generateFiles({ srcDir, outDir: tmpDir() })).toThrowError(
      /same import identifier "_1"/,
    );
  });

  it("quotes keys that are not valid identifiers", () => {
    const srcDir = writeResources(tmpDir(), {
      "en.json": JSON.stringify({ "my key": "Hello" }),
    });
    const files = generateFiles({ srcDir, outDir: tmpDir() });
    const localeFile = files.find((file) => path.basename(file.path) === "en.ts");
    const index = files.find((file) => path.basename(file.path) === "index.ts");
    expect(localeFile?.content).toContain('"my key": () => `Hello`,');
    expect(index?.content).toContain('"my key": () => string;');
  });
});

describe("parseTranslationFile", () => {
  it("captures locale name, identifier and ordered params", () => {
    const srcDir = writeResources(tmpDir(), {
      "en_US.json": JSON.stringify({ hello: "Hello, {firstName} {lastName}!" }),
    });
    const parsed = parseTranslationFile(path.join(srcDir, "en_US.json"));
    expect(parsed.locale).toBe("en_US");
    expect(parsed.identifier).toBe("en_US");
    expect(parsed.entries[0].params).toEqual(["firstName", "lastName"]);
    expect(parsed.entries[0].template).toBe("Hello, ${firstName} ${lastName}!");
  });
});

describe("syncOutput", () => {
  it("writes new files, skips unchanged ones and removes stale files", () => {
    const outDir = tmpDir();
    const previous = new Map<string, string>();

    const files: Array<{ path: string; content: string }> = [
      { path: path.join(outDir, "a.ts"), content: "one\n" },
      { path: path.join(outDir, "b.ts"), content: "two\n" },
    ];
    expect(syncOutput(files, previous)).toHaveLength(2);
    expect(fs.readFileSync(files[0].path, "utf8")).toBe("one\n");

    files[1] = { ...files[1], content: "two!\n" };
    const changed = syncOutput(files, previous);
    expect(changed).toEqual([files[1].path]);
    expect(fs.readFileSync(files[1].path, "utf8")).toBe("two!\n");
    expect(fs.readFileSync(files[0].path, "utf8")).toBe("one\n");

    syncOutput([files[0]], previous);
    expect(fs.existsSync(files[1].path)).toBe(false);
  });
});
