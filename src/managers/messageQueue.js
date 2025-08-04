const { getSession } = require("./sessionManager");

const messageQueue = [];
const PROCESSING_INTERVAL = 3000; // Process queue every 5 seconds

const addMessage = (message) => {
  messageQueue.push(message);
  console.log(
    `Message added to queue. Current queue size: ${messageQueue.length}`
  );
};

const processQueue = async () => {
  if (messageQueue.length === 0) {
    return;
  }

  console.log(
    `Processing message queue. Current queue size: ${messageQueue.length}`
  );

  for (let i = 0; i < messageQueue.length; i++) {
    const message = messageQueue[i];
    const { sessionId, to, pdfBase64, fileName, caption } = message;

    const session = getSession(sessionId);

    if (!session || session.status !== "connected") {
      console.warn(
        `Session '${sessionId}' not connected or not found. Message will be retried.`
      );
      continue; // Keep message in queue for retry
    }

    try {
      const formattedTo = `${to}@s.whatsapp.net`;
      const pdfBuffer = Buffer.from(pdfBase64, "base64");

      await session.sock.sendMessage(formattedTo, {
        document: pdfBuffer,
        mimetype: "application/pdf",
        fileName: fileName || "Comprobante.pdf",
        // text: caption ?? "",
      });
      console.log(caption);
      if (caption && caption.trim() !== "") {
        console.log(
          `[${sessionId}] Enviando texto de acompañamiento a ${to}...`
        );

        // Pequeña pausa para asegurar el orden de los mensajes
        await new Promise((resolve) => setTimeout(resolve, 250));

        await session.sock.sendMessage(formattedTo, {
          text: caption,
        });
      }
      console.log(
        `Successfully sent PDF for session '${sessionId}' to '${to}'.`
      );
      messageQueue.splice(i, 1); // Remove message from queue
      i--; // Adjust index after removal
    } catch (error) {
      console.error(
        `Error sending PDF for session '${sessionId}' to '${to}':`,
        error
      );
      // Keep message in queue for retry on error
    }
  }
};

setInterval(processQueue, PROCESSING_INTERVAL);

module.exports = {
  addMessage,
  processQueue,
};
