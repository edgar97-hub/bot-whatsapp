const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ error: 'Token de autenticación requerido.' });
    }

    if (token !== process.env.API_STATIC_TOKEN) {
        return res.status(403).json({ error: 'Token de autenticación inválido.' });
    }

    next();
};

module.exports = authenticateToken;