import { defineConfig, type Plugin } from 'vite';

// The plugin's WebView must not depend on how it guesses the text encoding
// (Linux WebKit showed "Â·" for "·"): ship the built UI as pure ASCII.
const asciiHtml = (): Plugin => ({
  name: 'ascii-html',
  transformIndexHtml: { order: 'post', handler: (html) =>
    html.replace(/[^\x00-\x7f]/gu, (c) => `&#x${c.codePointAt(0)!.toString(16)};`) },
});

export default defineConfig({
  plugins: [asciiHtml()],
  worker: { format: 'es' },
  esbuild: { charset: 'ascii' },
  build: { target: 'es2022' },
});
