// Bundles the game into single self-contained HTML files (Three.js included).
//   dist/operation-dino-park.html  – page body for publishing as a claude.ai artifact (no doctype/head/body tags)
//   dist/standalone.html    – complete HTML file you can open directly from disk
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = await build({
  entryPoints: [path.join(root, 'js/main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  target: 'es2020',
  legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400&family=IBM+Plex+Mono:wght@400;600&display=swap">`;
// The CC0 models (Quaternius dinosaurs and plants, Kenney characters) are embedded so the page is one self-contained file.
const models = {};
for (const dir of ['assets/models/quaternius', 'assets/models/quaternius-nature', 'assets/models/quaternius-people', 'assets/models/quaternius-farm']) {
  const d = path.join(root, dir);
  for (const f of fs.readdirSync(d)) if (f.endsWith('.glb')) models[f.replace('.glb', '')] = fs.readFileSync(path.join(d, f)).toString('base64');
}
const modelScript = `<script>window.DINOPARK_MODELS=${JSON.stringify(models)};</script>`;
const body = `${modelScript}
<canvas id="c" tabindex="0" aria-label="Operation Dino Park park view"></canvas>
<div id="ui"></div>
<div id="loading">Loading Operation Dino Park…</div>
<script type="module">
${js}
</script>`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const artifact = `<title>Operation Dino Park</title>
${fonts}
<style>
${css}
</style>
${body}
`;
fs.writeFileSync(path.join(root, 'dist/operation-dino-park.html'), artifact);
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Operation Dino Park</title>
${fonts}
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'dist/standalone.html'), standalone);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/operation-dino-park.html ${kb(artifact)}\ndist/standalone.html ${kb(standalone)}`);
