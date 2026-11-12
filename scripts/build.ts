import { build } from "esbuild";

// One self-contained ESM file for `runs.using: node24`: the Action runs without npm install.
// Dynamic provider imports (llm-connect loads each AI SDK on demand) are inlined too.
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  minify: true,
  legalComments: "eof",
  logLevel: "info",
  // Some CommonJS dependencies call require(): give them one inside the ESM bundle.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  // Optional peers of llm-connect the Action never calls (browser speech, media, React).
  external: [
    "react",
    "onnxruntime-web",
    "@huggingface/transformers",
    "@ai-sdk/fal",
    "@ai-sdk/xai",
    "@ai-sdk/gateway",
    "@ai-sdk/replicate",
    "@ai-sdk/elevenlabs",
  ],
});
