/**
 * @file src/managers/messageQueue.js
 * @description Implementa una cola en memoria para la gestión de mensajes salientes de WhatsApp.
 * Los mensajes se encolan y se procesan periódicamente, con lógica de reintento y límite de intentos.
 * Incluye drenaje automático de mensajes huérfanos (sesión eliminada) y protección contra memory leaks.
 */

const { getSession } = require("./sessionManager");

/**
 * Cola de mensajes en memoria.
 * Cada elemento es un objeto de mensaje a enviar con metadatos de reintento.
 * @type {Array<{sessionId: string, to: string, pdfBase64: string, fileName?: string, caption?: string, retryCount: number, createdAt: number}>}
 */
const messageQueue = [];

/**
 * Intervalo de tiempo en milisegundos para procesar la cola de mensajes.
 * @type {number}
 */
const PROCESSING_INTERVAL = 5000; // Procesar la cola cada 5 segundos.

/**
 * Número máximo de reintentos antes de descartar un mensaje.
 * @type {number}
 */
const MAX_RETRIES = 3;

/**
 * Tiempo máximo de vida de un mensaje en la cola en milisegundos (5 minutos).
 * @type {number}
 */
const MESSAGE_TTL = 5 * 60 * 1000;

/**
 * Tamaño máximo de la cola para evitar memory leaks.
 * @type {number}
 */
const MAX_QUEUE_SIZE = 100;

/**
 * Cache de sesiones que se sabe que no existen (para drenaje rápido).
 * Se limpia periódicamente.
 * @type {Set<string>}
 */
const deadSessionsCache = new Set();

/**
 * Intervalo para limpiar el cache de sesiones muertas (cada 2 minutos).
 * @type {number}
 */
const DEAD_SESSION_CACHE_TTL = 2 * 60 * 1000;

// Limpia periódicamente el cache de sesiones muertas para permitir reintentos
// si la sesión se vuelve a crear.
setInterval(() => {
  if (deadSessionsCache.size > 0) {
    console.log(
      `[MessageQueue] Limpiando cache de sesiones muertas (${deadSessionsCache.size} sesiones).`
    );
    deadSessionsCache.clear();
  }
}, DEAD_SESSION_CACHE_TTL);

/**
 * Añade un mensaje a la cola para su posterior envío.
 * Si la cola está llena, elimina el mensaje más antiguo (FIFO) para hacer espacio.
 * @param {object} message - El objeto del mensaje a encolar.
 * @param {string} message.sessionId - El ID de la sesión de WhatsApp a usar.
 * @param {string} message.to - El número de destino.
 * @param {string} message.pdfBase64 - El contenido del PDF en Base64.
 * @param {string} [message.fileName] - El nombre del archivo PDF.
 * @param {string} [message.caption] - El texto de acompañamiento para el PDF.
 * @returns {boolean} true si el mensaje fue encolado, false si la cola está llena.
 */
const addMessage = (message) => {
  if (messageQueue.length >= MAX_QUEUE_SIZE) {
    // En lugar de rechazar, elimina el mensaje más antiguo (FIFO) para hacer espacio.
    // Esto asegura que siempre se puedan encolar mensajes nuevos y los viejos se descartan.
    const removed = messageQueue.shift();
    console.warn(
      `[MessageQueue] Cola llena (${MAX_QUEUE_SIZE}). Eliminando mensaje más antiguo para ${removed.sessionId} para hacer espacio.`
    );
  }

  messageQueue.push({
    ...message,
    retryCount: 0,
    createdAt: Date.now(),
  });
  console.log(
    `[MessageQueue] Mensaje añadido a la cola. Tamaño actual: ${messageQueue.length}`
  );
  return true;
};

/**
 * Procesa la cola de mensajes, intentando enviar cada mensaje.
 * Los mensajes que exceden MAX_RETRIES o MESSAGE_TTL son descartados.
 * Los mensajes para sesiones que ya no existen se descartan inmediatamente
 * (drenaje automático).
 */
const processQueue = async () => {
  if (messageQueue.length === 0) {
    return;
  }

  const now = Date.now();
  let discardedCount = 0;
  let sentCount = 0;

  // Itera sobre la cola de mensajes en orden inverso para poder eliminar elementos seguros.
  for (let i = messageQueue.length - 1; i >= 0; i--) {
    const message = messageQueue[i];
    const { sessionId, to, pdfBase64, fileName, caption, retryCount, createdAt } = message;

    // --- DRENAJE RÁPIDO: Mensajes para sesiones que se sabe que no existen ---
    if (deadSessionsCache.has(sessionId)) {
      console.warn(
        `[MessageQueue] Drenaje rápido: sesión '${sessionId}' no existe. Descartando mensaje para ${to}.`
      );
      messageQueue.splice(i, 1);
      discardedCount++;
      continue;
    }

    // --- Verificación de TTL (tiempo máximo de vida) ---
    if (now - createdAt > MESSAGE_TTL) {
      console.warn(
        `[MessageQueue] Mensaje expirado (TTL) para sesión '${sessionId}' a '${to}'. Descartando.`
      );
      messageQueue.splice(i, 1);
      discardedCount++;
      continue;
    }

    // --- Verificación de máximo de reintentos ---
    if (retryCount >= MAX_RETRIES) {
      console.error(
        `[MessageQueue] Mensaje descartado para sesión '${sessionId}' a '${to}' después de ${MAX_RETRIES} intentos fallidos.`
      );
      messageQueue.splice(i, 1);
      discardedCount++;
      continue;
    }

    // --- Obtener la sesión ---
    const session = getSession(sessionId);

    // Si la sesión no existe en absoluto (no está en el mapa de sesiones),
    // la agregamos al cache de sesiones muertas para drenaje rápido futuro.
    if (!session) {
      deadSessionsCache.add(sessionId);
      console.warn(
        `[MessageQueue] Sesión '${sessionId}' no encontrada en memoria. Agregada a cache de drenaje. Intento ${retryCount + 1}/${MAX_RETRIES}.`
      );
      message.retryCount++;
      continue;
    }

    // Si la sesión existe pero no está conectada, reintentar más tarde.
    if (session.status !== "connected") {
      console.warn(
        `[MessageQueue] Sesión '${sessionId}' en estado '${session.status}'. Intento ${retryCount + 1}/${MAX_RETRIES}.`
      );
      message.retryCount++;
      continue;
    }

    // --- La sesión está conectada, proceder a enviar ---
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
        await new Promise((resolve) => setTimeout(resolve, 250));
        await session.sock.sendMessage(formattedTo, {
          text: caption,
        });
      }

      console.log(
        `[MessageQueue] PDF enviado exitosamente para la sesión '${sessionId}' a '${to}'.`
      );
      messageQueue.splice(i, 1);
      sentCount++;
    } catch (error) {
      console.error(
        `[MessageQueue] Error al enviar PDF para la sesión '${sessionId}' a '${to}':`,
        error
      );
      message.retryCount++;
    }
  }

  if (discardedCount > 0 || sentCount > 0) {
    console.log(
      `[MessageQueue] Ciclo completado. Enviados: ${sentCount}, Descartados: ${discardedCount}, Restantes: ${messageQueue.length}`
    );
  }
};

// Inicia el procesamiento periódico de la cola.
setInterval(processQueue, PROCESSING_INTERVAL);

module.exports = {
  addMessage,
  processQueue,
};
