// ============================================================================
// service-worker.js — Habilita que la app funcione SIN internet y sea
// instalable como PWA.
// ----------------------------------------------------------------------------
// Un Service Worker es un script que el navegador ejecuta "detrás" de la
// página, incluso cuando la pestaña está cerrada. Puede interceptar cada
// petición de red (fetch) que hace la app y decidir si responde con algo
// guardado en caché o si va a buscarlo a internet.
//
// Este archivo NO corre en el mismo contexto que app.js (no hay "window" ni
// acceso al DOM); corre en su propio hilo, por eso usa "self" en vez de
// "window" y trabaja con eventos (install, activate, fetch).
// ============================================================================

// Nombre de la caché. Cambiar este nombre (v1 -> v2) es la forma de forzar
// a que todos los usuarios descarguen los archivos de nuevo la próxima vez
// que abran la app (por ejemplo, después de que actualices el CSS o el JS).
// v11: se corrigió que la palabra "Recorrido" de la barra superior se
// viera negra en vez de blanca/clara: al volverla un <button> (para poder
// tocarla y recentrar el mapa) el navegador le puso su color de texto por
// defecto, y faltaba resetearlo con "color: inherit".
const CACHE_NAME = "recorrido-colima-v11";

// Lista de archivos que se descargan y se guardan en caché ANTES de que el
// usuario los pida, apenas se instala el Service Worker. Esto es lo que
// permite que la primera vez que se abre la app ya con conexión, luego se
// pueda usar sin internet.
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./data/secciones.geojson",
  "./data/distritos_locales.geojson",
  "./data/distritos_federales.geojson",
  "./data/mascara_colima.geojson",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/colima-logo.png",
  // También se cachean Leaflet (CSS y JS), que vienen de un CDN externo,
  // para que el mapa siga funcionando aunque no haya internet.
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
];

// Evento "install": se dispara una sola vez, cuando el navegador descubre
// este archivo por primera vez (o cuando cambia su contenido). Aquí se
// abre/crea la caché y se descargan todos los CORE_ASSETS.
self.addEventListener("install", (event) => {
  // event.waitUntil le dice al navegador "no termines la instalación hasta
  // que esta promesa se resuelva" — así no se marca como "listo" antes de
  // tiempo, con archivos a medio descargar.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        // cache.add(url) descarga la URL y la guarda. Si UNA falla (por
        // ejemplo, el CDN de Leaflet no responde en ese momento), se
        // atrapa el error individualmente para que no tumbe la instalación
        // completa: mejor que falte una cosa a que no se instale nada.
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn("No se pudo cachear:", url, err))
        )
      )
    )
  );
  // Hace que este Service Worker nuevo tome control inmediatamente, sin
  // esperar a que se cierren todas las pestañas viejas que tuvieran abierta
  // la versión anterior.
  self.skipWaiting();
});

// Evento "activate": se dispara después de "install", cuando el Service
// Worker ya está listo para tomar control de la página. Aquí se limpia
// cualquier caché "vieja" que haya quedado de una versión anterior de la
// app (por ejemplo, si CACHE_NAME cambió de v1 a v2).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim(); // aplica el control sobre las pestañas ya abiertas, sin recargar
});

// Evento "fetch": se dispara CADA VEZ que la app pide algo (un archivo, una
// imagen, el propio geojson, etc.). Aquí se decide cómo responder.
self.addEventListener("fetch", (event) => {
  // Solo se intercepta GET (lecturas). Peticiones POST/PUT, etc. se dejan
  // pasar normal, tal como las haría el navegador sin Service Worker.
  if (event.request.method !== "GET") return;

  event.respondWith(
    // Estrategia usada: "cache, luego red, y refresca la caché en segundo
    // plano" (stale-while-revalidate). Es un buen equilibrio para esta app:
    //   - Si ya está en caché, responde AL INSTANTE con eso (rápido, y
    //     funciona sin internet).
    //   - Al mismo tiempo, intenta ir a la red para traer la versión más
    //     reciente y actualizar la caché para la próxima vez.
    //   - Si no hay conexión, usa lo que ya tenía guardado (cached).
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          // Solo se guarda en caché si la respuesta fue exitosa (200 OK).
          if (response && response.status === 200) {
            const clone = response.clone(); // una respuesta solo se puede "leer" una vez, por eso se clona
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached); // si falla la red (sin internet), regresa lo que había en caché
      // Si ya había algo en caché, se devuelve inmediatamente (sin esperar
      // a la red); si no había nada, se espera la respuesta de red.
      return cached || network;
    })
  );
});
