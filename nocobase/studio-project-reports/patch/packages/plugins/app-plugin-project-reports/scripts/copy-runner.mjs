import { cp, mkdir } from 'node:fs/promises';
await mkdir(new URL('../dist/runner/', import.meta.url), { recursive: true });
await cp(new URL('../runner/', import.meta.url), new URL('../dist/runner/', import.meta.url), { recursive: true });
