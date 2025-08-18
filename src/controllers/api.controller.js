/**
 * @file src/controllers/api.controller.js
 * @description Controladores para los endpoints de la API REST.
 * Incluye la lógica para el envío de documentos PDF y la desvinculación de sesiones.
 */

const { addMessage } = require("../managers/messageQueue");
const sessionManager = require("../managers/sessionManager"); // Import sessionManager

/**
 * Controlador para el endpoint POST /api/send-pdf.
 * Encola un mensaje para enviar un documento PDF a través de WhatsApp.
 * @param {object} req - Objeto de solicitud de Express.
 * @param {object} req.body - Cuerpo de la solicitud.
 * @param {string} req.body.sessionId - ID de la sesión de WhatsApp a utilizar.
 * @param {string} req.body.to - Número de teléfono del destinatario.
 * @param {string} req.body.pdfBase64 - Contenido del PDF codificado en Base64.
 * @param {string} [req.body.fileName] - Nombre del archivo PDF (opcional).
 * @param {string} [req.body.caption] - Texto de acompañamiento para el PDF (opcional).
 * @param {object} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
const sendPdfController = (req, res) => {
  const { sessionId, to, pdfBase64, fileName, caption } = req.body;

  // Valida que los parámetros requeridos estén presentes.
  if (!sessionId || !to || !pdfBase64) {
    return res.status(400).json({
      error: "Faltan parámetros requeridos: sessionId, to, pdfBase64.",
    });
  }

  // Añade el mensaje a la cola para su procesamiento asíncrono.
  addMessage({ sessionId, to, pdfBase64, fileName, caption });

  // Responde inmediatamente con un 202 Accepted, indicando que la solicitud fue aceptada
  // y será procesada.
  return res
    .status(202)
    .json({ success: true, message: "Mensaje encolado para envío." });
};

/**
 * Controlador para el endpoint POST /api/sessions/:sessionId/logout.
 * Desvincula una sesión de WhatsApp.
 * @param {object} req - Objeto de solicitud de Express.
 * @param {object} req.params - Parámetros de la ruta.
 * @param {string} req.params.sessionId - ID de la sesión a desvincular.
 * @param {object} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
const logout = async (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);

  // Verifica si la sesión existe y tiene un socket activo.
  if (!session || !session.sock) {
    return res.status(404).json({
      success: false,
      message: "La sesión no fue encontrada o ya está desconectada.",
    });
  }

  try {
    console.log(`[${sessionId}] Recibida solicitud de logout.`);
    // Llama al método logout de Baileys. Esto también activará la lógica de limpieza
    // en sessionManager.js (eliminación de archivos y del config.json).
    await session.sock.logout();

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
  logout, // Exporta la función de logout
};
