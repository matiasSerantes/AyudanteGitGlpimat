# Cola de tickets Smart Central

Extension local de Chrome que permite preparar varios tickets y crearlos uno por uno usando la sesion ya iniciada en `central.smartsouth.net`.

## Instalacion

1. Abri `chrome://extensions` en Chrome.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar extension sin empaquetar**.
4. Selecciona la carpeta `CargadorTicketsCentral`.
5. Fija la extension en la barra de Chrome y pulsa su icono para abrir el panel lateral.

## Actualizacion

1. Cierra el panel lateral de la extension.
2. Ejecuta `actualizar_extension.bat` con doble clic.
3. Cuando termine, abre `chrome://extensions`.
4. Pulsa **Recargar** en **Cola de tickets Smart Central**.

El actualizador descarga la rama `main` de `matiasSerantes/AyudanteGitGlpimat`. El repositorio debe ser publico. La cola, el borrador y las plantillas editadas localmente se conservan en Chrome.

## Uso seguro

- Completa cada ticket y pulsa **Agregar a la cola**.
- Revisa la pestana **Cola** antes de iniciar.
- **Iniciar cola** pide una confirmacion final y recien entonces comienza a crear tickets.
- Despues de cada alta, reconoce tanto `TICKET GLPI #...` como `Ticket creado y asignado en GLPI`, guarda el numero y cierra la confirmacion para continuar.
- Opcionalmente abre el ticket creado, registra el tiempo facturable y el mensaje al cliente, y lo cierra desde el boton operativo **Cerrar**.
- Incluye plantillas adaptadas desde `plantillas viejas/plantillas`. Desde el panel se pueden aplicar, modificar, guardar con otro nombre, reemplazar o eliminar.
- Si la sesion expiro, el panel abre Central y conserva la cola para reanudarla luego del acceso.
- Ante un campo no encontrado, una opcion invalida o una respuesta dudosa, la ejecucion se pausa para evitar duplicados.

## Plantillas

- **Aplicar** carga la plantilla seleccionada en los campos compatibles de Smart Central.
- Para editar una plantilla, aplicala, modifica los campos y pulsa **Guardar** usando el mismo nombre.
- Las ediciones se guardan localmente en el perfil de Chrome y no modifican las plantillas originales del asistente.
- Para regenerar `templates.json` desde la copia antigua, ejecuta `node tools/import-legacy-templates.mjs`.

## Primera prueba

Proba inicialmente con un solo ticket real y una categoria conocida. La interfaz de Central puede usar controles personalizados; si algun campo no coincide, el mensaje de error indica cual selector debe ajustarse en `content.js`.
