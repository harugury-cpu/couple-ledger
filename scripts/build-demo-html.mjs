// 공유용 데모를 서버 없이 열리는 HTML 한 장으로 묶는다. 실행: node scripts/build-demo-html.mjs [출력 경로]
// 실제 앱의 화면 코드(LedgerApp)를 DemoApp으로 감싸 쓰며, JS·CSS를 모두 안에 넣는다(글꼴만 Google Fonts).
import { build } from 'esbuild';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const out = process.argv[2] ?? '_scratch/demo-html/우리가계부-데모.html';
const migrations = readdirSync('migrations').filter(f => /^\d+_.+\.sql$/.test(f)).map(name => ({ name, sql: readFileSync(`migrations/${name}`, 'utf8') }));
const common = { bundle: true, minify: true, write: false, logLevel: 'warning' };
const js = await build({
  ...common, entryPoints: ['src/demo/standalone.tsx'], format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
  // sql.js의 Node 전용 분기(fs·path·crypto)는 브라우저에서 실행되지 않는다.
  external: ['fs', 'path', 'crypto', 'node:*'],
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.LEDGER_MIGRATIONS': JSON.stringify(JSON.stringify(migrations)) },
});
const css = await build({ ...common, entryPoints: ['src/app/globals.css'] });
const html = `<title>우리 가계부 데모</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;500;700&display=swap">
<style>:root{--font-sofia:"Sofia Sans";color-scheme:light}${css.outputFiles[0].text.replaceAll('</style', '<\\/style')}</style>
<div id="root"></div>
<script>${js.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html, 'utf8');
console.log(`${out} (${(html.length / 1024 / 1024).toFixed(2)}MB)`);
