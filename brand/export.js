const { chromium } = require('playwright');
(async () => {
  const [img, brand] = process.argv.slice(2);
  const b = await chromium.launch();
  async function shot(file, w, h, html, transparent) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('file://' + img + '/');
    await p.setContent(`<style>html,body{margin:0;width:${w}px;height:${h}px;${transparent ? '' : 'background:#000'}}</style>${html}`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(200);
    await p.screenshot({ path: file, omitBackground: !!transparent });
    await p.close();
  }
  const src = (n) => 'data:image/svg+xml;base64,' + require('fs').readFileSync(img + '/' + n).toString('base64');
  const fill = (n, pad = 0) => `<img src="${src(n)}" style="position:absolute;inset:${pad}px;width:calc(100% - ${2*pad}px);height:calc(100% - ${2*pad}px);object-fit:contain">`;
  // Para la app y el correo
  await shot(img + '/logos-email.png', 600, 263, fill('logos-transparente.svg', 0), true);
  await shot(img + '/icon-512.png', 512, 512, fill('victor-aguilar.svg', 28));
  await shot(img + '/icon-192.png', 192, 192, fill('victor-aguilar.svg', 10));
  await shot(img + '/apple-touch-icon.png', 180, 180, fill('victor-aguilar.svg', 10));
  // Kit de marca en alta resolución
  await shot(brand + '/victor-aguilar-2048.png', 2048, 2048, fill('victor-aguilar.svg'), true);
  await shot(brand + '/victor-aguilar-2048-fondo-negro.png', 2048, 2048, fill('victor-aguilar.svg', 120));
  await shot(brand + '/seimar-salon-2048.png', 2168, 2048, fill('seimar-salon.svg'), true);
  await shot(brand + '/seimar-salon-2048-fondo-negro.png', 2168, 2048, fill('seimar-salon.svg', 120));
  await shot(brand + '/logos-3000x1000-fondo-negro.png', 3000, 1000, fill('logos-transparente.svg', 60));
  await shot(brand + '/logos-transparente-2460x1080.png', 2460, 1080, fill('logos-transparente.svg'), true);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
