# Kit de marca

Los logos de Víctor Aguilar Barbería y Seimar Salón, reconstruidos en vectores a partir de una imagen de 300×100 px.

| Archivo | Para qué |
|---|---|
| `victor-aguilar.svg`, `seimar-salon.svg` | Vectores: se ven nítidos a cualquier tamaño (web, imprenta, rótulos) |
| `logos-transparente.svg` | Los dos logos juntos, con fondo transparente |
| `*-2048.png` | PNG en alta resolución con fondo transparente (redes, presentaciones) |
| `*-fondo-negro.png` | Los mismos, sobre fondo negro (perfil de Instagram/WhatsApp) |
| `logos-3000x1000-fondo-negro.png` | Banner con los dos logos |

## Cómo se hicieron

- **Las tijeras y el perfil de Seimar** se vectorizaron a partir de la imagen original, ampliada y suavizada.
- **Los textos** se rehicieron con la tipografía **Montserrat** (de Google Fonts, licencia libre) convertida a trazos, con las mismas posiciones y espaciado del original.
- **El círculo y el óvalo** se trazaron como figuras geométricas exactas.

Es una reconstrucción fiel, pero no idéntica al archivo del diseñador. Si alguien tiene el archivo original (`.ai`, `.pdf`, `.eps` o `.svg`), conviene usar ese para imprenta grande.

Para regenerarlos: `build_logo.py` (necesita `vtracer`, `fonttools` y Pillow) y `export.js` (Playwright).
