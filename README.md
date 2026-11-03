# Cola de tickets Smart Central

Extension local de Chrome que permite preparar varios tickets y crearlos uno por uno usando la sesion ya iniciada en `operaciones.smartsouth.net/central/` (URL temporal por mantenimiento). Tambien admite `central.smartsouth.net` para cuando se restablezca el servicio.

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
- Con **Usar dia y hora indicado** activo, agregar un ticket avanza la fecha y hora del formulario segun el tiempo facturable para preparar el siguiente. El ticket agregado conserva su hora original. **Sin intervencion** no avanza la hora; editar un ticket de la cola tampoco.
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

## Imagenes

La version 0.3.4 agrega botones Imagen en Descripcion, Detalle para el cliente / motivo, Nota interna y Mensaje al cliente / solucion. Acepta PNG, JPG, GIF y WebP, permite revisar y quitar cada imagen, y guarda los archivos con el borrador y la cola. Cada imagen admite hasta 4 MB. Los tres campos de trabajo se envian al activar Registrar trabajo y cerrar ticket. Las imagenes no se guardan en las plantillas.

La extension usa el selector de archivos del propio campo de Central y espera que la imagen se incorpore al texto antes de enviar. Si Central usa otra estructura o no confirma la importacion, la cola se pausa. Esta integracion debe verificarse con un ticket real en la sesion de Central.

En la version 0.3.5 tambien podes copiar una imagen o sacar una captura al portapapeles (por ejemplo con Win+Shift+S), hacer clic dentro del campo correspondiente y pulsar Ctrl+V. Aparece como adjunto con vista previa y se guarda igual que una imagen importada. El pegado de texto sigue funcionando. No hace falta guardar la captura ni dar permisos adicionales al portapapeles.

## Espera de guardado (0.3.15)

Al registrar el trabajo, la extension espera hasta 45 segundos a que Central habilite **Cerrar**, y continua apenas el boton esta disponible. Esto evita detener la cola mientras Central muestra Guardando cambios. El diagnostico registra la duracion de esta espera. Si Central pide Reintentar guardado, la cola se pausa para revisar el ticket ya creado.

## Logs de diagnostico (0.3.14)

El log se guarda automaticamente en `chrome.storage.local`, clave `smartCentralDiagnostics`, en el perfil de Chrome de cada persona. Conserva los ultimos 1500 eventos incluso al cerrar el panel o reiniciar Chrome. No se crea un archivo en la carpeta de la extension.

Para reportar un fallo: actualiza la extension, pulsa Recargar en `chrome://extensions`, recarga la pagina de Central, reproduce el problema y abre **Cola > Descargar log**. Chrome descarga `central-log-FECHA.json` en la carpeta de descargas configurada (normalmente `Descargas`; puede preguntar donde guardarlo).

Registra version, fecha UTC, navegador al exportar, etapas, campos procesados, errores, referencias y reintentos de conexion. No copia los cuerpos de tickets, imagenes, cookies ni contrasenas. Algunos mensajes de error pueden incluir nombres de opciones o referencias: revisa el archivo antes de compartirlo. Los logs permanecen locales y no se envian automaticamente. Se eliminan al quitar la extension o borrar sus datos.

## Entidades (0.3.16)

El cargador lee las entidades disponibles en el formulario de Central; no consulta directamente la API de GLPI. Pulsa Actualizar desde Central con la sesion iniciada y la cola detenida: abre Nuevo ticket si hace falta, espera las opciones y muestra cuantas entidades leyo. Conserva las listas guardadas para trabajar sin conexion. Si una entidad tampoco aparece en el formulario de Central, se debe revisar su sincronizacion o permisos en Central/GLPI. Al abrir el panel tambien intenta leer un formulario que ya este abierto.

## Confirmacion de operaciones (0.3.17)

La creacion y el cierre ignoran alertas ocultas y mensajes que ya estaban visibles antes de enviar. Si Central muestra No se pudo confirmar la operacion, el cargador sigue esperando la confirmacion durante el plazo habitual (20 segundos al crear, 45 al cerrar), sin repetir el envio. Una confirmacion posterior permite continuar la cola; si no llega, la cola se pausa para revisar el estado antes de reintentar. Los errores nuevos de validacion siguen deteniendo la operacion.
