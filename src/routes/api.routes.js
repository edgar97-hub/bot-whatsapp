/**
 * @file src/routes/api.routes.js
 * @description Define las rutas de la API REST para el microservicio.
 * Incluye rutas para el envío de documentos PDF y la desvinculación de sesiones.
 */

const express = require("express");
const authenticateToken = require("../middleware/auth.middleware");
const { sendPdfController, logout } = require("../controllers/api.controller"); // Importa también la función logout

/**
 * Instancia del enrutador de Express.
 * @type {express.Router}
 */
const router = express.Router();

// Aplica el middleware de autenticación a todas las rutas definidas en este enrutador.
router.use(authenticateToken);

/**
 * Ruta para enviar documentos PDF.
 * @name POST /api/send-pdf
 * @function
 * @memberof module:routes/api.routes
 * @param {string} path - Express path.
 * @param {function} middleware - Middleware de autenticación.
 * @param {function} controller - Controlador para manejar la lógica de envío de PDF.
 */
router.post("/send-pdf", sendPdfController);

/**
 * Ruta para desvincular una sesión de WhatsApp.
 * @name POST /api/sessions/:sessionId/logout
 * @function
 * @memberof module:routes/api.routes
 * @param {string} path - Express path.
 * @param {function} middleware - Middleware de autenticación.
 * @param {function} controller - Controlador para manejar la lógica de desvinculación.
 */
router.post("/sessions/:sessionId/logout", logout);

module.exports = router;
