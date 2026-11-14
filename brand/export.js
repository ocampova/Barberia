// Genera las imágenes de cada negocio a partir de su logo SVG:
//   public/img/negocios/<slug>/{icon-192,icon-512,apple-touch-icon,email}.png
// y el kit de marca en brand/png/.
// Uso: node brand/export.js   (requiere Playwright con Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { negocios } = require(path.join(ROOT, 'server', 'negocios'));
const out = path.join(ROOT, 'brand', 'png');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const src = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(f).toString('base64');
  async function shot(file, w, h, svgFile, { pad = 0, transparent = false, bg = '#0b0a09' } = {}) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<style>html,body{margin:0;width:${w}px;height:${h}px;${transparent ? '' : 'background:' + bg}}</style>
      <img src="${src(svgFile)}" style="position:absolute;inset:${pad}px;width:calc(100% - ${2 * pad}px);height:calc(100% - ${2 * pad}px);object-fit:contain">`);
    await p.waitForTimeout(150);
    await p.screenshot({ path: file, omitBackground: transparent });
    await p.close();
  }
  for (const n of negocios) {
    const dir = path.join(ROOT, 'public', 'img', 'negocios', n.slug);
    const logo = path.join(ROOT, 'public', n.logos.main);
    // Íconos de la app (con el fondo del negocio) y logo para los correos (transparente)
    const bg = n.theme.palette?.bg || '#0b0a09';
    await shot(path.join(dir, 'icon-512.png'), 512, 512, logo, { pad: 24, bg });
    await shot(path.join(dir, 'icon-192.png'), 192, 192, logo, { pad: 8, bg });
    await shot(path.join(dir, 'apple-touch-icon.png'), 180, 180, logo, { pad: 8, bg });
    await shot(path.join(dir, 'email.png'), 280, 280, logo, { transparent: true });
    // Kit de marca
    await shot(path.join(out, `${n.slug}-2048.png`), 2048, 2048, logo, { transparent: true });
    await shot(path.join(out, `${n.slug}-2048-fondo-negro.png`), 2048, 2048, logo, { pad: 120 });
    console.log(`✓ ${n.name}`);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
