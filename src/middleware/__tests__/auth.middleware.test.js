const authenticateToken = require('../auth.middleware');

describe('authenticateToken', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            headers: {}
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
        process.env.API_STATIC_TOKEN = 'TEST_TOKEN';
    });

    afterEach(() => {
        delete process.env.API_STATIC_TOKEN;
    });

    test('should return 401 if no token is provided', () => {
        authenticateToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Token de autenticación requerido.' });
        expect(next).not.toHaveBeenCalled();
    });

    test('should return 403 if an invalid token is provided', () => {
        req.headers.authorization = 'Bearer INVALID_TOKEN';
        authenticateToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Token de autenticación inválido.' });
        expect(next).not.toHaveBeenCalled();
    });

    test('should call next if a valid token is provided', () => {
        req.headers.authorization = 'Bearer TEST_TOKEN';
        authenticateToken(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });
});