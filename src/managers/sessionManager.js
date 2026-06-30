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
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const { isValidSessionToken } = require("../middleware/auth.middleware");

/**
 * Mapa para almacenar las instancias de las sesiones activas.
 * La clave es el sessionId y el valor es un objeto con { sock, status, qr }.
 * @type {Map<string, {sock: any, status: string, qr: string|null}>}
 */
const sessions = new Map();

/**
 * Directorio raíz para los datos de autenticación de las sesiones.
 * Baileys guarda automaticamente las credenciales (creds.json) en subcarpetas.
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
      `[${sessionId}] La creación de la sesión ya está en proceso o activa.`,
    );
    return sessions.get(sessionId).sock;
  }

  const sessionPath = path.join(SESSIONS_DIR, sessionId);

  // Carga o crea el estado de autenticación multi-archivo para la sesión.
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  // Obtiene la última versión de WhatsApp compatible con Baileys desde el
  // repositorio oficial. Esto evita el error 405 (Connection Failure) que
  // ocurre cuando se negocia una versión que WhatsApp ya no acepta.
  const { version } = await fetchLatestBaileysVersion();
  console.log(`[${sessionId}] Usando versión de WhatsApp: ${version.join(".")}`);

  // Crea una nueva instancia del socket de Baileys.
  const sock = makeWASocket({
    version,
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
        `[${sessionId}] Conexión abierta, verificando vinculación...`,
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
            `[${sessionId}] Fallo en la vinculación: creds.json no encontrado.`,
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
      console.log(lastDisconnect?.error);
      // Determina si la sesión debe intentar reconectarse o si fue desvinculada permanentemente.
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      // Error 405 = credenciales corruptas/expiradas (badSession).
      // En este caso, debemos eliminar las credenciales del disco para que
      // Baileys genere un QR nuevo en el proximo intento.
      const isBadSession = statusCode === 405;
      const newStatus = isLoggedOut ? "unlinked" : "disconnected";

      // Actualiza el estado de la sesión si ha cambiado.
      if (session.status !== newStatus) {
        session.status = newStatus;
        console.log(
          `[${sessionId}] Conexión cerrada. Estado: ${newStatus}. Razón: ${statusCode}`,
        );
        // Emite un evento de cierre de conexión con el nuevo estado.
        sessionEmitter.emit("connection_close", {
          sessionId,
          status: newStatus,
        });
      }

      // Si la sesión fue desvinculada (loggedOut de WhatsApp):
      // - Si fue un logout INTENCIONAL (desde la UI), eliminamos las credenciales del disco
      //   para que no se reconecte automáticamente y se genere un nuevo QR.
      // - Si fue un logout NO intencional (WhatsApp cerró la sesión), mantenemos las
      //   credenciales para intentar reconectar.
      if (isLoggedOut) {
        sessions.delete(sessionId); // Elimina la sesión del mapa en memoria.

        // Verificar si el logout fue intencional (desde la UI)
        // El controlador de logout establece session.intentionalLogout = true
        // antes de llamar a sock.logout()
        if (session.intentionalLogout) {
          // Eliminar las credenciales del disco para que no se reconecte
          const sessionPath = path.join(SESSIONS_DIR, sessionId);
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log(
              `[${sessionId}] Logout intencional. Credenciales eliminadas del disco.`,
            );
          }
        } else {
          // Logout no intencional: mantener credenciales para reconectar
          console.log(
            `[${sessionId}] Sesión desvinculada (no intencional). Programando reconexión automática en 30 segundos...`,
          );
          setTimeout(() => {
            if (!sessions.has(sessionId)) {
              console.log(
                `[${sessionId}] Intentando reconexión automática después de desvinculación...`,
              );
              createSession(sessionId).catch((err) =>
                console.error(
                  `[${sessionId}] Falla en reconexión automática post-logout:`,
                  err,
                ),
              );
            }
          }, 30000); // Espera 30 segundos antes de reintentar.
        }
      }

      // Lógica de reconexión automática para desconexiones temporales (pérdida de red, timeout, etc.)
      if (!isLoggedOut) {
        // Borra la sesión de la memoria para permitir que `createSession` la recree.
        sessions.delete(sessionId);

        // Si las credenciales estan corruptas (error 405), eliminarlas del disco
        // para que Baileys genere un QR nuevo en el proximo intento.
        if (isBadSession) {
          const sessionPath = path.join(SESSIONS_DIR, sessionId);
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log(
              `[${sessionId}] Credenciales corruptas eliminadas. Se generara un nuevo QR.`,
            );
          }
          // Para badSession, reconectar rapido para mostrar el QR
          console.log(
            `[${sessionId}] Programando reconexión para nuevo QR en 3 segundos...`,
          );
          setTimeout(() => {
            if (!sessions.has(sessionId)) {
              createSession(sessionId).catch((err) =>
                console.error(
                  `[${sessionId}] Falla en el reintento post-badSession:`,
                  err,
                ),
              );
            }
          }, 3000); // 3 segundos para mostrar QR rapidamente
        } else {
          console.log(
            `[${sessionId}] Programando reconexión en 15 segundos...`,
          );
          setTimeout(() => {
            // Solo intenta recrear la sesión si no se ha reconectado mientras tanto.
            if (!sessions.has(sessionId)) {
              createSession(sessionId).catch((err) =>
                console.error(
                  `[${sessionId}] Falla en el reintento de conexión:`,
                  err,
                ),
              );
            }
          }, 15000); // Espera 15 segundos antes de intentar reconectar.
        }
      }
    }
  });

  return sock; // Devuelve la instancia del socket.
};

/**
 * Inicializa las sesiones de WhatsApp leyendo directamente el directorio sessions/.
 * Baileys guarda automaticamente las credenciales (creds.json) en subcarpetas
 * dentro de sessions/. Cada subcarpeta con creds.json es una sesion vinculada.
 * Las carpetas sin creds.json se ignoran (esperan vinculacion via QR).
 */
const initialize = async () => {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      console.log("Directorio de sesiones creado.");
      return;
    }

    const sessionDirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    let connectedCount = 0;

    for (const dirent of sessionDirs) {
      if (!dirent.isDirectory()) continue;

      const sessionId = dirent.name;
      if (sessions.has(sessionId)) continue;

      // Solo conectar si existe creds.json (sesion vinculada)
      const credsPath = path.join(SESSIONS_DIR, sessionId, "creds.json");
      if (fs.existsSync(credsPath)) {
        // Validar que el token exista en tokens.json
        if (!isValidSessionToken(sessionId)) {
          console.log(
            `[${sessionId}] Token no registrado en tokens.json. Eliminando credenciales huérfanas...`,
          );
          fs.rmSync(path.join(SESSIONS_DIR, sessionId), {
            recursive: true,
            force: true,
          });
          continue;
        }
        await createSession(sessionId);
        connectedCount++;
      }
      // Si no hay creds.json, la carpeta es de una sesion que se desconecto
      // o nunca se vinculo. Se ignora silenciosamente.
    }

    if (connectedCount > 0) {
      console.log(
        `${connectedCount} sesion(es) con credenciales inicializada(s).`,
      );
    } else {
      console.log(
        "No se encontraron sesiones con credenciales. Esperando vinculacion via QR...",
      );
    }
  } catch (error) {
    console.error("Error al inicializar sesiones:", error);
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
