const { addMessage } = require("../managers/messageQueue");
const sessionManager = require("../managers/sessionManager");

const sendPdfController = (req, res) => {
  const { sessionId, to, pdfBase64, fileName, caption } = req.body;
  if (!sessionId || !to || !pdfBase64) {
    return res.status(400).json({
      error: "Faltan parámetros requeridos: sessionId, to, pdfBase64.",
    });
  }

  addMessage({ sessionId, to, pdfBase64, fileName, caption });

  return res
    .status(202)
    .json({ success: true, message: "Mensaje encolado para envío." });
};

const getStatusSession = (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);
  // console.log(session);
  if (!session) {
    return res.status(404).json({ status: "not_found" });
  }

  // Devolver el estado actual y el QR si está disponible
  return res.status(200).json({
    sessionId: sessionId,
    status: session.status,
    qr: session.qr || null, // Enviar la cadena del QR si existe
  });
};

const createSession = async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId es requerido." });
  }

  const existingSession = sessionManager.getSession(sessionId);
  if (existingSession) {
    return res.status(200).json({
      message: "La sesión ya existe o está en proceso.",
      status: existingSession.status,
    });
  }

  try {
    await sessionManager.createSession(sessionId);
    // Persistir en el config.json si es necesario...
    return res
      .status(202)
      .json({ message: "Proceso de creación de sesión iniciado." });
  } catch (error) {
    return res.status(500).json({ error: "Fallo al crear la sesión." });
  }
};

const logout = async (req, res) => {
  const { sessionId } = req.params;
  console.log(sessionId);
  const session = sessionManager.getSession(sessionId);

  if (!session || !session.sock) {
    return res.status(404).json({
      success: false,
      message: "La sesión no fue encontrada o ya está desconectada.",
    });
  }

  try {
    console.log(`[${sessionId}] Recibida solicitud de logout.`);
    // El método .logout() de Baileys cierra la sesión y emite el evento 'loggedOut'
    await session.sock.logout();

    // La lógica de limpieza de archivos y del config.json ya está en el listener
    // de 'connection.update' cuando detecta DisconnectReason.loggedOut.
    // No necesitamos duplicarla aquí.

    return res.status(200).json({
      success: true,
      message: "La solicitud de desvinculación fue enviada.",
    });
  } catch (error) {
    console.error(`[${sessionId}] Error durante el logout:`, error);
    return res.status(500).json({
      success: false,
      message: "Ocurrió un error al intentar desvincular la sesión.",
    });
  }
};
module.exports = {
  sendPdfController,
  getStatusSession,
  createSession,
  logout,
};
