import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('../dsp/worklet.js', import.meta.url), 'utf8');
if (src.includes('`') || src.includes('${')) throw new Error('worklet.js must not contain backticks or ${');
writeFileSync(new URL('../lib/s58Worklet.ts', import.meta.url),
  '// AUTO-GENERATED from dsp/worklet.js (npm run build:worklet). Do not edit by hand.\nexport const S58_WORKLET_SRC = String.raw`' + src + '`;\n');
console.log('lib/s58Worklet.ts written');
