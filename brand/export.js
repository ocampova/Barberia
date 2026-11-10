// Genera los PNG de la app y del kit de marca a partir de los SVG.
// Uso: node brand/export.js   (requiere Playwright con Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const img = path.join(ROOT, 'public', 'img');
const out = path.join(ROOT, 'brand', 'png');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const src = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(f).toString('base64');
  async function shot(file, w, h, svgFile, { pad = 0, transparent = false } = {}) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<style>html,body{margin:0;width:${w}px;height:${h}px;${transparent ? '' : 'background:#000'}}</style>
      <img src="${src(svgFile)}" style="position:absolute;inset:${pad}px;width:calc(100% - ${2 * pad}px);height:calc(100% - ${2 * pad}px);object-fit:contain">`);
    await p.waitForTimeout(150);
    await p.screenshot({ path: file, omitBackground: transparent });
    await p.close();
  }
  const VA = path.join(img, 'victor-aguilar.svg'), SE = path.join(img, 'seimar-salon.svg'), BOTH = path.join(img, 'logos-transparente.svg');
  // App y correo
  await shot(path.join(img, 'logos-email.png'), 600, 306, BOTH, { transparent: true });
  await shot(path.join(img, 'icon-512.png'), 512, 512, VA);
  await shot(path.join(img, 'icon-192.png'), 192, 192, VA);
  await shot(path.join(img, 'apple-touch-icon.png'), 180, 180, VA);
  // Kit de marca
  await shot(path.join(out, 'victor-aguilar-2048.png'), 2048, 2048, VA, { transparent: true });
  await shot(path.join(out, 'victor-aguilar-2048-fondo-negro.png'), 2048, 2048, VA);
  await shot(path.join(out, 'seimar-salon-2048.png'), 2048, 2048, SE, { transparent: true });
  await shot(path.join(out, 'seimar-salon-2048-fondo-negro.png'), 2048, 2048, SE);
  await shot(path.join(out, 'logos-juntos-2352x1200.png'), 2352, 1200, BOTH, { transparent: true });
  await shot(path.join(out, 'banner-3000x1000-fondo-negro.png'), 3000, 1000, BOTH, { pad: 40 });
  await b.close();
  console.log('PNG generados en', out, 'y', img);
})().catch((e) => { console.error(e); process.exit(1); });
