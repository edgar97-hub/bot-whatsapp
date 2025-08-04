require("dotenv").config();
const express = require("express");
const http = require("http"); // Native Node.js HTTP module
const { WebSocketServer } = require("ws"); // WebSocket library
const apiRoutes = require("./src/routes/api.routes");
const sessionManager = require("./src/managers/sessionManager");
const messageQueue = require("./src/managers/messageQueue"); // Import messageQueue to ensure worker starts
const fs = require("fs"); // For sessions.config.json persistence

const SESSION_CONFIG_PATH = "./sessions.config.json";

const app = express();
const server = http.createServer(app); // Create a native HTTP server
const wss = new WebSocketServer({ server }); // Attach the WebSocket Server to the HTTP server

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" })); // Allow large PDFs

// --- REST API for sending messages ---
app.use("/api", apiRoutes);

// --- WebSocket for QR linking ---
wss.on("connection", (ws, req) => {
  const urlParts = req.url.split("/");
  const sessionId = urlParts[urlParts.length - 1]; // Extract sessionId from the URL

  if (!sessionId) {
    ws.send(
      JSON.stringify({ event: "error", message: "Session ID es requerido." })
    );
    ws.close();
    return;
  }

  console.log(`[${sessionId}] Cliente conectado vía WebSocket.`);
  handleWebSocketSession(ws, sessionId);
});

const handleWebSocketSession = async (ws, sessionId) => {
  console.log(`[${sessionId}] Petición WebSocket recibida.`);

  // --- 1. Definir los Handlers de Eventos y Limpieza ---
  // (Esta parte ya era robusta)
  const handleQrEvent = (data) => {
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "qr", data: data.qr }));
    }
  };

  const handleOpenEvent = (data) => {
    // --- LA VALIDACIÓN QUE FALTABA ---
    // Antes de enviar 'connected', verificamos el estado REAL en el sessionManager.
    const currentSession = sessionManager.getSession(sessionId);
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      // Solo si el estado en el manager es 'connected', lo notificamos.
      if (currentSession && currentSession.status === "connected") {
        ws.send(JSON.stringify({ event: "status", data: "connected" }));
      }
    }
  };

  const handleCloseEvent = (data) => {
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      // Enviar el estado final (unlinked/disconnected)
      ws.send(JSON.stringify({ event: "status", data: data.status }));
      if (data.status === "unlinked") {
        // Si fue desvinculado, ahora sí podemos cerrar el WS desde el servidor.
        ws.close();
      }
    }
  };

  const handleStatusUpdateEvent = (data) => {
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "status", data: data.status }));
    }
  };

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
    ); // Limpiar el nuevo listener
  };

  // --- 2. Registrar los Handlers y la Limpieza ---
  sessionManager.sessionEmitter.on("qr", handleQrEvent);
  sessionManager.sessionEmitter.on("connection_open", handleOpenEvent);
  sessionManager.sessionEmitter.on("connection_close", handleCloseEvent);
  sessionManager.sessionEmitter.on("status_update", handleStatusUpdateEvent); // Registrar el nuevo listener
  ws.on("close", cleanupListeners);
  ws.on("error", (err) => {
    console.error(`[${sessionId}] Error en WebSocket.`, err);
    cleanupListeners();
  });

  // --- 3. Lógica de Estado (AHORA ES EL PUNTO DE PARTIDA) ---
  const existingSession = sessionManager.getSession(sessionId);

  if (existingSession) {
    // La sesión ya está en memoria.
    console.log(
      `[${sessionId}] Sesión existente encontrada con estado: ${existingSession.status}`
    );

    // Enviamos el estado actual inmediatamente.
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({ event: "status", data: existingSession.status })
      );
    }

    // Si ya está conectada, cerramos. Esto limpiará los listeners.
    // if (existingSession.status === "connected") {
    //   //   ws.close();
    //   //   return;
    // }

    // Si está esperando un QR, se lo enviamos.
    if (existingSession.status === "qr_pending" && existingSession.qr) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: "qr", data: existingSession.qr }));
      }
    }
    // Si está 'disconnected', reiniciamos el proceso de conexión para ella.
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
    // La sesión es completamente nueva.
    console.log(`[${sessionId}] Sesión nueva. Creando e inicializando...`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "status", data: "initializing" }));
    }

    // Ahora, persistimos en el archivo de configuración.
    try {
      const SESSION_CONFIG_PATH = "./sessions.config.json";
      const configData = fs.readFileSync(SESSION_CONFIG_PATH, "utf-8");
      const sessionConfigs = JSON.parse(configData);
      if (!sessionConfigs.find((s) => s.sessionId === sessionId)) {
        sessionConfigs.push({
          sessionId,
          description: "Sesión creada dinámicamente",
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
            message: "Error interno del servidor.",
          })
        );
        ws.close();
      }
      return;
    }

    // Finalmente, iniciamos el proceso de creación de Baileys.
    await sessionManager.createSession(sessionId);
  }
};

server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  sessionManager.initialize(); // Initialize sessions from config on startup
});
