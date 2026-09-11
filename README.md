# vite-plugin-i18n-codegen

A [Vite](https://vite.dev) plugin that generates type-safe TypeScript translation files from flat JSON resources.

Write your translations as flat JSON files; the plugin generates per-locale modules plus a typed `index.ts` with a `Translations` type, `Locale` union, and a runtime `dictionary` - fully type-checked at build time.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { i18nCodegen } from "vite-plugin-i18n-codegen";

export default defineConfig({
  plugins: [i18nCodegen()],
});
```

## Features

- **Type-safe** - every translation becomes a function `(name: string) => string`. The compiler catches missing keys and mismatched placeholders.
- **Zero-config generation** - files are generated when Vite starts and regenerated on every JSON change during development (new files, edits, and deletions are all handled).
- **Errors in both the CLI and the browser overlay** - invalid JSON, nested values, invalid placeholders, and structural mismatches between locales fail loudly while you develop, and abort `vite build` with a clear message.
- **TypeScript only** - the output targets TS (uses `satisfies` and named types).

## Installation

```bash
pnpm add -D vite-plugin-i18n-codegen
```

## Options

| Option   | Type     | Default              | Description                                            |
| -------- | -------- | -------------------- | ------------------------------------------------------ |
| `srcDir` | `string` | `src/i18n/resources` | Directory containing the flat JSON translation files.  |
| `outDir` | `string` | `src/i18n`           | Directory where the generated `.ts` files are written. |

Both paths are resolved relative to the Vite root and can be overridden:

```ts
i18nCodegen({
  srcDir: "locales/translations",
  outDir: "src/generated/i18n",
});
```

## Usage

### 1. Write translation files

Create one JSON file per locale in `srcDir` (default `src/i18n/resources`):

<!-- prettier-ignore -->
```json
// src/i18n/resources/en_US.json
{
  "welcome": "Welcome, {name}!",
  "hello": "Hello, {firstName} {lastName}!",
  "greeting": "Hi there!"
}
```

```json
// src/i18n/resources/de.json
{
  "welcome": "Willkommen, {name}!",
  "hello": "Hallo, {firstName} {lastName}!",
  "greeting": "Hallo zusammen!"
}
```

### 2. Start or build the project

The plugin generates the following files in `outDir` (default `src/i18n`):

<!-- prettier-ignore -->
```ts
// src/i18n/index.ts
import de from "./de";
import en_US from "./en_US";

export type Locale = "de" | "en_US";
export type Translations = {
  welcome: (name: string) => string;
  hello: (firstName: string, lastName: string) => string;
  greeting: () => string;
};
export type Dictionary = Record<Locale, Translations>;

export const dictionary: Dictionary = { de: de, en_US: en_US };
```

<!-- prettier-ignore -->
```ts
// src/i18n/en_US.ts
import { Translations } from ".";

export default {
  welcome: (name: string) => `Welcome, ${name}!`,
  hello: (firstName: string, lastName: string) => `Hello, ${firstName} ${lastName}!`,
  greeting: () => `Hi there!`,
} satisfies Translations;
```

### 3. Use it

```ts
import { createSignal, type Component } from "solid-js";
import { dictionary, type Locale } from "./i18n";

export const App: Component = () => {
  const [lang] = createSignal<Locale>("en_US");
  const t = () => dictionary[lang()];
  return <h1>{t().welcome("John")}</h1>;
};
```

You can run `vite` in watch mode, edit a JSON resource, and the generated `.ts` files update automatically with HMR.

## How it works

### Placeholders

Every `{identifier}` in a translation value becomes a function parameter typed as `string`, and is interpolated into the generated template literal:

```ts
// "Welcome, {name}!"
(name: string) => `Welcome, ${name}!`;
```

- Parameters are collected in order of first appearance and de-duplicated.
- The first locale in alphabetical order (by file name) is the **reference** used to generate the `Translations` type; all other locales are checked against it via `satisfies`.

### Validation

The plugin reports an error in the terminal and the Vite error overlay (and aborts the build) when a source file has:

- invalid JSON,
- non-string values or nested objects (only flat string translations are supported),
- placeholders that are not valid identifiers (e.g. `{first name}`) or unmatched braces,
- keys missing from, or extra keys present in, another locale,
- placeholders that differ between locales for the same key,
- locale file names that collide after being converted to import identifiers.

### File naming

- The locale id is the file name without the `.json` extension (e.g. `en_US.json` -> `"en_US"`).
- Locale file names may only contain letters, numbers, and underscores (`[A-Za-z0-9_]+.json`). For example, `en_US.json` is valid and `en-US.json` is rejected.
- The import identifier is derived from the file name and sanitized if needed. A file name that collides with another locale after sanitization is rejected.

### Generated files

The output files are marked with a `/* Generated by vite-plugin-i18n-codegen - do not edit manually */` header, so they can be regenerated or deleted freely.

> A literal `${x}` in a source value is parsed as a `$` literal followed by the `{x}` placeholder, so `x` becomes a parameter. Escaping is applied correctly for anything else, including backticks, backslashes, and newlines.

## Development

```bash
pnpm install
pnpm test        # vitest unit + integration tests
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
pnpm format:check # oxfmt --check
pnpm build       # emit dist/
```

## License

MIT
