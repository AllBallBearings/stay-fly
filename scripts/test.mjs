import { build } from 'vite';

// Bundle the actual TypeScript game modules with the same resolver used in production.
const result = await build({
  configFile: false,
  logLevel: 'error',
  build: {
    write: false,
    minify: false,
    rollupOptions: {
      input: 'tests/flight.test.ts',
      external: [/^node:/],
      output: { format: 'es', inlineDynamicImports: true },
    },
  },
});
const chunk = result.output.find((item) => item.type === 'chunk');
await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
