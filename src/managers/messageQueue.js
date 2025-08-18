/**
 * @file src/managers/messageQueue.js
 * @description Implementa una cola en memoria para la gestión de mensajes salientes de WhatsApp.
 * Los mensajes se encolan y se procesan periódicamente, con lógica de reintento.
 */

const { getSession } = require("./sessionManager");

/**
 * Cola de mensajes en memoria.
 * Cada elemento es un objeto de mensaje a enviar.
 * @type {Array<object>}
 */
const messageQueue = [];

/**
 * Intervalo de tiempo en milisegundos para procesar la cola de mensajes.
 * @type {number}
 */
const PROCESSING_INTERVAL = 5000; // Procesar la cola cada 5 segundos.

/**
 * Añade un mensaje a la cola para su posterior envío.
 * @param {object} message - El objeto del mensaje a encolar.
 * @param {string} message.sessionId - El ID de la sesión de WhatsApp a usar.
 * @param {string} message.to - El número de destino.
 * @param {string} message.pdfBase64 - El contenido del PDF en Base64.
 * @param {string} [message.fileName] - El nombre del archivo PDF.
 * @param {string} [message.caption] - El texto de acompañamiento para el PDF.
 */
const addMessage = (message) => {
  messageQueue.push(message);
  console.log(
    `[MessageQueue] Mensaje añadido a la cola. Tamaño actual: ${messageQueue.length}`
  );
};

/**
 * Procesa la cola de mensajes, intentando enviar cada mensaje.
 * Los mensajes que no se pueden enviar (sesión no conectada o error) permanecen en la cola para reintentos.
 */
const processQueue = async () => {
  if (messageQueue.length === 0) {
    return;
  }

  console.log(
    `[MessageQueue] Procesando cola de mensajes. Tamaño actual: ${messageQueue.length}`
  );

  // Itera sobre la cola de mensajes.
  for (let i = 0; i < messageQueue.length; i++) {
    const message = messageQueue[i];
    const { sessionId, to, pdfBase64, fileName, caption } = message;

    // Intenta obtener la sesión de WhatsApp correspondiente.
    const session = getSession(sessionId);

    // Si la sesión no está disponible o no está conectada, el mensaje se reintentará más tarde.
    if (!session || session.status !== "connected") {
      console.warn(
        `[MessageQueue] Sesión '${sessionId}' no conectada o no encontrada. El mensaje se reintentará.`
      );
      continue; // Pasa al siguiente mensaje en la cola.
    }

    try {
      const formattedTo = `${to}@s.whatsapp.net`;
      const pdfBuffer = Buffer.from(pdfBase64, "base64");

      // Envía el documento PDF.
      await session.sock.sendMessage(formattedTo, {
        document: pdfBuffer,
        mimetype: "application/pdf",
        fileName: fileName || "Comprobante.pdf",
      });

      // Si hay un texto de acompañamiento, lo envía después del PDF.
      if (caption && caption.trim() !== "") {
        console.log(
          `[MessageQueue] Enviando texto de acompañamiento para '${sessionId}' a ${to}...`
        );
        // Pequeña pausa para asegurar el orden de los mensajes en WhatsApp.
        await new Promise((resolve) => setTimeout(resolve, 250));
        await session.sock.sendMessage(formattedTo, {
          text: caption,
        });
      }

      console.log(
        `[MessageQueue] PDF enviado exitosamente para la sesión '${sessionId}' a '${to}'.`
      );
      // Elimina el mensaje de la cola si el envío fue exitoso.
      messageQueue.splice(i, 1);
      i--; // Ajusta el índice ya que un elemento fue eliminado.
    } catch (error) {
      console.error(
        `[MessageQueue] Error al enviar PDF para la sesión '${sessionId}' a '${to}':`,
        error
      );
      // El mensaje permanece en la cola para un futuro reintento.
    }
  }
};

// Inicia el procesamiento periódico de la cola.
setInterval(processQueue, PROCESSING_INTERVAL);

module.exports = {
  addMessage,
  processQueue, // Exportado para propósitos de testing o activación manual si fuera necesario.
};
