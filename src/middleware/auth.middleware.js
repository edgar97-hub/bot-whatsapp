/**
 * @file src/middleware/auth.middleware.js
 * @description Middleware para la autenticación de las solicitudes a la API REST.
 * Valida que el sessionId/token exista en tokens.json.
 * El token puede venir en req.params.token, req.params.sessionId, o req.body.sessionId.
 */

const fs = require("fs");
const path = require("path");

const TOKENS_PATH = path.resolve("./tokens.json");

/**
 * EJEMPLO de tokens.json (NO crear el archivo, solo referencia):
 *
 * ```json
 * [
 *   {
 *     "id": "tok_abc123",
 *     "ruc": "20610795511",
 *     "description": "WhatsApp de Corporación Dluque"
 *   },
 *   {
 *     "id": "tok_def456",
 *     "ruc": "10283079258",
 *     "description": "WhatsApp de Tienda Lima"
 *   }
 * ]
 * ```
 *
 * El administrador crea este archivo manualmente en el servidor.
 * Cada token permite a una empresa vincular su WhatsApp con el bot.
 * El campo `ruc` es opcional (solo como referencia).
 */

/**
 * Carga la lista de tokens permitidos desde tokens.json.
 * @returns {Array<{id: string, ruc?: string, description?: string}>}
 */
const loadTokens = () => {
  try {
    if (!fs.existsSync(TOKENS_PATH)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
  } catch (error) {
    console.error("[auth] Error al cargar tokens.json:", error);
    return [];
  }
};

/**
 * Verifica si un token de sesión existe en tokens.json.
 * @param {string} token
 * @returns {boolean}
 */
const isValidSessionToken = (token) => {
  return loadTokens().some((t) => t.id === token);
};

/**
 * Middleware para autenticar solicitudes API REST.
 *
 * Valida que el sessionId/token exista en tokens.json.
 * El token se extrae de req.params.sessionId, presente en todas las rutas:
 * - POST /api/send-pdf/:sessionId
 * - GET  /api/sessions/:sessionId/status
 * - POST /api/sessions/:sessionId/logout
 *
 * @param {object} req - Objeto de solicitud de Express.
 * @param {object} res - Objeto de respuesta de Express.
 * @param {function} next - Función para pasar el control al siguiente middleware.
 * @returns {void}
 */
const authenticateToken = (req, res, next) => {
  const sessionToken = req.params.sessionId;

  if (!sessionToken) {
    return res.status(401).json({
      success: false,
      error: "Se requiere autenticación (sessionId válido).",
    });
  }

  if (!isValidSessionToken(sessionToken)) {
    return res.status(403).json({
      success: false,
      error: `Token de sesión '${sessionToken}' no está registrado. Verifique que exista en tokens.json.`,
    });
  }

  next();
};

module.exports = { authenticateToken, isValidSessionToken, loadTokens };
