const { addMessage } = require("../managers/messageQueue");

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

module.exports = {
  sendPdfController,
};
