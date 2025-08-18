/**
 * @file src/middleware/auth.middleware.js
 * @description Middleware para la autenticación de las solicitudes a la API REST.
 * Valida un token estático proporcionado en el encabezado 'Authorization'.
 */

/**
 * Middleware para autenticar solicitudes API usando un Bearer Token estático.
 * Compara el token proporcionado en el encabezado 'Authorization' con el
 * `API_STATIC_TOKEN` configurado en las variables de entorno.
 * @param {object} req - Objeto de solicitud de Express.
 * @param {object} res - Objeto de respuesta de Express.
 * @param {function} next - Función para pasar el control al siguiente middleware.
 * @returns {void}
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  // Extrae el token después de "Bearer "
  const token = authHeader && authHeader.split(" ")[1];

  // Si no hay token, devuelve un error 401 (Unauthorized).
  if (token == null) {
    return res
      .status(401)
      .json({ error: "Token de autenticación requerido." });
  }

  // Si el token no coincide con el token estático configurado, devuelve un error 403 (Forbidden).
  if (token !== process.env.API_STATIC_TOKEN) {
    return res
      .status(403)
      .json({ error: "Token de autenticación inválido." });
  }

  // Si el token es válido, pasa el control al siguiente middleware o controlador.
  next();
};

module.exports = authenticateToken;