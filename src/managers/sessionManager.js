/**
 * @file src/managers/sessionManager.js
 * @description Gestiona el ciclo de vida de las sesiones de WhatsApp (Baileys),
 * incluyendo creación, conexión, reconexión y emisión de eventos.
 */

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

let sessionConfigPromise = Promise.resolve(); // Promesa para serializar escrituras en sessions.config.json

/**
 * Mapa para almacenar las instancias de las sesiones activas.
 * La clave es el sessionId y el valor es un objeto con { sock, status, qr }.
 * @type {Map<string, {sock: any, status: string, qr: string|null}>}
 */
const sessions = new Map();

/**
 * Ruta al archivo de configuración de sesiones.
 * @type {string}
 */
const SESSION_CONFIG_PATH = path.resolve("./sessions.config.json");

/**
 * Directorio raíz para los datos de autenticación de las sesiones.
 * @type {string}
 */
const SESSIONS_DIR = path.resolve("./sessions");

/**
 * Emisor de eventos para notificar cambios en el estado de las sesiones.
 * @type {EventEmitter}
 */
const sessionEmitter = new EventEmitter();

// Asegurarse de que el directorio de sesiones exista al iniciar la aplicación.
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR);
}

/**
 * Crea e inicializa una nueva sesión de WhatsApp o recupera una existente.
 * @param {string} sessionId - El ID único de la sesión.
 * @returns {Promise<any>} La instancia del socket de Baileys.
 */
const createSession = async (sessionId) => {
  // Si la sesión ya está en memoria (en proceso de conexión o activa), la devuelve.
  if (sessions.has(sessionId)) {
    console.log(
      `[${sessionId}] La creación de la sesión ya está en proceso o activa.`
    );
    return sessions.get(sessionId).sock;
  }

  const sessionPath = path.join(SESSIONS_DIR, sessionId);

  // Carga o crea el estado de autenticación multi-archivo para la sesión.
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  // Crea una nueva instancia del socket de Baileys.
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // Deshabilita la impresión de QR en terminal, lo manejamos vía WebSocket.
    logger: pino({ level: "silent" }), // Configura el logger de Baileys.
    browser: Browsers.macOS("Desktop"), // Simula un navegador para la conexión.
  });

  // Almacena la instancia del socket y su estado inicial en el mapa de sesiones.
  sessions.set(sessionId, { sock, status: "initializing", qr: null });

  // Suscribe a los eventos de actualización de credenciales para guardarlas.
  sock.ev.on("creds.update", saveCreds);

  /**
   * Maneja las actualizaciones del estado de conexión de Baileys.
   * @param {object} update - Objeto de actualización de conexión.
   */
  sock.ev.on("connection.update", async (update) => {
    // Made the callback async
    const { connection, lastDisconnect, qr } = update;
    const session = sessions.get(sessionId);

    // Si la sesión no existe en el mapa (ej. fue eliminada), ignora la actualización.
    if (!session) return;

    // Manejo de QR Code
    if (qr) {
      session.status = "qr_pending";
      session.qr = qr;
      // Emite un evento 'qr' para que los clientes WebSocket puedan mostrarlo.
      sessionEmitter.emit("qr", { sessionId, qr });
      console.log(`[${sessionId}] QR Code disponible.`);
    }

    // Manejo de conexión abierta
    if (connection === "open") {
      session.status = "linking"; // Estado intermedio mientras se verifica la vinculación.
      console.log(
        `[${sessionId}] Conexión abierta, verificando vinculación...`
      );
      // Emite una actualización de estado para el cliente.
      sessionEmitter.emit("status_update", { sessionId, status: "linking" });

      // Pequeño retardo para asegurar que Baileys haya guardado las credenciales.
      setTimeout(() => {
        const credsFilePath = path.join(SESSIONS_DIR, sessionId, "creds.json");
        // Verifica si el archivo de credenciales existe, indicando una vinculación exitosa.
        if (fs.existsSync(credsFilePath)) {
          // Solo si el estado no ha cambiado (ej. a desconectado), actualiza a 'connected'.
          if (session.status === "linking") {
            session.status = "connected";
            session.qr = null; // El QR ya no es necesario.
            console.log(`[${sessionId}] Sesión VINCULADA y CONECTADA.`);
            // Emite un evento de conexión abierta exitosa.
            sessionEmitter.emit("connection_open", { sessionId });
          }
        } else {
          // Si no se encontró creds.json después del retardo, algo falló en la vinculación.
          console.error(
            `[${sessionId}] Fallo en la vinculación: creds.json no encontrado.`
          );
          session.status = "failed_linking";
          sessionEmitter.emit("connection_close", {
            sessionId,
            status: "failed_linking",
          });
          // Podríamos intentar limpiar y reiniciar aquí si queremos forzar un nuevo QR.
        }
      }, 1000); // 1 segundo de espera.
    }

    // Manejo de conexión cerrada
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      // Determina si la sesión debe intentar reconectarse o si fue desvinculada permanentemente.
      const shouldReconnect = false; //statusCode !== DisconnectReason.loggedOut;
      const newStatus = shouldReconnect ? "disconnected" : "unlinked";

      // Actualiza el estado de la sesión si ha cambiado.
      if (session.status !== newStatus) {
        session.status = newStatus;
        console.log(
          `[${sessionId}] Conexión cerrada. Estado: ${newStatus}. Razón: ${statusCode}`
        );
        // Emite un evento de cierre de conexión con el nuevo estado.
        sessionEmitter.emit("connection_close", {
          sessionId,
          status: newStatus,
        });
      }

      // Si la sesión fue desvinculada permanentemente, la elimina de la memoria y del disco.
      if (newStatus === "unlinked") {
        if (fs.existsSync(sessionPath)) {
          fs.rmSync(sessionPath, { recursive: true, force: true });
          console.log(`[${sessionId}] Carpeta de sesión eliminada.`);
        }
        // Serializa la operación de escritura en el archivo de configuración.
        sessionConfigPromise = sessionConfigPromise.then(async () => {
          try {
            // También la elimina del archivo de configuración para que no se intente cargar de nuevo.
            const configData = fs.readFileSync(SESSION_CONFIG_PATH, "utf-8");
            const updatedConfigs = JSON.parse(configData).filter(
              (s) => s.sessionId !== sessionId
            );
            fs.writeFileSync(
              SESSION_CONFIG_PATH,
              JSON.stringify(updatedConfigs, null, 2)
            );
            console.log(
              `[${sessionId}] Sesión eliminada de ${SESSION_CONFIG_PATH}.`
            );
          } catch (error) {
            console.error(
              `[${sessionId}] Error al actualizar ${SESSION_CONFIG_PATH} después de desvinculación:`,
              error
            );
          }
        });
        await sessionConfigPromise; // Espera a que la operación de escritura se complete.
        sessions.delete(sessionId); // Elimina la sesión del mapa en memoria.
      }

      // Lógica de reconexión automática
      if (shouldReconnect) {
        // Borra la sesión de la memoria para permitir que `createSession` la recree.
        sessions.delete(sessionId);
        console.log(`[${sessionId}] Programando reconexión en 15 segundos...`);
        setTimeout(() => {
          // Solo intenta recrear la sesión si no se ha reconectado mientras tanto.
          if (!sessions.has(sessionId)) {
            createSession(sessionId).catch((err) =>
              console.error(
                `[${sessionId}] Falla en el reintento de conexión:`,
                err
              )
            );
          }
        }, 15000); // Espera 15 segundos antes de intentar reconectar.
      }
    }
  });

  return sock; // Devuelve la instancia del socket.
};

/**
 * Inicializa todas las sesiones definidas en el archivo de configuración.
 * Se llama al arrancar la aplicación.
 */
const initialize = async () => {
  try {
    const configData = fs.readFileSync(SESSION_CONFIG_PATH, "utf-8");
    const sessionConfigs = JSON.parse(configData);

    for (const config of sessionConfigs) {
      // Crea la sesión solo si no está ya en memoria.
      if (!sessions.has(config.sessionId)) {
        await createSession(config.sessionId);
      }
    }
    console.log("Todas las sesiones inicializadas desde la configuración.");
  } catch (error) {
    console.error(
      "Error al inicializar sesiones desde la configuración:",
      error
    );
  }
};

/**
 * Obtiene un objeto de sesión por su ID.
 * @param {string} sessionId - El ID de la sesión.
 * @returns {{sock: any, status: string, qr: string|null}|undefined} El objeto de sesión o undefined si no se encuentra.
 */
const getSession = (sessionId) => {
  return sessions.get(sessionId);
};

/**
 * Obtiene el estado de todas las sesiones activas.
 * @returns {Array<{sessionId: string, status: string, qr: string}>} Un array de objetos con el estado de cada sesión.
 */
const getAllSessionsStatus = () => {
  const allStatus = [];
  for (const [sessionId, session] of sessions.entries()) {
    allStatus.push({
      sessionId,
      status: session.status,
      qr: session.qr ? "available" : "not_available", // Indica si el QR está disponible sin exponer la cadena.
    });
  }
  return allStatus;
};

module.exports = {
  initialize,
  createSession,
  getSession,
  getAllSessionsStatus,
  sessionEmitter,
};
