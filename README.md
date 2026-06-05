# Sinergitec Logistics - Sistema de Trazabilidad

Sistema web de logística y trazabilidad para la recolección de muestras clínicas. Diseñado para optimizar el flujo de trabajo entre clínicas, administradores y recolectores, garantizando el seguimiento en tiempo real y la validación mediante tecnología de códigos QR.

## 🚀 Características Principales

- **Gestión de Solicitudes:** Las clínicas pueden solicitar la recolección de múltiples muestras indicando el tipo y nivel de urgencia.
- **Planificación Logística:** Panel de control administrativo con mapas interactivos (Mapbox) para visualizar solicitudes pendientes y calcular distancias en línea recta desde el Laboratorio Central.
- **Asignación de Rutas:** Interfaz intuitiva para asignar recolectores a diferentes solicitudes médicas.
- **Trazabilidad en Tiempo Real:** Los recolectores pueden actualizar el estado de la recolección directamente desde el sistema.
- **Generación de Etiquetas QR:** Creación automática de etiquetas imprimibles con códigos QR para el seguimiento físico de los contenedores de muestras.

## 🛠️ Tecnologías Utilizadas

- **Backend:** Node.js, Express.js
- **Base de Datos:** MySQL (mysql2/promise)
- **Motor de Plantillas:** EJS (Embedded JavaScript)
- **Mapas y Geolocalización:** Mapbox API
- **Generación de QR:** Librería `qrcode`
- **Gestión de Sesiones:** `express-session`

## 👥 Roles del Sistema

1. **Clínica (`clinic`):**
   - Crea solicitudes de muestras (tipo, urgencia).
   - Monitorea el estado de sus solicitudes en el panel principal.

2. **Administrador (`admin`):**
   - Visualiza en un mapa las solicitudes pendientes y calcula la distancia geográfica.
   - Asigna las recolecciones a los trabajadores de campo.
   - Supervisa el historial completo de recolecciones entregadas.

3. **Recolector (`collector`):**
   - Revisa las rutas y tareas que le han sido asignadas.
   - Utiliza códigos QR para validar las etiquetas de las muestras.
   - Actualiza el estado de la recolección (por ejemplo, a "Entregada").

## ⚙️ Configuración e Instalación

### Requisitos Previos
- Node.js (v14 o superior)
- Servidor MySQL
- Una clave API válida de Mapbox

### Pasos de Instalación

1. **Clonar el repositorio:**
   ```bash
   git clone <url-del-repositorio>
   cd Proyecto_Sinergitec
   ```

2. **Instalar las dependencias:**
   ```bash
   npm install
   ```

3. **Configurar las variables de entorno:**
   Crea un archivo `.env` en la raíz del proyecto y añade la siguiente configuración:
   ```env
   PORT=3000
   MYSQLHOST=tu_host_mysql
   MYSQLPORT=tu_puerto_mysql
   MYSQLUSER=tu_usuario
   MYSQLPASSWORD=tu_contraseña
   MYSQLDATABASE=tu_base_de_datos
   MAPBOX_TOKEN=tu_token_de_mapbox_aqui
   ```
   *Nota: El sistema está configurado para ajustar la zona horaria del servidor a `America/Mexico_City` y sincronizarse con la base de datos en `UTC`.*

4. **Iniciar la aplicación:**
   ```bash
   npm start
   ```
   El servidor estará disponible en `http://localhost:3000`

## ☁️ Despliegue en Railway

Este proyecto está estructurado y optimizado para ser desplegado y gestionado de forma ágil a través de Railway.

### Pasos para el despliegue:

1. **Crear la Base de Datos en Railway:**
   - Inicia sesión en tu dashboard de Railway, haz clic en `New Project` y selecciona **Provision MySQL**.
   - Esto creará un contenedor de base de datos.

2. **Desplegar la aplicación Web:**
   - En el mismo entorno del proyecto, haz clic en `New` -> `GitHub Repo` y selecciona tu repositorio (ej. `Proyecto_Sinergitec`).
   - Railway detectará automáticamente que es una aplicación en Node.js mediante el archivo `package.json` y configurará el entorno de construcción (`npm install` y `npm start`).

3. **Configurar las Variables de Entorno (Environment Variables):**
   - Ve al servicio de tu aplicación Web en Railway, dirígete a la pestaña **Variables**.
   - Haz clic en `Add Variable` y usa la opción **Reference Variable** para inyectar automáticamente las credenciales de tu servicio MySQL previamente creado. Deben quedar exactamente con estos nombres:
     - `MYSQLHOST`
     - `MYSQLPORT`
     - `MYSQLUSER`
     - `MYSQLPASSWORD`
     - `MYSQLDATABASE`
   - Añade manualmente de forma segura tu token de mapa:
     - `MAPBOX_TOKEN=tu_token_de_mapbox_aqui`

4. **Nota sobre las Zonas Horarias (Timezones):**
   - Los servidores de Railway operan por defecto en la zona horaria `UTC`. El archivo `app.js` ya está preparado para forzar el entorno Node.js a `America/Mexico_City` e interpretar correctamente las fechas en `Z` (UTC) que devuelve la base de datos, garantizando consistencia en los horarios mostrados a los usuarios.