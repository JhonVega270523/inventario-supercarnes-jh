# Inventario de equipos — Supercarnes JH

Aplicación responsive en HTML, CSS y JavaScript con Cloud Firestore. Incluye:
- Registro y edición de equipos.
- Captura o selección de hasta cuatro fotos por equipo desde el formulario de registro, con vista previa, eliminación individual y optimización automática.
- Eliminación permanente de equipos desde el inventario, con confirmación antes de borrar.
- Confirmaciones con diálogos personalizados acordes al diseño del sistema.
- Los formularios de equipo, asignación y recepción se cierran inmediatamente al guardar; si el guardado falla, vuelven a abrirse con los datos ingresados. Los diálogos también se pueden cerrar haciendo clic fuera de ellos.
- Marca, tipo, estado, periféricos, disponibilidad y persona que asigna.
- Asignaciones con responsable, área, fecha, periféricos, estado, recibido por y firma dibujada.
- Recepciones con persona que devuelve, responsable que recibe, área, fecha, periféricos, estado y firma dibujada.
- Historial de asignaciones y devoluciones por equipo.
- Búsqueda, filtros y panel de indicadores.
- Paginación de 20 registros en inventario, asignaciones y recepciones, con control para volver al inicio de la página.
- Columna dedicada de serial en todas las tablas del sistema.
- Exportación general a Excel con título y encabezados en color, filas con bordes y bandas alternas, filtros y encabezados inmovilizados; descarga de ficha técnica del activo en PDF con firmas e historial completo.
- Diseño adaptado a celular, tablet y computador con botones de acción optimizados (iconos de color en móvil).
- Sincronización automática en tiempo real entre los dispositivos conectados a Firestore.

## 1. Crear Firebase
1. Entra a https://console.firebase.google.com/ y crea un proyecto.
2. Agrega una aplicación web y copia su configuración.
3. En `firebase-config.js`, reemplaza todos los valores de ejemplo por los reales.
4. En Firebase Console, abre **Firestore Database** y crea una base de datos.
5. Publica la aplicación mediante un servidor local o hosting HTTPS (por ejemplo, Firebase Hosting o GitHub Pages).

## 2. Reglas de seguridad — importante
La aplicación cliente no debe quedar abierta a todo el mundo. Antes de usar datos reales:
1. Habilita Firebase Authentication (por ejemplo, correo/contraseña).
2. Implementa el inicio de sesión y limita las reglas de Firestore a usuarios autenticados/autorizados.
3. No uses las reglas abiertas del archivo `firestore.rules.example` en producción. Son solo una muestra para pruebas sin datos reales.
4. Configura roles si solo ciertos usuarios pueden asignar o recibir equipos.
5. Si limitas permisos por operación, autoriza también `delete` únicamente a los roles que deban eliminar equipos.

## 3. Ejecutar localmente
Como se usan módulos JavaScript, abre la carpeta mediante un servidor local (no con `file://`). Puedes usar la extensión **Live Server** de VS Code. Luego abre la dirección local que te muestre.

## 4. Estructura de Firestore
Colección `equipos`, un documento por equipo:
- `marca`, `tipo`, `estado`, `disponible`, `perifericos`, `observaciones`, `asignadoPor`
- `fotos`: arreglo de hasta cuatro imágenes JPEG optimizadas y codificadas en base64. El campo `foto` conserva la primera imagen para compatibilidad con documentos existentes.
- `asignaciones`: arreglo de registros de asignación, cada uno con datos de entrega y firma en base64.
- `recepciones`: arreglo de registros de recepción, cada uno con datos de devolución, responsable que recibe y firma en base64.
- `createdAt`, `updatedAt`: fechas de creación/actualización.

La aplicación escucha la colección en tiempo real, por lo que los cambios guardados desde un dispositivo aparecen automáticamente en los demás dispositivos conectados. El botón **Eliminar** en el inventario borra permanentemente el documento del equipo, incluidos sus historiales de asignación y recepción; solicita confirmación antes de hacerlo.

Las fotos del equipo se optimizan antes de guardarse en su documento de Firestore (máximo aproximado de 100 KB por imagen). Como Firestore limita el tamaño de cada documento, mantén bajo control el crecimiento de las fotos, firmas y del historial.

## Nota sobre firmas
Las firmas dibujadas se guardan como imagen PNG en el documento de Firestore. Si se espera un volumen alto de firmas, es mejor guardar las imágenes en Firebase Storage y almacenar en Firestore solo la URL. Los documentos tienen límites de tamaño, por lo que conviene vigilar el crecimiento del historial.

## Colores
Se usa rojo como color principal, blanco y tonos oscuros para una interfaz corporativa. La web pública de Supercarnes JH encontrada en línea no publica una guía de identidad visual accesible; por eso la paleta es una propuesta visual inicial y no una confirmación oficial de los colores de marca.
