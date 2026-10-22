# Huellas — tu Cronología de Google Maps, sobre el mapa

Web para importar la exportación de la **Cronología** (historial de ubicaciones) de Google Maps y explorarla de muchas formas: rutas, mapa de calor, ciudad en 3D, animación de tus movimientos, viajes, países, calendario, récords y un resumen animado tipo «Wrapped».

Todo se procesa **en tu navegador**: tus ubicaciones no se suben a ningún sitio.

## Cómo se abre

1. Haz **doble clic en `index.html`** (mejor con Chrome o Edge actualizados; Firefox y Safari también sirven).
2. Arrastra tu archivo a la página, o pulsa **Elegir archivos** / **Elegir carpeta**.
3. La primera vez tarda unos segundos (un archivo de 300 MB, unos 4 s). Después queda guardado en ese navegador y la próxima vez basta con pulsar **Continuar con tus datos**.

¿Sin archivo todavía? Pulsa **Probar con datos de demostración** (dos años inventados en Barcelona con viajes a Roma, Tokio, Nueva York…). También puedes abrir `index.html?demo`.

Necesita internet solo para el mapa de fondo. Sin conexión funciona igual con un mapa básico de países.

## Qué archivos entiende

| Origen | Archivo |
|---|---|
| Android (Cronología en el móvil, 2024+) | `Timeline.json` — Ajustes → Ubicación → Servicios de ubicación → Cronología → Exportar datos de Cronología |
| iPhone | `location-history.json` — Google Maps → tu foto → Tu cronología → ⋯ → Ajustes de ubicación y privacidad → Exportar datos de Cronología |
| Google Takeout antiguo | el `.zip` entero, la carpeta *Historial de ubicaciones*, `Records.json`, los JSON de *Semantic Location History* o `Timeline Edits.json` |
| Otros | `.gpx`, `.kml` (incluido el antiguo *Location History.kml*) y `.csv` con columnas de latitud, longitud y fecha |

Puedes soltar varios a la vez (por ejemplo, el Takeout antiguo + el `Timeline.json` nuevo): se combinan y se quitan los duplicados.

## Qué puedes hacer

**Vistas del mapa** (botones de arriba o teclas 1–6):
- **Rutas**: todos tus trayectos coloreados por medio de transporte (o por año). Los círculos son los sitios donde paraste; cuanto más grandes, más tiempo.
- **Calor**: dónde pasas el tiempo.
- **3D**: tu ciudad en columnas hexagonales según el tiempo que pasas en cada zona (arrastra con el botón derecho para girar).
- **Animación**: reproduce tus movimientos con estela, fecha y hora local. Cambia la velocidad y activa «la cámara te sigue».
- **Viajes**: arcos desde casa a cada destino (un viaje = días a más de 100 km de casa).
- **Países**: mapa de los países visitados según los días pasados en cada uno.

**Filtros**: arrastra sobre la barra de tiempo de abajo para elegir fechas (arrastra la selección para moverla, rueda del ratón para ampliar, doble clic para ver todo) o usa los botones de año. El selector de **países** de arriba filtra todo por país.

**Panel lateral**: Resumen (kilómetros, días, países, ciudades, medios de transporte, km por mes), Países y ciudades, Lugares (dónde más tiempo pasas; puedes ponerles nombre con OpenStreetMap si quieres), Viajes, Patrones (calendario, a qué hora te mueves, días de la semana) y Récords (día más viajero, lo más lejos de casa, vuelo más largo, puntos más al norte/sur/este/oeste…).

**Un día concreto**: clic en un día de la barra de tiempo, del calendario o en cualquier ruta del mapa → itinerario completo con horas, paradas numeradas y botón para reproducir ese día. Flechas ← → para ir al día anterior o siguiente.

**Tu resumen** (✨ o tecla R): diapositivas animadas de tu año o de toda tu historia.

**Exportar** (tecla E): imagen PNG del mapa con tus cifras, GeoJSON, GPX o CSV de lo que tengas filtrado.

**Ajustes**: mapa de fondo (noche, color, claro, satélite, sin conexión), globo terráqueo 3D (tecla G), grosor de rutas, radio del calor y borrar los datos guardados.

## Notas

- La exportación del móvil no incluye nombres de lugares: aparecen como «Casa», «Trabajo» o «Lugar en *ciudad*». En la pestaña Lugares puedes pedir los nombres a OpenStreetMap (solo se envían las coordenadas de esos lugares, y solo si lo pulsas).
- Las horas se muestran en la hora local del sitio donde estabas.
- Si el archivo solo trae puntos GPS (Records.json, GPX), el medio de transporte se estima por la velocidad y las paradas se detectan solas.
- Sobrevolar un país en avión no cuenta como haberlo visitado.

## Estructura

- `index.html`, `css/`, `js/` — la aplicación (sin instalar nada ni compilar).
- `js/worker.js` — lector en segundo plano de todos los formatos y análisis (país, ciudad, huso horario, casa, viajes…).
- `data/` — fronteras (Natural Earth) y ciudades (GeoNames) para trabajar sin internet. Se regeneran con `tools/build-data.py`.
- `vendor/` — MapLibre GL, deck.gl y tipografías, incluidas para no depender de terceros.
- `tests/index.html` — batería de pruebas del lector (todos los formatos, archivos rotos, zip, y una prueba de 1,3 GB).

## Créditos

Mapas © OpenStreetMap contributors, © CARTO; imágenes de satélite © Esri. Fronteras: Natural Earth. Ciudades: GeoNames (CC BY 4.0). Librerías: MapLibre GL JS, deck.gl. Iconos: Lucide. Tipografías: Inter y Space Grotesk; banderas: Twemoji (CC BY 4.0).
