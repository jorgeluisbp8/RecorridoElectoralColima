# Recorrido Electoral · Colima

PWA para marcar qué secciones electorales de Colima ya fueron visitadas en campo, sobre un mapa con distritos locales, distritos federales y las 430 secciones del estado.

## Qué incluye
- `data/secciones.geojson` — 430 secciones electorales de Colima, convertidas de UTM zona 13N (datos originales del INE) a WGS84 (lat/lon).
- `data/distritos_locales.geojson` — 16 distritos locales (IEEC Colima).
- `data/distritos_federales.geojson` — 2 distritos federales (INE).
- `data/mascara_colima.geojson` — polígono usado para tapar visualmente todo lo que está fuera del estado (ver más abajo).
- `data/colima_bounds.geojson` — el contorno real del estado (sin la máscara), por si se necesita como referencia.
- Mapa interactivo (Leaflet), restringido al territorio de Colima: no se puede alejar el zoom ni arrastrar el mapa fuera del estado, y todo lo de alrededor (otros estados, el mar) aparece cubierto con un color liso en vez del mapa de calles.
- Toca una sección para abrir un selector y calificarla como **🟢 alta**, **🟡 media** o **🔴 baja** aprobación (o quitar la marca).
- Lo mismo se puede hacer directo desde la lista de secciones (botón "Secciones" en la barra de filtros), tocando el punto de color correspondiente en cada fila.
- Filtro por distrito local y por nivel (todas / alta / media / baja / sin marcar).
- Lista buscable de secciones en un panel que se abre/cierra sobre el mapa (no ocupa espacio permanente, así el mapa siempre se ve grande), con conteo por color junto a la leyenda.
- Contador de avance (secciones calificadas / total).
- Footer con crédito de autoría.
- El avance se guarda en el propio dispositivo (localStorage) — funciona sin internet una vez cargada.
- Exportar/importar el avance como archivo `.json` (respaldo o pasar el progreso a otro dispositivo/persona).
- Instalable como app (PWA) con ícono propio, y funciona offline gracias al service worker.

## Probarla en tu computadora
No necesitas instalar nada además de Python (ya viene en Mac/Linux; en Windows instala Python o usa otro servidor estático).

```bash
cd recorrido-colima-pwa
python3 -m http.server 8080
```

Abre `http://localhost:8080` en el navegador. En `localhost` el Service Worker y la instalación como PWA funcionan igual que en producción.

## Publicarla para usarla en el celular
Un PWA necesita estar servido por HTTPS (excepto en localhost) para poder instalarse. Opciones gratuitas y sencillas, subiendo la carpeta completa tal cual:

- **Netlify** (netlify.com) — arrastra la carpeta a "Deploys" (Netlify Drop).
- **Vercel** (vercel.com) — `vercel deploy` desde la carpeta, o conectar un repo.
- **GitHub Pages** — sube la carpeta a un repositorio y activa Pages.

Una vez publicada, entra a la URL desde tu celular (Chrome en Android o Safari en iOS) y usa "Agregar a pantalla de inicio" / el aviso de instalación.

## Notas sobre los datos
- El campo `seccion` es el identificador único de cada sección dentro del estado (no se repite entre municipios), y es lo que se usa como llave para guardar el avance.
- **Mapeo de municipios**: el campo `municipio` en los datos originales del INE es un código numérico (1-10) que NO sigue el orden alfabético estándar de INEGI. El mapeo correcto (verificado comparando el centroide geográfico de las secciones de cada código contra la ubicación real de cada cabecera municipal) es:
  ```
  1 = Colima          6 = Armería
  2 = Comala          7 = Ixtlahuacán
  3 = Coquimatlán     8 = Manzanillo
  4 = Cuauhtémoc      9 = Minatitlán
  5 = Villa de Álvarez   10 = Tecomán
  ```
  Este mapeo ya está aplicado en `data/secciones.geojson` (campo `municipio_nombre`). Si alguna vez regeneras este archivo desde un `.shp` nuevo del INE, usa esta tabla — no la alfabética.
- Una sección (municipio 8, Manzanillo) incluye un polígono muy alejado en el mapa: corresponde a territorio insular (Islas Revillagigedo) asignado en la capa original. El encuadre inicial del mapa lo ignora para no forzar el zoom; sigue estando en los datos si algún día lo necesitas.
- Si el INE actualiza su cartografía (por ejemplo tras una redistritación), puedes repetir el proceso de descarga + conversión con los mismos scripts para regenerar los archivos `.geojson` — solo recuerda volver a aplicar (o verificar) el mapeo de municipios de arriba, ya que el orden de los códigos podría no ser el mismo en un archivo nuevo.
- **`mascara_colima.geojson`**: se calculó reconstruyendo el contorno real del estado a partir de los propios bordes de las 430 secciones (los bordes que comparten dos secciones vecinas se cancelan entre sí; los que quedan sueltos son, por definición, el borde exterior del estado). Es un polígono con un "agujero": un rectángulo que cubre todo el mundo, con el hueco justo en la silueta de Colima. Si algún día cambian los límites de las secciones, hay que recalcular este archivo con el mismo método para que la máscara siga coincidiendo exactamente con el borde real.

## Si actualizas el código y no ves los cambios (caché del Service Worker)
Esta app guarda sus archivos en caché para funcionar sin internet, lo que
significa que después de la primera vez que la abres, el navegador puede
seguir mostrando una versión vieja aunque ya hayas reemplazado los archivos.
Si edita el código y no ves el cambio reflejado:

1. En `service-worker.js`, sube el número de `CACHE_NAME` (por ejemplo de
   `"recorrido-colima-v2"` a `"...-v3"`). Esto obliga a descargar todo de
   nuevo y borra la caché vieja.
2. Haz un refresco forzado en el navegador: **Cmd+Shift+R** (Mac) o
   **Ctrl+Shift+R** (Windows/Linux).
3. Si aun así no se actualiza: abre las herramientas de desarrollador →
   pestaña "Application" (Chrome) o "Almacenamiento" (Firefox) → Service
   Workers → "Unregister", y recarga la página.

## Personalizar
- Colores y tipografías: `styles.css` (variables al inicio del archivo).
- Lógica de mapa/filtros/almacenamiento: `app.js`.
- Nombre, ícono y colores de instalación: `manifest.webmanifest` y `icons/`.
