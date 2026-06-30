/**
 * @file src/routes/api.routes.js
 * @description Define las rutas de la API REST para el microservicio.
 * Incluye rutas para el envío de documentos PDF, consulta de estado y desvinculación de sesiones.
 */

const express = require("express");
const { authenticateToken } = require("../middleware/auth.middleware");
const {
  sendPdfController,
  logout,
  getSessionStatus,
} = require("../controllers/api.controller");

/**
 * Instancia del enrutador de Express.
 * @type {express.Router}
 */
const router = express.Router();

/**
 * Ruta para enviar documentos PDF.
 * @name POST /ws-bot/send-pdf/:sessionId
 * @function
 * @memberof module:routes/api.routes
 * @param {string} path - Express path con sessionId como parámetro de ruta.
 * @param {function} middleware - Middleware de autenticación.
 * @param {function} controller - Controlador para manejar la lógica de envío de PDF.
 */
router.post("/ws-bot/send-pdf/:sessionId", authenticateToken, sendPdfController);

/**
 * Ruta para consultar el estado de una sesión de WhatsApp.
 * @name GET /ws-bot/sessions/:sessionId/status
 * @function
 * @memberof module:routes/api.routes
 * @param {string} path - Express path.
 * @param {function} middleware - Middleware de autenticación.
 * @param {function} controller - Controlador para obtener el estado de la sesión.
 */
router.get("/ws-bot/sessions/:sessionId/status", authenticateToken, getSessionStatus);

/**
 * Ruta para desvincular una sesión de WhatsApp.
 * @name POST /ws-bot/sessions/:sessionId/logout
 * @function
 * @memberof module:routes/api.routes
 * @param {string} path - Express path.
 * @param {function} middleware - Middleware de autenticación.
 * @param {function} controller - Controlador para manejar la lógica de desvinculación.
 */
router.post("/ws-bot/sessions/:sessionId/logout", authenticateToken, logout);

module.exports = router;
