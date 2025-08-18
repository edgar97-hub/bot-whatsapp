/**
 * @file app.js
 * @description Punto de entrada principal para el microservicio de bot de WhatsApp.
 * Configura el servidor Express para la API REST y el servidor WebSocket para la gestión de sesiones en tiempo real.
 */

require("dotenv").config(); // Carga las variables de entorno desde el archivo .env
const express = require("express");
const http = require("http"); // Módulo nativo de Node.js para crear el servidor HTTP
const { WebSocketServer } = require("ws"); // Librería WebSocket
const apiRoutes = require("./src/routes/api.routes"); // Rutas de la API REST
const sessionManager = require("./src/managers/sessionManager"); // Gestor de sesiones de Baileys
const fs = require("fs"); // Módulo para interactuar con el sistema de archivos (para sessions.config.json)

/**
 * Ruta al archivo de configuración de sesiones.
 * @type {string}
 */
const SESSION_CONFIG_PATH = "./sessions.config.json";

/**
 * Instancia de la aplicación Express.
 * @type {express.Application}
 */
const app = express();

/**
 * Servidor HTTP nativo de Node.js, creado a partir de la aplicación Express.
 * @type {http.Server}
 */
const server = http.createServer(app);

/**
 * Instancia del servidor WebSocket, adjuntada al servidor HTTP.
 * @type {WebSocketServer}
 */
const wss = new WebSocketServer({ server });

/**
 * Puerto en el que el servidor escuchará, obtenido de las variables de entorno o por defecto 3000.
 * @type {number}
 */
const PORT = process.env.PORT || 3000;

// Middleware para parsear cuerpos de solicitud JSON, con un límite de 50MB para PDFs grandes.
app.use(express.json({ limit: "50mb" }));

// Monta las rutas de la API REST bajo el prefijo /api.
app.use("/api", apiRoutes);

/**
 * Maneja las nuevas conexiones WebSocket.
 * Extrae el sessionId de la URL y delega la gestión a `handleWebSocketSession`.
 * @param {WebSocket} ws - La instancia del WebSocket conectado.
 * @param {IncomingMessage} req - El objeto de la solicitud HTTP entrante.
 */
wss.on("connection", (ws, req) => {
  const urlParts = req.url.split("/");
  // El sessionId se espera como el último segmento de la URL (ej. /ws/session/mySessionId)
  const sessionId = urlParts[urlParts.length - 1];

  if (!sessionId) {
    // Si no se proporciona un sessionId, envía un error y cierra la conexión.
    ws.send(
      JSON.stringify({ event: "error", message: "Session ID es requerido." })
    );
    ws.close();
    return;
  }

  console.log(`[${sessionId}] Cliente conectado vía WebSocket.`);
  // Inicia la gestión de la sesión WebSocket para el sessionId dado.
  handleWebSocketSession(ws, sessionId);
});

/**
 * Orquesta el ciclo de vida de una sesión de WhatsApp a través de una conexión WebSocket.
 * Maneja la persistencia de la sesión, la emisión de eventos de Baileys al cliente
 * y el inicio/reinicio del proceso de conexión de Baileys.
 * @param {WebSocket} ws - La instancia del WebSocket conectado para esta sesión.
 * @param {string} sessionId - El ID único de la sesión de WhatsApp.
 */
const handleWebSocketSession = async (ws, sessionId) => {
  console.log(`[${sessionId}] Petición WebSocket recibida.`);

  /**
   * Handler para el evento 'qr' emitido por sessionManager.
   * Envía el código QR al cliente WebSocket.
   * @param {{sessionId: string, qr: string}} data - Datos del evento QR.
   */
  const handleQrEvent = (data) => {
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "qr", data: data.qr }));
    }
  };

  /**
   * Handler para el evento 'connection_open' emitido por sessionManager.
   * Notifica al cliente WebSocket que la sesión está conectada.
   * @param {{sessionId: string}} data - Datos del evento de conexión abierta.
   */
  const handleOpenEvent = (data) => {
    const currentSession = sessionManager.getSession(sessionId);
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      if (currentSession && currentSession.status === "connected") {
        ws.send(JSON.stringify({ event: "status", data: "connected" }));
      }
    }
  };

  /**
   * Handler para el evento 'connection_close' emitido por sessionManager.
   * Notifica al cliente WebSocket sobre el cierre de la conexión.
   * @param {{sessionId: string, status: string}} data - Datos del evento de conexión cerrada.
   */
  const handleCloseEvent = (data) => {
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "status", data: data.status }));
      // Si la sesión fue desvinculada permanentemente, cerramos el WebSocket.
      if (data.status === "unlinked") {
        ws.close();
      }
    }
  };

  /**
   * Handler para el evento 'status_update' emitido por sessionManager.
   * Envía actualizaciones de estado al cliente WebSocket.
   * @param {{sessionId: string, status: string}} data - Datos del evento de actualización de estado.
   */
  const handleStatusUpdateEvent = (data) => {
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "status", data: data.status }));
    }
  };

  /**
   * Limpia todos los listeners de eventos asociados a esta conexión WebSocket
   * para prevenir fugas de memoria.
   */
  const cleanupListeners = () => {
    console.log(`[${sessionId}] Limpiando listeners para la conexión WS.`);
    sessionManager.sessionEmitter.removeListener("qr", handleQrEvent);
    sessionManager.sessionEmitter.removeListener(
      "connection_open",
      handleOpenEvent
    );
    sessionManager.sessionEmitter.removeListener(
      "connection_close",
      handleCloseEvent
    );
    sessionManager.sessionEmitter.removeListener(
      "status_update",
      handleStatusUpdateEvent
    );
  };

  // Registra los handlers de eventos en el sessionManager.
  sessionManager.sessionEmitter.on("qr", handleQrEvent);
  sessionManager.sessionEmitter.on("connection_open", handleOpenEvent);
  sessionManager.sessionEmitter.on("connection_close", handleCloseEvent);
  sessionManager.sessionEmitter.on("status_update", handleStatusUpdateEvent);

  // Registra el cleanup de listeners cuando el WebSocket se cierra o hay un error.
  ws.on("close", cleanupListeners);
  ws.on("error", (err) => {
    console.error(`[${sessionId}] Error en WebSocket:`, err);
    cleanupListeners();
  });

  // Lógica para iniciar o verificar el estado de la sesión de Baileys.
  const existingSession = sessionManager.getSession(sessionId);

  if (existingSession) {
    // Si la sesión ya existe en memoria.
    console.log(
      `[${sessionId}] Sesión existente encontrada con estado: ${existingSession.status}`
    );

    // Envía el estado actual de la sesión al cliente inmediatamente.
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({ event: "status", data: existingSession.status })
      );
    }

    // Si la sesión ya está conectada, notifica al cliente.
    // No cerramos el WebSocket aquí, ya que el cliente podría querer seguir recibiendo actualizaciones
    // o iniciar un logout desde la interfaz.
    if (existingSession.status === "connected") {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: "status", data: "already_connected" }));
      }
      // No hay 'return' aquí, permitimos que la función continúe para que los listeners se mantengan activos.
    }

    // Si está esperando un QR, se lo envía si está disponible.
    if (existingSession.status === "qr_pending" && existingSession.qr) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: "qr", data: existingSession.qr }));
      }
    }
    // Si está 'disconnected' o 'unlinked', reinicia el proceso de conexión.
    if (
      existingSession.status === "disconnected" ||
      existingSession.status === "unlinked"
    ) {
      console.log(
        `[${sessionId}] Reiniciando proceso de conexión para sesión existente.`
      );
      await sessionManager.createSession(sessionId);
    }
  } else {
    // Si la sesión es completamente nueva.
    console.log(`[${sessionId}] Sesión nueva. Creando e inicializando...`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "status", data: "initializing" }));
    }

    // Persiste la nueva sesión en el archivo de configuración.
    try {
      const configData = fs.readFileSync(SESSION_CONFIG_PATH, "utf-8");
      const sessionConfigs = JSON.parse(configData);
      if (!sessionConfigs.find((s) => s.sessionId === sessionId)) {
        sessionConfigs.push({
          sessionId,
          description: "Sesión creada dinámicamente", // Descripción por defecto
        });
        fs.writeFileSync(
          SESSION_CONFIG_PATH,
          JSON.stringify(sessionConfigs, null, 2)
        );
      }
    } catch (error) {
      console.error(
        `[${sessionId}] Error al actualizar el archivo de configuración:`,
        error
      );
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            event: "error",
            message: "Error interno del servidor al persistir la sesión.",
          })
        );
        ws.close();
      }
      return;
    }

    // Inicia el proceso de creación de la sesión de Baileys.
    await sessionManager.createSession(sessionId);
  }
};

/**
 * Inicia el servidor HTTP y WebSocket, y luego inicializa las sesiones de WhatsApp.
 */
server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  // Inicializa las sesiones definidas en sessions.config.json al arrancar la aplicación.
  sessionManager.initialize();
});
