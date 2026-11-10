# Kit de marca

Logos oficiales de Víctor Aguilar Barbería y Seimar Salón.

## Fuente: `svg/`

Son los archivos que entregó el cliente. **No hay que editarlos a mano:** todo lo demás se genera a partir de ellos.

| Archivo | Para qué |
|---|---|
| `Victor_Aguilar.svg`, `Seimar.svg` | Con fondo negro |
| `Victor_Aguilar_transparente.svg`, `Seimar_transparente.svg` | Con fondo transparente (los que usa la app) |
| `logos-juntos-transparente.svg` | Los dos lado a lado (portada de la app y correos) |

## PNG generados: `png/`

| Archivo | Para qué |
|---|---|
| `*-2048.png` | Fondo transparente: redes y presentaciones |
| `*-2048-fondo-negro.png` | Foto de perfil de Instagram o WhatsApp |
| `logos-juntos-2352x1200.png` | Los dos juntos, transparente |
| `banner-3000x1000-fondo-negro.png` | Portada de redes |

Para regenerarlos, junto con los íconos de la app y el logo del correo:

```bash
node brand/export.js
```

Nota: los SVG dicen en su descripción que son una reconstrucción hecha a partir de una referencia de baja resolución. Si aparece el archivo del diseñador (`.ai`, `.eps` o `.pdf`), conviene usarlo para imprenta grande.
