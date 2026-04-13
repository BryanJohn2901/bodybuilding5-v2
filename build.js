const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { minify: minifyHtml } = require('html-minifier-terser');
const { minify: minifyJs } = require('terser');

const ROOT = path.resolve(__dirname);
const DIST = path.join(ROOT, 'dist');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function cleanDist() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  ensureDir(path.join(DIST, 'assets'));
  ensureDir(path.join(DIST, 'css'));
  ensureDir(path.join(DIST, 'js'));
}

function copyAssets() {
  const imgSrc = path.join(ROOT, 'img');
  const assetsDest = path.join(DIST, 'assets');

  if (!fs.existsSync(imgSrc)) return;

  const entries = fs.readdirSync(imgSrc, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(imgSrc, entry.name);
    const destPath = path.join(assetsDest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function buildTailwind() {
  const outputCss = path.join(DIST, 'css', 'main.css');
  execSync(
    `npx tailwindcss -i "${path.join(ROOT, 'src', 'input.css')}" -o "${outputCss}" --minify`,
    { cwd: ROOT, stdio: 'inherit' }
  );

  // Corrige URLs relativas do CSS gerado para a estrutura dist/css -> dist/assets
  const css = fs.readFileSync(outputCss, 'utf8');
  const rewrittenCss = css
    .replace(/url\((['"]?)\.\.\/img\//g, 'url($1../assets/')
    .replace(/url\((['"]?)img\//g, 'url($1../assets/');
  fs.writeFileSync(outputCss, rewrittenCss, 'utf8');
}

async function buildHtmlAndJs() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const tailwindBlock = /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*<script>[\s\S]*?<\/script>\s*<style>[\s\S]*?<\/style>/i;
  html = html.replace(tailwindBlock, '<link rel="stylesheet" href="css/main.css">');

  const inlineScriptRegex = /<script src="https:\/\/unpkg\.com\/aos@2\.3\.1\/dist\/aos\.js"><\/script>\s*<script>([\s\S]*?)<\/script>\s*<\/body>/;
  const inlineScriptMatch = html.match(inlineScriptRegex);
  if (!inlineScriptMatch) {
    throw new Error('Script inline não encontrado no HTML.');
  }

  const inlineScriptCode = inlineScriptMatch[1].trim();
  const minifiedJs = await minifyJs(inlineScriptCode, {
    compress: { passes: 2, keep_fnames: true, drop_console: false },
    mangle: false,
    format: { comments: false },
  });

  if (minifiedJs.code === undefined) {
    throw new Error('Terser falhou: ' + (minifiedJs.error && minifiedJs.error.message));
  }

  fs.writeFileSync(path.join(DIST, 'js', 'main.js'), minifiedJs.code, 'utf8');

  html = html.replace(
    inlineScriptRegex,
    '<script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script>\n<script src="js/main.js" defer></script>\n</body>'
  );

  html = html.replace(/(?:src|href)="img\//g, (match) => match.replace('img/', 'assets/'));

  const minifiedHtml = await minifyHtml(html, {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    conservativeCollapse: false,
    decodeEntities: true,
    minifyCSS: true,
    minifyJS: false,
    removeComments: true,
    removeEmptyAttributes: true,
    removeRedundantAttributes: true,
    sortClassName: false,
    sortAttributes: false,
    ignoreCustomComments: [/^!/],
  });

  fs.writeFileSync(path.join(DIST, 'index.html'), minifiedHtml, 'utf8');
}

function reportSizes() {
  console.log('\n📦 Build output:');
  console.log('─'.repeat(50));

  const htmlSize = fs.statSync(path.join(DIST, 'index.html')).size;
  const cssSize = fs.statSync(path.join(DIST, 'css', 'main.css')).size;
  const jsSize = fs.statSync(path.join(DIST, 'js', 'main.js')).size;

  console.log(`  index.html   → ${formatBytes(htmlSize)}`);
  console.log(`  css/main.css → ${formatBytes(cssSize)}`);
  console.log(`  js/main.js   → ${formatBytes(jsSize)}`);

  let assetsTotal = 0;
  const walkDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else assetsTotal += fs.statSync(full).size;
    }
  };

  walkDir(path.join(DIST, 'assets'));
  console.log(`  assets/      → ${formatBytes(assetsTotal)}`);
  console.log('─'.repeat(50));
  console.log(`  Total dist   → ${formatBytes(htmlSize + cssSize + jsSize + assetsTotal)}`);
}

async function main() {
  const start = Date.now();

  console.log('🧹 Limpando dist...');
  cleanDist();

  console.log('📁 Copiando assets para dist/assets/...');
  copyAssets();

  console.log('🎨 Gerando CSS com Tailwind (purge + minify)...');
  buildTailwind();

  console.log('⚙️  Processando HTML e JS...');
  await buildHtmlAndJs();

  reportSizes();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ Build concluído em ${elapsed}s — dist/ pronta para deploy.`);
}

main().catch((err) => {
  console.error('❌ Build falhou:', err);
  process.exit(1);
});
