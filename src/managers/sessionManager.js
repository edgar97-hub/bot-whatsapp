// // RUTA: src/managers/sessionManager.js (en el proyecto del BOT)

// const {
//   makeWASocket,
//   useMultiFileAuthState,
//   DisconnectReason,
//   Browsers,
// } = require("@whiskeysockets/baileys");
// const pino = require("pino");
// const fs = require("fs");
// const path = require("path");
// const EventEmitter = require("events");

// const sessions = new Map();
// const SESSION_CONFIG_PATH = path.resolve("./sessions.config.json");
// const SESSIONS_DIR = path.resolve("./sessions");
// const sessionEmitter = new EventEmitter();

// if (!fs.existsSync(SESSIONS_DIR)) {
//   fs.mkdirSync(SESSIONS_DIR);
// }

// // --- FUNCIÓN DE LIMPIEZA REUTILIZABLE ---
// const cleanupSession = (sessionId) => {
//   const sessionPath = path.join(SESSIONS_DIR, sessionId);
//   if (fs.existsSync(sessionPath)) {
//     fs.rmSync(sessionPath, { recursive: true, force: true });
//     console.log(
//       `[${sessionId}] Carpeta de sesión eliminada para un reinicio limpio.`
//     );
//   }
//   sessions.delete(sessionId);
// };

// const createSession = async (sessionId) => {
//   if (sessions.has(sessionId)) {
//     return sessions.get(sessionId).sock;
//   }

//   const sessionPath = path.join(SESSIONS_DIR, sessionId);
//   const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

//   const sock = makeWASocket({
//     auth: state,
//     printQRInTerminal: false,
//     logger: pino({ level: "silent" }),
//     browser: Browsers.macOS("Desktop"),
//   });

//   sessions.set(sessionId, { sock, status: "initializing", qr: null });

//   sock.ev.on("creds.update", saveCreds);

//   sock.ev.on("connection.update", (update) => {
//     const { connection, lastDisconnect, qr } = update;
//     const session = sessions.get(sessionId);
//     if (!session) return;

//     const currentStatus = session.status;

//     if (qr) {
//       session.status = "qr_pending";
//       session.qr = qr;
//     }

//     if (connection === "open") {
//       session.status = "connected";
//       session.qr = null;
//     }

//     if (connection === "close") {
//       const statusCode = lastDisconnect?.error?.output?.statusCode;
//       const shouldLogout = statusCode === DisconnectReason.loggedOut;

//       if (shouldLogout) {
//         session.status = "unlinked";
//         cleanupSession(sessionId); // Limpiar carpeta y memoria
//         try {
//           // Limpiar el config.json
//           const configData = fs.readFileSync(SESSION_CONFIG_PATH, "utf-8");
//           const updatedConfigs = JSON.parse(configData).filter(
//             (s) => s.sessionId !== sessionId
//           );
//           fs.writeFileSync(
//             SESSION_CONFIG_PATH,
//             JSON.stringify(updatedConfigs, null, 2)
//           );
//         } catch (error) {
//           console.error(
//             `[${sessionId}] Error al actualizar ${SESSION_CONFIG_PATH}:`,
//             error
//           );
//         }
//       } else {
//         // --- ¡LA LÓGICA CLAVE CORREGIDA! ---
//         // Si la conexión se cierra Y estábamos en el proceso de obtener un QR,
//         // significa que la vinculación falló. Debemos limpiar todo para forzar un nuevo QR.
//         if (
//           currentStatus === "qr_pending" ||
//           currentStatus === "initializing"
//         ) {
//           console.log(
//             `[${sessionId}] Vinculación fallida. Limpiando sesión para generar un nuevo QR...`
//           );
//           cleanupSession(sessionId);
//         } else {
//           // Si ya estábamos conectados, simplemente marcamos como desconectado y Baileys reintentará.
//           session.status = "disconnected";
//         }
//       }
//     }
//   });

//   return sock;
// };

// const initialize = async () => {
//   try {
//     const configData = fs.readFileSync(SESSION_CONFIG_PATH, "utf-8");
//     const sessionConfigs = JSON.parse(configData);

//     for (const config of sessionConfigs) {
//       // Check if session already exists before creating
//       if (!sessions.has(config.sessionId)) {
//         await createSession(config.sessionId);
//       }
//     }
//     console.log("Todas las sesiones inicializadas.");
//   } catch (error) {
//     console.error("Error al inicializar sesiones:", error);
//   }
// };

// const getSession = (sessionId) => {
//   return sessions.get(sessionId);
// };

// module.exports = {
//   initialize,
//   createSession,
//   getSession,
// };

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path"); // Usaremos path para construir rutas seguras
const EventEmitter = require("events");

const sessions = new Map();
const SESSION_CONFIG_PATH = path.resolve("./sessions.config.json");
const SESSIONS_DIR = path.resolve("./sessions");
const sessionEmitter = new EventEmitter();

// Asegurarse de que el directorio de sesiones exista
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR);
}

const createSession = async (sessionId) => {
  if (sessions.has(sessionId)) {
    console.log(
      `[${sessionId}] La creación de la sesión ya está en proceso o activa.`
    );
    return sessions.get(sessionId).sock;
  }

  const sessionPath = path.join(SESSIONS_DIR, sessionId);
  const credsFilePath = path.join(sessionPath, "creds.json");

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("Desktop"),
  });

  sessions.set(sessionId, { sock, status: "initializing", qr: null });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    const session = sessions.get(sessionId);
    if (!session) return;

    if (qr) {
      session.status = "qr_pending";
      sessionEmitter.emit("qr", { sessionId, qr });
    }

    if (connection === "open") {
      session.status = "linking";
      console.log(
        `[${sessionId}] Conexión abierta, verificando vinculación...`
      );
      // Notificamos al frontend que estamos en este estado intermedio.
      sessionEmitter.emit("status_update", { sessionId, status: "linking" });

      // Ahora, esperamos un momento para que Baileys guarde las credenciales si es una nueva vinculación.
      // Esto soluciona una condición de carrera donde verificamos creds.json antes de que se escriba.
      setTimeout(() => {
        const credsFilePath = path.join(SESSIONS_DIR, sessionId, "creds.json");
        if (fs.existsSync(credsFilePath)) {
          // Solo si el estado sigue siendo 'linking' lo cambiamos a 'connected'
          if (session.status === "linking") {
            session.status = "connected";
            session.qr = null;
            console.log(`[${sessionId}] Sesión VINCULADA y CONECTADA.`);
            sessionEmitter.emit("connection_open", { sessionId });
          }
        }
      }, 1000);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      let shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      let newStatus = shouldReconnect ? "disconnected" : "unlinked";

      if (session.status !== newStatus) {
        session.status = newStatus;
        console.log(
          `[${sessionId}] Conexión cerrada. Estado: ${newStatus}. Razón: ${statusCode}`
        );
        sessionEmitter.emit("connection_close", {
          sessionId,
          status: newStatus,
        });
      }

      // Eliminar la sesión de la memoria y del disco si se desvinculó
      if (newStatus === "unlinked") {
        if (fs.existsSync(sessionPath)) {
          fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        try {
          const configData = fs.readFileSync(SESSION_CONFIG_PATH, "utf-8");
          const updatedConfigs = JSON.parse(configData).filter(
            (s) => s.sessionId !== sessionId
          );
          fs.writeFileSync(
            SESSION_CONFIG_PATH,
            JSON.stringify(updatedConfigs, null, 2)
          );
        } catch (error) {
          console.error(
            `[${sessionId}] Error al actualizar ${SESSION_CONFIG_PATH}:`,
            error
          );
        }
        sessions.delete(sessionId);
      }

      // Lógica de reconexión robusta
      if (shouldReconnect) {
        // Borramos la sesión de la memoria para permitir que se cree de nuevo
        sessions.delete(sessionId);
        console.log(`[${sessionId}] Programando reconexión en 15 segundos...`);
        setTimeout(() => {
          // Solo intentar crearla de nuevo si no se ha conectado mientras tanto
          if (!sessions.has(sessionId)) {
            createSession(sessionId).catch((err) =>
              console.error(
                `[${sessionId}] Falla en el reintento de conexión.`,
                err
              )
            );
          }
        }, 15000); // Aumentar el tiempo de espera
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
  return sock;
};

const initialize = async () => {
  try {
    const configData = fs.readFileSync(SESSION_CONFIG_PATH, "utf-8");
    const sessionConfigs = JSON.parse(configData);

    for (const config of sessionConfigs) {
      // Check if session already exists before creating
      if (!sessions.has(config.sessionId)) {
        await createSession(config.sessionId);
      }
    }
    console.log("Todas las sesiones inicializadas.");
  } catch (error) {
    console.error("Error al inicializar sesiones:", error);
  }
};

const getSession = (sessionId) => {
  return sessions.get(sessionId);
};

const getAllSessionsStatus = () => {
  const allStatus = [];
  for (const [sessionId, session] of sessions.entries()) {
    allStatus.push({
      sessionId,
      status: session.status,
      qr: session.qr ? "available" : "not_available", // Indicate if QR is available without exposing the QR string
    });
  }
  return allStatus;
};

module.exports = {
  initialize,
  createSession, // Export createSession for dynamic session creation
  getSession,
  getAllSessionsStatus,
  sessionEmitter, // Export the event emitter
};
