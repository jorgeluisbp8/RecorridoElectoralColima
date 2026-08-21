// ============================================================================
// app.js — Lógica completa de la app "Recorrido Electoral · Colima"
// ----------------------------------------------------------------------------
// Qué hace este archivo:
//   1) Carga los 3 archivos .geojson (secciones, distritos locales y
//      federales) y los dibuja sobre un mapa Leaflet.
//   2) Guarda en el navegador (localStorage) el "nivel de aprobación" de
//      cada sección: sin marcar, verde (alta), amarillo (media) o rojo
//      (baja).
//   3) Sincroniza ese estado entre el mapa, el contador de arriba y la
//      lista del panel inferior.
//   4) Conecta los botones de la interfaz (filtros, exportar/importar,
//      ubicarme, menú) con la lógica de arriba.
//
// No usa ningún framework (React, Vue, etc.) — es JavaScript "vanilla" que
// manipula el DOM directamente, y usa Leaflet (cargado en index.html vía
// CDN) para el mapa.
// ============================================================================

(function () {
  "use strict";

  // --------------------------------------------------------------------
  // CONSTANTES DE CONFIGURACIÓN
  // --------------------------------------------------------------------

  // Llave de localStorage. Es DISTINTA a la versión anterior
  // ("colima_visitas_v1") porque el modelo de datos cambió: antes se
  // guardaba un Set de secciones "visitadas" (sí/no); ahora se guarda un
  // color por sección. Usar una llave nueva evita mezclar datos viejos con
  // un formato que ya no aplica.
  const STORAGE_KEY = "colima_aprobacion_v1";

  // Los 3 niveles válidos, en el orden en que se muestran en la leyenda y
  // en los botones de selección. "" (vacío) representa "sin marcar" y NO
  // se guarda explícitamente — si una sección no aparece en el objeto
  // guardado, se asume sin marcar.
  const NIVELES = ["verde", "amarillo", "rojo"];

  // Colores y etiquetas de cada nivel, centralizados aquí para que el resto
  // del código (estilos del mapa, leyenda, botones) lean de un solo lugar
  // en vez de repetir valores sueltos.
  const NIVEL_INFO = {
    verde: { label: "Alta aprobación", fill: "#3F6B4F", stroke: "#2F5A3C" },
    amarillo: { label: "Aprobación media", fill: "#C9A227", stroke: "#96791A" },
    rojo: { label: "Baja aprobación", fill: "#A3352F", stroke: "#7C2823" },
  };
  const SIN_MARCAR_FILL = "#D8D2BC";
  const SIN_MARCAR_STROKE = "#8A8367";

  const COLIMA_CENTER = [19.05, -103.95]; // vista inicial antes de cargar datos reales
  const COLIMA_ZOOM = 10;

  /** ---------------------------------------------------------------------
   *  ESTADO EN MEMORIA
   *  ------------------------------------------------------------------ */

  // Map de "número de sección" (como texto) -> "verde" | "amarillo" | "rojo".
  // Una sección que NO está en este Map se considera "sin marcar". Se usa
  // un Map (no un objeto {}) porque es más cómodo iterar y consultar.
  let aprobaciones = loadAprobaciones();

  let secciones = null;          // FeatureCollection con las 430 secciones
  let distritosLocales = null;   // FeatureCollection con los 16 distritos locales
  let distritosFederales = null; // FeatureCollection con los 2 distritos federales

  // Diccionario "número de sección" -> "capa de Leaflet en el mapa", para
  // repintar rápido un solo polígono sin recorrer los 430.
  let secLayerById = new Map();

  let currentDistrito = "";        // "" = todos los distritos locales
  let currentStatusFilter = "all"; // "all" | "sin_marcar" | "verde" | "amarillo" | "rojo"
  let fedVisible = false;          // ¿se están mostrando los distritos federales?

  /** ---------------------------------------------------------------------
   *  PERSISTENCIA
   *  ------------------------------------------------------------------ */

  // Lee el progreso guardado. En localStorage se guarda como un objeto
  // plano de JavaScript (JSON), por ejemplo: {"12": "verde", "87": "rojo"}.
  // Aquí se convierte a un Map porque es más práctico de usar en el resto
  // del código (aprobaciones.get(id), aprobaciones.set(id, color)).
  function loadAprobaciones() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Map();
      const obj = JSON.parse(raw);
      return new Map(Object.entries(obj));
    } catch (e) {
      return new Map();
    }
  }

  // Convierte el Map de vuelta a objeto plano y lo guarda como texto JSON.
  function saveAprobaciones() {
    try {
      const obj = Object.fromEntries(aprobaciones);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      showToast("No se pudo guardar (almacenamiento lleno o bloqueado)");
    }
  }

  /** ---------------------------------------------------------------------
   *  CONFIGURACIÓN DEL MAPA (Leaflet)
   *  ------------------------------------------------------------------ */

  const map = L.map("map", {
    zoomControl: false,
    attributionControl: true,
  }).setView(COLIMA_CENTER, COLIMA_ZOOM);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
  }).addTo(map);

  const secLayerGroup = L.layerGroup().addTo(map);
  const distLocalLayerGroup = L.layerGroup().addTo(map);
  const distFedLayerGroup = L.layerGroup(); // se agrega/quita del mapa al activar el chip

  /** ---------------------------------------------------------------------
   *  ESTILOS VISUALES DE LOS POLÍGONOS
   *  ------------------------------------------------------------------ */

  // Devuelve el estilo (borde/relleno) de UNA sección según su nivel
  // guardado. Si no tiene nivel asignado, usa los colores "sin marcar".
  function seccionStyle(feature) {
    const nivel = aprobaciones.get(String(feature.properties.seccion));
    const info = NIVEL_INFO[nivel];
    return {
      color: info ? info.stroke : SIN_MARCAR_STROKE,
      weight: 1,
      fillColor: info ? info.fill : SIN_MARCAR_FILL,
      fillOpacity: info ? 0.62 : 0.35,
    };
  }

  function distritoLocalStyle() {
    return { color: "#B4502E", weight: 2, fill: false, dashArray: "4 3", opacity: 0.55 };
  }
  function distritoFederalStyle() {
    return { color: "#23261F", weight: 2, fill: false, dashArray: "1 5", opacity: 0.6 };
  }

  /** ---------------------------------------------------------------------
   *  CARGA DE DATOS
   *  ------------------------------------------------------------------ */

  Promise.all([
    fetch("data/secciones.geojson").then((r) => r.json()),
    fetch("data/distritos_locales.geojson").then((r) => r.json()),
    fetch("data/distritos_federales.geojson").then((r) => r.json()),
  ])
    .then(([secGeo, distLocGeo, distFedGeo]) => {
      secciones = secGeo;
      distritosLocales = distLocGeo;
      distritosFederales = distFedGeo;
      init();
    })
    .catch((err) => {
      console.error(err);
      showToast("No se pudieron cargar los datos del mapa");
    });

  function init() {
    buildDistritoSelect();
    renderDistritosLocales();
    renderDistritosFederales();
    renderSecciones();
    updateTally();
    renderList();
    fitToMainland();
  }

  // Encuadre inicial del mapa, ignorando el polígono insular (Islas
  // Revillagigedo) que viene muy al oeste en los datos del INE.
  function fitToMainland() {
    const bounds = L.latLngBounds([]);
    secciones.features.forEach((f) => {
      const b = L.geoJSON(f).getBounds();
      if (b.getWest() > -105) bounds.extend(b);
    });
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.04));
  }

  /** ---------------------------------------------------------------------
   *  SELECTOR DE DISTRITO
   *  ------------------------------------------------------------------ */

  function buildDistritoSelect() {
    const select = document.getElementById("distritoSelect");
    const ids = distritosLocales.features
      .map((f) => f.properties.distrito_l)
      .sort((a, b) => a - b);
    ids.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = "Distrito " + id;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      currentDistrito = select.value;
      renderSecciones();
      renderList();
      updateTally();
      zoomToDistrito();
    });
  }

  function zoomToDistrito() {
    if (!currentDistrito) {
      fitToMainland();
      return;
    }
    const feat = distritosLocales.features.find(
      (f) => String(f.properties.distrito_l) === String(currentDistrito)
    );
    if (feat) map.fitBounds(L.geoJSON(feat).getBounds().pad(0.08));
  }

  /** ---------------------------------------------------------------------
   *  DIBUJO DE CAPAS
   *  ------------------------------------------------------------------ */

  function renderDistritosLocales() {
    L.geoJSON(distritosLocales, { style: distritoLocalStyle }).addTo(distLocalLayerGroup);
  }
  function renderDistritosFederales() {
    L.geoJSON(distritosFederales, { style: distritoFederalStyle }).addTo(distFedLayerGroup);
  }

  // Decide si una sección pasa los filtros activos (distrito + estado).
  function seccionMatchesFilters(props) {
    if (currentDistrito && String(props.distrito_l) !== String(currentDistrito)) return false;
    const nivel = aprobaciones.get(String(props.seccion)) || "sin_marcar";
    if (currentStatusFilter !== "all" && currentStatusFilter !== nivel) return false;
    return true;
  }

  // Redibuja TODOS los polígonos de sección visibles según los filtros
  // actuales (se llama al cambiar un filtro, o cuando marcar/quitar un
  // color puede hacer que una sección tenga que aparecer/desaparecer).
  function renderSecciones() {
    secLayerGroup.clearLayers();
    secLayerById.clear();

    secciones.features.forEach((feature) => {
      const props = feature.properties;
      if (!seccionMatchesFilters(props)) return;

      const layer = L.geoJSON(feature, { style: seccionStyle }).getLayers()[0];

      layer.bindTooltip(() => tooltipHtml(props), {
        sticky: true,
        direction: "top",
        className: "seccion-tt",
      });

      // Al tocar un polígono, en vez de alternar un solo estado (como en
      // la versión anterior), se abre un pequeño popup con 4 botones
      // (verde / amarillo / rojo / quitar marca) en el punto exacto donde
      // se tocó, para que el usuario elija directamente el color.
      layer.on("click", (e) => openColorPicker(props.seccion, e.latlng));

      secLayerGroup.addLayer(layer);
      secLayerById.set(String(props.seccion), layer);
    });
  }

  function tooltipHtml(props) {
    const nivel = aprobaciones.get(String(props.seccion));
    const info = NIVEL_INFO[nivel];
    const secStr = String(props.seccion).padStart(4, "0");
    const estado = info ? info.label : "Sin marcar";
    return `<strong>Sección ${secStr}</strong><br>${props.municipio_nombre} · Distrito ${props.distrito_l}<br>${estado}`;
  }

  /** ---------------------------------------------------------------------
   *  SELECTOR DE COLOR (popup del mapa)
   *  ------------------------------------------------------------------ */

  // Arma el HTML de los 4 botones del popup. Cada botón lleva en
  // data-color el valor a asignar ("verde"/"amarillo"/"rojo", o ""
  // para "quitar marca"). El contenedor guarda en data-seccion el número
  // de sección al que aplican estos botones — así un solo listener
  // "delegado" (ver más abajo, en la sección de wiring) puede atender
  // clics de CUALQUIER popup sin tener que crear un listener por cada uno.
  function colorPickerHtml(seccionId) {
    const secStr = String(seccionId).padStart(4, "0");
    return `
      <div class="color-picker" data-seccion="${seccionId}">
        <div class="color-picker-title">Sección ${secStr}</div>
        <button data-color="verde" class="cp-btn cp-verde">🟢 Alta</button>
        <button data-color="amarillo" class="cp-btn cp-amarillo">🟡 Media</button>
        <button data-color="rojo" class="cp-btn cp-rojo">🔴 Baja</button>
        <button data-color="" class="cp-btn cp-quitar">✖ Quitar marca</button>
      </div>
    `;
  }

  function openColorPicker(seccionId, latlng) {
    L.popup({ closeButton: false, className: "cp-popup" })
      .setLatLng(latlng)
      .setContent(colorPickerHtml(seccionId))
      .openOn(map);
  }

  // Aplica (o quita) un nivel a una sección y refresca todo lo que depende
  // de ese dato: guardado, color en el mapa, contador y lista. Es la
  // función central de la app (equivalente a "toggleSeccion" en la
  // versión anterior, pero ahora recibe el color elegido en vez de
  // alternar un único booleano).
  function setNivel(seccionId, nivel) {
    const key = String(seccionId);
    if (nivel) {
      aprobaciones.set(key, nivel);
    } else {
      aprobaciones.delete(key); // "" o null => quitar marca
    }
    saveAprobaciones();

    const layer = secLayerById.get(key);
    if (layer) layer.setStyle(seccionStyle({ properties: findSeccionProps(key) }));

    // Si hay un filtro de estado activo, esta sección puede tener que
    // aparecer/desaparecer del conjunto visible.
    if (currentStatusFilter !== "all") renderSecciones();

    updateTally();
    renderList(document.getElementById("searchInput").value);
  }

  function findSeccionProps(seccionId) {
    const f = secciones.features.find((f) => String(f.properties.seccion) === String(seccionId));
    return f ? f.properties : {};
  }

  /** ---------------------------------------------------------------------
   *  CONTADOR DE AVANCE ("tally" en la barra superior)
   *  ------------------------------------------------------------------ */

  // Ahora el contador muestra "marcadas / total" (marcada = tiene
  // cualquiera de los 3 colores asignado, sin importar cuál).
  function updateTally() {
    const visibleIds = secciones.features
      .filter((f) => !currentDistrito || String(f.properties.distrito_l) === String(currentDistrito))
      .map((f) => String(f.properties.seccion));
    const total = visibleIds.length;
    const marcadas = visibleIds.filter((id) => aprobaciones.has(id)).length;

    document.getElementById("tallyVisited").textContent = String(marcadas).padStart(3, "0");
    document.getElementById("tallyTotal").textContent = String(total).padStart(3, "0");

    const tally = document.getElementById("tally");
    tally.classList.add("bump");
    setTimeout(() => tally.classList.remove("bump"), 250);

    // Actualiza también el pequeño desglose por color (🟢 x  🟡 x  🔴 x)
    // que se muestra junto a la leyenda.
    const counts = { verde: 0, amarillo: 0, rojo: 0 };
    visibleIds.forEach((id) => {
      const n = aprobaciones.get(id);
      if (n) counts[n]++;
    });
    document.getElementById("countVerde").textContent = counts.verde;
    document.getElementById("countAmarillo").textContent = counts.amarillo;
    document.getElementById("countRojo").textContent = counts.rojo;
  }

  /** ---------------------------------------------------------------------
   *  LISTA DE SECCIONES (panel inferior)
   *  ------------------------------------------------------------------ */

  function renderList(filterText) {
    const listEl = document.getElementById("sectionList");
    const titleEl = document.getElementById("sheetTitle");
    const subEl = document.getElementById("sheetSub");

    let feats = secciones.features.filter((f) => seccionMatchesFilters(f.properties));

    if (filterText) {
      const q = filterText.trim().replace(/^0+/, "");
      feats = feats.filter((f) => String(f.properties.seccion).includes(q));
    }
    feats = feats.slice().sort((a, b) => a.properties.seccion - b.properties.seccion);

    titleEl.textContent = currentDistrito ? "Distrito " + currentDistrito : "Todas las secciones";
    subEl.textContent = feats.length + (feats.length === 1 ? " sección" : " secciones");

    listEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    feats.forEach((f) => {
      const p = f.properties;
      const key = String(p.seccion);
      const nivelActual = aprobaciones.get(key) || "";

      const li = document.createElement("li");
      // Cada fila trae sus propios 4 botones de color (mismos 3 niveles +
      // quitar), igual que el popup del mapa, pero visibles directo en la
      // lista para poder calificar muchas secciones rápido sin abrir el
      // mapa. El botón del nivel activo se resalta con la clase "is-active".
      li.innerHTML = `
        <div class="sec-info">
          <span class="sec-num">Sección ${key.padStart(4, "0")}</span>
          <span class="sec-muni">${p.municipio_nombre} · Distrito ${p.distrito_l}</span>
        </div>
        <div class="sec-colors" data-seccion="${key}">
          <button data-color="verde" class="dotbtn dotbtn-verde ${nivelActual === "verde" ? "is-active" : ""}" aria-label="Alta aprobación" title="Alta aprobación"></button>
          <button data-color="amarillo" class="dotbtn dotbtn-amarillo ${nivelActual === "amarillo" ? "is-active" : ""}" aria-label="Aprobación media" title="Aprobación media"></button>
          <button data-color="rojo" class="dotbtn dotbtn-rojo ${nivelActual === "rojo" ? "is-active" : ""}" aria-label="Baja aprobación" title="Baja aprobación"></button>
        </div>
      `;
      frag.appendChild(li);
    });
    listEl.appendChild(frag);
  }

  /** ---------------------------------------------------------------------
   *  DELEGACIÓN DE CLICS PARA LOS BOTONES DE COLOR
   *  ---------------------------------------------------------------------
   *  Tanto el popup del mapa como cada fila de la lista generan sus
   *  botones de color dinámicamente (con innerHTML), así que en vez de
   *  agregar un listener a cada botón individual (habría que rehacerlo
   *  cada vez que se redibuja la lista o se abre un popup nuevo), se pone
   *  UN SOLO listener en un ancestro fijo que nunca se destruye
   *  (document.body) y se revisa, en cada clic, si el elemento tocado fue
   *  uno de estos botones. Esto se llama "delegación de eventos".
   *  ------------------------------------------------------------------ */
  document.body.addEventListener("click", (e) => {
    // Clic en un botón del POPUP del mapa (clase .cp-btn dentro de .color-picker).
    const cpBtn = e.target.closest(".color-picker .cp-btn");
    if (cpBtn) {
      const seccionId = cpBtn.closest(".color-picker").dataset.seccion;
      setNivel(seccionId, cpBtn.dataset.color);
      map.closePopup();
      return;
    }
    // Clic en un botón de color de una FILA de la lista (clase .dotbtn
    // dentro de .sec-colors). Si se toca el color que ya estaba activo,
    // se interpreta como "quitar marca" (para poder desmarcar sin abrir
    // el mapa); si se toca otro color, simplemente lo reemplaza.
    const dotBtn = e.target.closest(".sec-colors .dotbtn");
    if (dotBtn) {
      const seccionId = dotBtn.closest(".sec-colors").dataset.seccion;
      const yaActivo = dotBtn.classList.contains("is-active");
      setNivel(seccionId, yaActivo ? "" : dotBtn.dataset.color);
    }
  });

  /** ---------------------------------------------------------------------
   *  CONEXIÓN DE BOTONES Y CONTROLES DE LA INTERFAZ
   *  ------------------------------------------------------------------ */

  document.getElementById("statusFilter").addEventListener("change", (e) => {
    currentStatusFilter = e.target.value;
    renderSecciones();
    renderList(document.getElementById("searchInput").value);
  });

  document.getElementById("searchInput").addEventListener("input", (e) => {
    renderList(e.target.value);
  });

  document.getElementById("fedToggleBtn").addEventListener("click", (e) => {
    fedVisible = !fedVisible;
    e.target.setAttribute("aria-pressed", String(fedVisible));
    if (fedVisible) distFedLayerGroup.addTo(map);
    else map.removeLayer(distFedLayerGroup);
  });

  const sheet = document.getElementById("sheet");
  const sheetHandle = document.getElementById("sheetHandle");
  sheetHandle.addEventListener("click", () => {
    const expanded = sheet.classList.toggle("sheet-expanded");
    sheet.classList.toggle("sheet-collapsed", !expanded);
    sheetHandle.setAttribute("aria-expanded", String(expanded));
  });

  document.getElementById("locateBtn").addEventListener("click", () => {
    if (!navigator.geolocation) {
      showToast("Geolocalización no disponible en este dispositivo");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        map.setView(ll, 15);
        L.circleMarker(ll, { radius: 7, color: "#B4502E", fillColor: "#B4502E", fillOpacity: 0.9 }).addTo(map);
      },
      () => showToast("No se pudo obtener tu ubicación"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  /** ---------------------------------------------------------------------
   *  PANEL DE MENÚ
   *  ------------------------------------------------------------------ */

  const menuPanel = document.getElementById("menuPanel");
  const menuBtn = document.getElementById("menuBtn");
  menuBtn.addEventListener("click", () => {
    menuPanel.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
  });
  document.getElementById("closeMenuBtn").addEventListener("click", closeMenu);
  function closeMenu() {
    menuPanel.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  }

  // Exportar: ahora guarda {aprobaciones: {"12":"verde", ...}} en vez del
  // antiguo {visitadas: [...]}.
  document.getElementById("exportBtn").addEventListener("click", () => {
    const data = JSON.stringify(
      { aprobaciones: Object.fromEntries(aprobaciones), exportado: new Date().toISOString() },
      null,
      2
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "avance-colima-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
    closeMenu();
  });

  const importInput = document.getElementById("importFile");
  document.getElementById("importBtn").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        let count = 0;
        if (parsed.aprobaciones && typeof parsed.aprobaciones === "object") {
          // Formato actual: objeto {seccion: color}.
          Object.entries(parsed.aprobaciones).forEach(([id, color]) => {
            if (NIVELES.includes(color)) {
              aprobaciones.set(String(id), color);
              count++;
            }
          });
        } else if (Array.isArray(parsed.visitadas)) {
          // Compatibilidad con respaldos VIEJOS (de la versión anterior de
          // la app, antes del semáforo de colores): las secciones
          // "visitadas" se convierten a "verde" como equivalente razonable.
          parsed.visitadas.forEach((id) => {
            aprobaciones.set(String(id), "verde");
            count++;
          });
        } else {
          throw new Error("formato inválido");
        }
        saveAprobaciones();
        renderSecciones();
        renderList();
        updateTally();
        showToast("Avance importado (" + count + " secciones)");
      } catch (err) {
        showToast("Archivo inválido");
      }
      closeMenu();
    };
    reader.readAsText(file);
    importInput.value = "";
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("¿Borrar todo el avance registrado en este dispositivo? Esta acción no se puede deshacer.")) {
      aprobaciones.clear();
      saveAprobaciones();
      renderSecciones();
      renderList();
      updateTally();
      showToast("Avance borrado");
    }
    closeMenu();
  });

  /** ---------------------------------------------------------------------
   *  TOAST
   *  ------------------------------------------------------------------ */

  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2600);
  }

  /** ---------------------------------------------------------------------
   *  SERVICE WORKER
   *  ------------------------------------------------------------------ */

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();
