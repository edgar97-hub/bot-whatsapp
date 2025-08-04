const { sendPdfController } = require('../api.controller');
const messageQueue = require('../../managers/messageQueue');

// Mock messageQueue
jest.mock('../../managers/messageQueue', () => ({
    addMessage: jest.fn(),
}));

describe('api.controller', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            body: {},
            params: {},
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            send: jest.fn(),
        };
    });

    describe('sendPdfController', () => {
        test('should return 400 if required parameters are missing', () => {
            req.body = { sessionId: 'test' }; // Missing 'to', 'pdfBase64'
            sendPdfController(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Faltan parámetros requeridos: sessionId, to, pdfBase64.' });
            expect(messageQueue.addMessage).not.toHaveBeenCalled();
        });

        test('should add message to queue and return 202 if parameters are valid', () => {
            req.body = { sessionId: 'test_session', to: '1234567890', pdfBase64: 'JVBERi0xLjQKJ...', fileName: 'document.pdf' };
            sendPdfController(req, res);
            expect(messageQueue.addMessage).toHaveBeenCalledWith(req.body);
            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Mensaje encolado para envío.' });
        });
    });
});