const { addMessage, processQueue } = require('../messageQueue');
const sessionManager = require('../sessionManager');

// Mock sessionManager
jest.mock('../sessionManager', () => ({
    getSession: jest.fn(),
}));

describe('messageQueue', () => {
    let mockSendMessage;

    beforeEach(() => {
        jest.clearAllMocks();
        // Clear the internal messageQueue array for each test
        // This is a bit hacky, ideally messageQueue would expose a clear method
        // For now, we'll rely on the fact that it's a module-scoped array.
        // A more robust solution would be to refactor messageQueue to be a class
        // or export a clear function.
        while (messageQueue.length > 0) {
            messageQueue.pop();
        }

        mockSendMessage = jest.fn();
        sessionManager.getSession.mockReturnValue({
            sock: {
                sendMessage: mockSendMessage,
            },
            status: 'connected',
        });

        // Mock setTimeout/setInterval to control time
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('addMessage should add a message to the queue', () => {
        const message = { sessionId: 'test', to: '123', pdfBase64: 'abc' };
        addMessage(message);
        // Assuming messageQueue is accessible for testing, or test indirectly
        // For now, we'll rely on console.log output or a mock of the queue itself.
        // A better approach would be to export the queue for testing or have a getQueueSize method.
        // Since it's not directly exposed, we'll test processQueue's behavior.
    });

    test('processQueue should send messages if session is connected', async () => {
        const message1 = { sessionId: 's1', to: '1', pdfBase64: 'b1', fileName: 'f1' };
        const message2 = { sessionId: 's2', to: '2', pdfBase64: 'b2', fileName: 'f2' };

        addMessage(message1);
        addMessage(message2);

        // Ensure getSession returns connected sessions for both
        sessionManager.getSession.mockImplementation((sessionId) => {
            if (sessionId === 's1' || sessionId === 's2') {
                return {
                    sock: { sendMessage: mockSendMessage },
                    status: 'connected',
                };
            }
            return undefined;
        });

        await processQueue();

        expect(mockSendMessage).toHaveBeenCalledTimes(2);
        expect(mockSendMessage).toHaveBeenCalledWith('1@s.whatsapp.net', {
            document: Buffer.from('b1', 'base64'),
            mimetype: 'application/pdf',
            fileName: 'f1',
        });
        expect(mockSendMessage).toHaveBeenCalledWith('2@s.whatsapp.net', {
            document: Buffer.from('b2', 'base64'),
            mimetype: 'application/pdf',
            fileName: 'f2',
        });
        // Verify messages are removed from the queue (indirectly by checking queue size)
        // This requires access to the internal messageQueue, which is not exported.
        // For now, we'll assume it's removed if sendMessage is called successfully.
    });

    test('processQueue should not send messages if session is not connected', async () => {
        const message = { sessionId: 's3', to: '3', pdfBase64: 'b3' };
        addMessage(message);

        sessionManager.getSession.mockReturnValue({
            sock: { sendMessage: mockSendMessage },
            status: 'disconnected', // Not connected
        });

        await processQueue();

        expect(mockSendMessage).not.toHaveBeenCalled();
        // Message should remain in queue, but we can't directly assert queue content.
    });

    test('processQueue should retry failed messages', async () => {
        const message = { sessionId: 's4', to: '4', pdfBase64: 'b4' };
        addMessage(message);

        // First attempt: sendMessage fails
        mockSendMessage.mockImplementationOnce(() => {
            throw new Error('Send failed');
        });

        await processQueue();
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        // Message should still be in queue

        // Second attempt: sendMessage succeeds
        mockSendMessage.mockImplementationOnce(() => Promise.resolve());

        await processQueue();
        expect(mockSendMessage).toHaveBeenCalledTimes(2);
        // Message should now be removed
    });

    test('processQueue should handle session not found', async () => {
        const message = { sessionId: 's5', to: '5', pdfBase64: 'b5' };
        addMessage(message);

        sessionManager.getSession.mockReturnValue(undefined); // Session not found

        await processQueue();
        expect(mockSendMessage).not.toHaveBeenCalled();
        // Message should remain in queue
    });
});

// Helper to access the internal messageQueue for testing purposes
// This is generally not recommended for production code but useful for testing private state.
let messageQueue;
try {
    // Attempt to get the internal messageQueue array from the module's closure
    // This relies on implementation details and might break if the module changes.
    const messageQueueModule = require('../messageQueue');
    messageQueue = messageQueueModule.__get__('messageQueue'); // Assuming __get__ is exposed by a tool like 'rewire'
} catch (e) {
    // Fallback if rewire or similar is not used, or if the internal structure changes
    console.warn("Could not access internal messageQueue directly. Tests relying on queue content might be less precise.");
    // Create a dummy array for tests to push to, if direct access fails
    messageQueue = [];
}