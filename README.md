# Microservicio de Bot de WhatsApp Multisesión

## Objetivo del Proyecto

Desarrollar una aplicación de servidor Node.js que funcione como un servicio centralizado de mensajería de WhatsApp. La aplicación es capaz de gestionar múltiples números de WhatsApp (sesiones) de forma simultánea e independiente. Expone una API REST segura que permite a sistemas externos (como un sistema de ventas) enviar mensajes y documentos PDF a través de una sesión específica, identificada por un `sessionId`. Además, incorpora una interfaz WebSocket para la vinculación dinámica de nuevas sesiones y la recepción en tiempo real de códigos QR y estados de conexión.

## Principios de Diseño

*   **Aislamiento de Sesiones:** Cada sesión de WhatsApp tiene sus propias credenciales, estado de conexión y carpeta de autenticación, garantizando que un problema en una sesión no afecte a las demás.
*   **Configuración Externa:** La definición de las sesiones que el servicio debe gestionar se realiza a través de un archivo de configuración externo (`sessions.config.json`), permitiendo añadir o quitar sesiones sin modificar el código fuente.
*   **Robustez y Resiliencia:** El servicio es capaz de recuperarse de desconexiones y reiniciar automáticamente las sesiones fallidas.
*   **Seguridad:** El acceso a la API está protegido por un token de autenticación estático.
*   **Observabilidad:** La aplicación proporciona endpoints para monitorear el estado de las sesiones y obtener códigos QR para la vinculación.
*   **Interacción en Tiempo Real:** La vinculación de nuevas sesiones y la obtención de códigos QR se realiza a través de WebSockets para una experiencia de usuario fluida y en tiempo real.

## Stack Tecnológico

*   **Lenguaje:** JavaScript (ES6+)
*   **Entorno:** Node.js
*   **Framework API:** Express.js
*   **Librería de WhatsApp:** `@whiskeysockets/baileys`
*   **WebSockets:** `ws`
*   **Gestor de Procesos (Producción):** PM2 (recomendado, no implementado directamente en el código base)
*   **Utilidades:** `dotenv` (variables de entorno), `pino` y `pino-pretty` (logging estructurado), `qrcode-terminal` (visualización de QR en consola, solo para depuración interna).

## Estructura de Directorios

```
whatsapp-bot-service/
├── sessions/               # Directorio raíz para los datos de sesión persistentes
│   ├── session_a/          # Ejemplo: datos de la sesión 'session_a'
│   └── session_b/          # Ejemplo: datos de la sesión 'session_b'
├── src/
│   ├── managers/
│   │   ├── sessionManager.js  # Lógica central para gestionar todas las sesiones
│   │   └── messageQueue.js    # Cola en memoria para el envío robusto de mensajes
│   ├── controllers/
│   │   └── api.controller.js  # Controladores para los endpoints de la API (solo send-pdf)
│   ├── routes/
│   │   └── api.routes.js      # Definición de todas las rutas de la API (solo send-pdf)
│   └── middleware/
│       └── auth.middleware.js # Middleware para la validación del token de la API
├── .env                    # Variables de entorno
├── .gitignore              # Archivos y directorios a ignorar por Git
├── app.js                  # Punto de entrada de la aplicación Express y WebSocket
├── package.json            # Metadatos del proyecto y dependencias
├── package-lock.json       # Bloqueo de versiones de dependencias
└── sessions.config.json    # Archivo de configuración para definir las sesiones
```

## Configuración Inicial y Ejecución

### 1. Archivo de Configuración de Sesiones (`sessions.config.json`)

Este archivo JSON define las sesiones que el servicio debe gestionar al inicio.

```json
[
  {
    "sessionId": "tienda_lima",
    "description": "Sistema de Ventas de la Sede Lima"
  },
  {
    "sessionId": "soporte_tecnico",
    "description": "Canal de Soporte Técnico General"
  }
]
```

### 2. Archivo de Variables de Entorno (`.env`)

Crea un archivo `.env` en la raíz del proyecto con el siguiente contenido. Asegúrate de cambiar el `API_STATIC_TOKEN` por un valor seguro y largo.

```
# Puerto en el que se ejecutará el servidor de la API
PORT=3000

# Token estático y secreto para asegurar el acceso a la API
API_STATIC_TOKEN="CAMBIAR_ESTO_POR_UN_TOKEN_SECRETO_Y_LARGO_GENERADO_ALEATORIAMENTE"
```

### 3. Instalación de Dependencias

Desde la raíz del proyecto, ejecuta los siguientes comandos para inicializar `package.json` e instalar las dependencias:

```bash
npm init -y
npm install @whiskeysockets/baileys express dotenv pino pino-pretty ws
```

### 4. Scripts de Ejecución

El `package.json` debe contener los siguientes scripts:

```json
{
  "name": "whatsapp-bot-service",
  "version": "1.0.0",
  "description": "Microservicio de Bot de WhatsApp Multisesión",
  "main": "app.js",
  "scripts": {
    "start": "node app.js",
    "dev": "node app.js | pino-pretty",
    "test": "jest"
  },
  "keywords": [],
  "author": "",
  "license": "ISC"
}
```

### 5. Archivo `.gitignore`

Crea un archivo `.gitignore` en la raíz del proyecto para evitar que archivos sensibles y generados se suban al control de versiones:

```
node_modules/
sessions/
.env
*.log
```

### 6. Primer Lanzamiento

Para iniciar el servicio en modo desarrollo (con logs bonitos en consola):

```bash
npm run dev
```

Para producción, se recomienda usar PM2:

```bash
pm2 start app.js --name "whatsapp-service"
pm2 logs whatsapp-service
```

## Uso de la API REST (Envío de Mensajes)

El servicio expone un endpoint REST para enviar documentos PDF.

### `POST /api/send-pdf`

Envía un documento PDF a un número de WhatsApp específico.

*   **Headers:**
    *   `Authorization: Bearer [TU_TOKEN_SECRETO]`
    *   `Content-Type: application/json`
*   **Body (JSON):**
    ```json
    {
      "sessionId": "tienda_lima",
      "to": "51987654321",
      "pdfBase64": "JVBERi0xLjQKJ...",
      "fileName": "Comprobante.pdf" // Opcional, por defecto "Comprobante.pdf"
    }
    ```
*   **Respuestas:**
    *   `202 Accepted`: Mensaje encolado para envío.
        ```json
        {
          "success": true,
          "message": "Mensaje encolado para envío."
        }
        ```
    *   `400 Bad Request`: Parámetros requeridos faltantes.
    *   `401 Unauthorized`: Token de autenticación no proporcionado.
    *   `403 Forbidden`: Token de autenticación inválido.

## Uso de WebSockets (Vinculación de Sesiones y Estado en Tiempo Real)

La vinculación de nuevas sesiones y el monitoreo de su estado se realiza a través de una única conexión WebSocket, proporcionando una experiencia en tiempo real.

### Endpoint WebSocket

`ws://[IP_DEL_SERVIDOR]:3000/ws/session/:sessionId`

*   **`:sessionId`**: El ID único de la sesión de WhatsApp que se desea vincular o monitorear (ej. `tienda_arequipa`).

### Flujo de Interacción Frontend-Backend (WebSockets)

1.  **Iniciar la Vinculación:**
    *   El frontend (ej. la interfaz de administración del sistema de ventas) abre una conexión WebSocket a `ws://[IP_DEL_SERVIDOR]:3000/ws/session/tienda_arequipa`.
    *   El servidor, al recibir esta conexión, inicia el proceso de creación/reconexión de la sesión de Baileys.
    *   Si la sesión es nueva, se persistirá automáticamente en `sessions.config.json`.

2.  **Recepción de Eventos en Tiempo Real:**
    El frontend debe escuchar los mensajes que llegan por este WebSocket. Los mensajes serán objetos JSON con una estructura `{ event: string, data: any }`.

    *   **`{ event: 'status', data: 'initializing' }`**: La sesión está iniciando su proceso de conexión.
    *   **`{ event: 'status', data: 'already_connected' }`**: La sesión ya estaba conectada. El frontend puede cerrar el WebSocket y mostrar un mensaje de éxito.
    *   **`{ event: 'status', data: 'disconnected' }`**: La sesión se ha desconectado.
    *   **`{ event: 'qr', data: '...' }`**: Se ha generado un código QR. El `data` contendrá la cadena del QR. El frontend debe usar una librería (ej. `qrcode.react` para React o `qrcode` para JavaScript puro) para renderizar esta cadena como una imagen QR en la pantalla.
    *   **`{ event: 'status', data: 'connected' }`**: La sesión se ha conectado exitosamente (el usuario escaneó el QR). El frontend puede cerrar el WebSocket y mostrar un mensaje de éxito.
    *   **`{ event: 'error', data: '...' }`**: Ha ocurrido un error en el conexión WebSocket o en el proceso de la sesión.

3.  **Cierre de la Conexión WebSocket:**
    La conexión WebSocket se cerrará automáticamente desde el servidor cuando la sesión se conecte exitosamente (`connected` o `already_connected`). El frontend también puede cerrar la conexión cuando ya no la necesite.

## Detalles de Implementación

### `src/managers/sessionManager.js`

*   **`sessions = new Map()`**: Almacena las instancias activas de Baileys y sus metadatos (`{ sock, status, qr }`).
*   **`sessionEmitter = new EventEmitter()`**: Un emisor de eventos que notifica a los suscriptores (principalmente el servidor WebSocket) sobre cambios en el estado de la sesión (QR disponible, conexión abierta/cerrada).
*   **`createSession(sessionId)`**: Función asíncrona que inicializa una instancia de Baileys, configura la autenticación multi-archivo (`sessions/${sessionId}`), y suscribe a los eventos de conexión. Emite eventos `qr`, `connection_open`, `connection_close` a través de `sessionEmitter`.
*   **`initialize()`**: Lee `sessions.config.json` e inicia las sesiones definidas al arrancar la aplicación.
*   **`getSession(sessionId)`**: Devuelve el objeto de sesión de la memoria.
*   **`getAllSessionsStatus()`**: Devuelve un resumen del estado de todas las sesiones.

### `src/managers/messageQueue.js`

*   Implementa una cola en memoria para los mensajes salientes.
*   **`addMessage(message)`**: Añade un mensaje a la cola.
*   **`processQueue()`**: Un "worker" que se ejecuta periódicamente, toma mensajes de la cola y los envía a través de la sesión de WhatsApp correspondiente si está conectada. Los mensajes fallidos permanecen en la cola para reintentos.

### `src/controllers/api.controller.js`

*   Contiene solo el controlador `sendPdfController` para la API REST de envío de mensajes.

### `src/routes/api.routes.js`

*   Define la ruta `POST /api/send-pdf` y aplica el middleware de autenticación.

### `app.js`

*   Punto de entrada principal.
*   Configura el servidor Express para la API REST.
*   Crea un servidor HTTP nativo y adjunta un servidor WebSocket (`ws`).
*   Maneja las conexiones WebSocket, extrae el `sessionId` de la URL y delega a `handleWebSocketSession`.
*   `handleWebSocketSession`: Gestiona el ciclo de vida de la conexión WebSocket para una sesión específica, persistiendo la sesión en `sessions.config.json` si es nueva, y reenviando los eventos de `sessionEmitter` al cliente WebSocket.
*   Inicia el `sessionManager` al arrancar la aplicación.

## Estrategia de Pruebas

### Pruebas Unitarias (con Jest)

*   **`auth.middleware.js`**: Verifica que el middleware de autenticación permite el paso con un token válido y lo bloquea con uno inválido o ausente.
*   **`sessionManager.js`**: Mockea la librería Baileys para probar la creación, gestión de estado, reconexión y emisión de eventos de las sesiones.
*   **`messageQueue.js`**: Prueba la adición, procesamiento, reintentos y eliminación de mensajes en la cola.
*   **`api.controller.js`**: Mockea `messageQueue` para probar la lógica de validación y encolamiento de mensajes.

### Pruebas de Integración

*   Levantar el servidor completo.
*   Simular conexiones WebSocket para verificar el flujo de vinculación de sesiones (envío de QR, cambio de estado).
*   Realizar llamadas a la API REST (`/api/send-pdf`) para verificar el encolamiento y envío de mensajes.

### Pruebas End-to-End (E2E)

*   Simular un cliente frontend abriendo una conexión WebSocket y siguiendo el flujo de vinculación.
*   Simular un sistema de ventas enviando un PDF a través de la API REST y verificar la recepción en un número de WhatsApp de destino (requiere configuración de test).

## Despliegue y Operación

### Seguridad

*   **Token Estático:** Genera un `API_STATIC_TOKEN` largo, aleatorio y seguro en tu archivo `.env`.
*   **Firewall:** Configura un firewall en el servidor para permitir el acceso al `PORT` solo desde las IPs de los sistemas cliente si es posible.

### Backups

*   **CRÍTICO:** Implementa una política de backup para el directorio `sessions/`. Una copia de seguridad diaria es fundamental. Perder esta carpeta significa que todos los clientes deben volver a escanear sus códigos QR.

### Monitoreo

*   Utiliza `pm2 monit` para observar el consumo de CPU y memoria del proceso.
*   Considera un sistema de logging externo (como Sentry, LogDNA) para centralizar los errores en producción.
*   El estado de las sesiones se puede monitorear a través de los logs del servidor y la interacción WebSocket.

### Procedimiento de Actualización

Para actualizar la librería Baileys o cualquier otra dependencia:

1.  Notifica a los clientes de una ventana de mantenimiento planificada.
2.  Detén el servicio: `pm2 stop whatsapp-service`.
3.  Realiza un backup del directorio `sessions/`.
4.  Ejecuta `npm update @whiskeysockets/baileys` (o `npm update` para todas las dependencias).
5.  Reinicia el servicio: `pm2 start whatsapp-service`.
6.  Monitorea los logs de cerca para asegurar que todas las sesiones se reconecten correctamente.
