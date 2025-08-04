const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const EventEmitter = require('events');
const sessionManager = require('../sessionManager'); // Import the actual module to test its exports

// Mock Baileys and its dependencies
jest.mock('@whiskeysockets/baileys', () => ({
    makeWASocket: jest.fn(() => ({
        ev: {
            on: jest.fn(),
            emit: jest.fn(),
        },
        ws: {
            close: jest.fn(),
        },
        end: jest.fn(),
    })),
    useMultiFileAuthState: jest.fn(() => Promise.resolve({ state: {}, saveCreds: jest.fn() })),
    DisconnectReason: {
        loggedOut: 401,
        connectionClosed: 500,
    },
}));

jest.mock('pino', () => jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        trace: jest.fn(),
        fatal: jest.fn(),
    })),
})));

jest.mock('fs', () => ({
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(), // Mock writeFileSync as it's used in createSessionController
}));

// Mock the internal 'sessions' Map for testing purposes
// This is a workaround for testing module-scoped state.
let sessionsMap;
try {
    const sessionManagerModule = require('../sessionManager');
    sessionsMap = sessionManagerModule.__get__('sessions'); // Assuming __get__ is exposed by a tool like 'rewire'
} catch (e) {
    console.warn("Could not access internal sessions Map directly. Tests relying on session state might be less precise.");
    sessionsMap = new Map(); // Fallback to a dummy map
}


describe('sessionManager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sessionsMap.clear(); // Clear the internal sessions Map before each test
        // Mock readFileSync for initialize to prevent errors
        fs.readFileSync.mockReturnValue(JSON.stringify([]));
    });

    describe('initialize', () => {
        test('should read session config and create sessions', async () => {
            fs.readFileSync.mockReturnValueOnce(JSON.stringify([
                { sessionId: 'test_session_1', description: 'Test Session 1' },
                { sessionId: 'test_session_2', description: 'Test Session 2' },
            ]));

            await sessionManager.initialize();

            expect(fs.readFileSync).toHaveBeenCalledWith('./sessions.config.json', 'utf-8');
            expect(useMultiFileAuthState).toHaveBeenCalledTimes(2);
            expect(makeWASocket).toHaveBeenCalledTimes(2);
            expect(makeWASocket).toHaveBeenCalledWith(expect.objectContaining({ printQRInTerminal: false }));
            expect(sessionsMap.size).toBe(2);
        });

        test('should log an error if session config reading fails', async () => {
            fs.readFileSync.mockImplementationOnce(() => {
                throw new Error('File not found');
            });
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await sessionManager.initialize();

            expect(consoleErrorSpy).toHaveBeenCalledWith('Error al inicializar sesiones:', expect.any(Error));
            consoleErrorSpy.mockRestore();
        });
    });

    describe('createSession', () => {
        test('should handle QR code generation and emit qr event', async () => {
            const mockSock = makeWASocket();
            const mockOn = mockSock.ev.on;
            const emitSpy = jest.spyOn(sessionManager.sessionEmitter, 'emit');

            // Simulate connection.update event with QR
            mockOn.mockImplementation((event, callback) => {
                if (event === 'connection.update') {
                    callback({ qr: 'test_qr_string', connection: 'connecting' });
                }
            });

            await sessionManager.createSession('new_session_id');
            const session = sessionManager.getSession('new_session_id');

            expect(session.qr).toBe('test_qr_string');
            expect(session.status).toBe('qr_pending');
            expect(emitSpy).toHaveBeenCalledWith('qr', { sessionId: 'new_session_id', qr: 'test_qr_string' });
        });

        test('should handle connection open and emit connection_open event', async () => {
            const mockSock = makeWASocket();
            const mockOn = mockSock.ev.on;
            const emitSpy = jest.spyOn(sessionManager.sessionEmitter, 'emit');

            // Simulate connection.update event with 'open'
            mockOn.mockImplementation((event, callback) => {
                if (event === 'connection.update') {
                    callback({ connection: 'open' });
                }
            });

            await sessionManager.createSession('open_session_id');
            const session = sessionManager.getSession('open_session_id');

            expect(session.status).toBe('connected');
            expect(session.qr).toBeNull();
            expect(emitSpy).toHaveBeenCalledWith('connection_open', { sessionId: 'open_session_id' });
        });

        test('should handle connection close and retry if not logged out', async () => {
            const mockSock = makeWASocket();
            const mockOn = mockSock.ev.on;

            // Mock setTimeout to be synchronous for testing purposes
            jest.useFakeTimers();

            // Simulate connection.update event with 'close' and a non-loggedOut reason
            mockOn.mockImplementation((event, callback) => {
                if (event === 'connection.update') {
                    callback({ connection: 'close', lastDisconnect: { error: { output: { statusCode: DisconnectReason.connectionClosed } } } });
                }
            });

            await sessionManager.createSession('retry_session_id'); // Initial call
            expect(makeWASocket).toHaveBeenCalledTimes(1); // First call

            jest.runAllTimers(); // Fast-forward timers to trigger retry

            expect(makeWASocket).toHaveBeenCalledTimes(2); // Second call due to retry
            jest.useRealTimers();
        });

        test('should handle connection close and not retry if logged out', async () => {
            const mockSock = makeWASocket();
            const mockOn = mockSock.ev.on;

            // Mock setTimeout to be synchronous for testing purposes
            jest.useFakeTimers();

            // Simulate connection.update event with 'close' and loggedOut reason
            mockOn.mockImplementation((event, callback) => {
                if (event === 'connection.update') {
                    callback({ connection: 'close', lastDisconnect: { error: { output: { statusCode: DisconnectReason.loggedOut } } } });
                }
            });

            await sessionManager.createSession('logout_session_id'); // Initial call
            expect(makeWASocket).toHaveBeenCalledTimes(1); // First call

            jest.runAllTimers(); // Fast-forward timers

            expect(makeWASocket).toHaveBeenCalledTimes(1); // No retry
            expect(sessionManager.getSession('logout_session_id')).toBeUndefined(); // Session should be deleted
            jest.useRealTimers();
        });
    });

    describe('getSession', () => {
        test('should return the session object if found', async () => {
            fs.readFileSync.mockReturnValueOnce(JSON.stringify([
                { sessionId: 'existing_session', description: 'Existing Session' },
            ]));
            await sessionManager.initialize();
            const session = sessionManager.getSession('existing_session');
            expect(session).toBeDefined();
            expect(session.status).toBe('initializing'); // Initial status
        });

        test('should return undefined if session is not found', () => {
            const session = sessionManager.getSession('non_existent_session');
            expect(session).toBeUndefined();
        });
    });

    describe('getAllSessionsStatus', () => {
        test('should return status of all active sessions', async () => {
            fs.readFileSync.mockReturnValueOnce(JSON.stringify([
                { sessionId: 'session_a', description: 'Session A' },
                { sessionId: 'session_b', description: 'Session B' },
            ]));
            await sessionManager.initialize();

            // Manually update status for testing purposes (as connection.update is mocked)
            const sessionA = sessionManager.getSession('session_a');
            sessionA.status = 'connected';
            sessionA.qr = null;

            const sessionB = sessionManager.getSession('session_b');
            sessionB.status = 'qr_pending';
            sessionB.qr = 'some_qr_string';

            const statuses = sessionManager.getAllSessionsStatus();
            expect(statuses).toEqual([
                { sessionId: 'session_a', status: 'connected', qr: 'not_available' },
                { sessionId: 'session_b', status: 'qr_pending', qr: 'available' },
            ]);
        });

        test('should return an empty array if no sessions are active', () => {
            // Ensure no sessions are initialized or clear them if they were
            fs.readFileSync.mockReturnValueOnce(JSON.stringify([]));
            // Re-initialize to ensure no sessions are loaded
            sessionManager.initialize(); // This will clear existing sessions if any were loaded by previous tests
            const statuses = sessionManager.getAllSessionsStatus();
            expect(statuses).toEqual([]);
        });
    });
});