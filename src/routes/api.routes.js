const express = require('express');
const authenticateToken = require('../middleware/auth.middleware');
const {
    sendPdfController
} = require('../controllers/api.controller');

const router = express.Router();

// Apply authentication middleware to all API routes
router.use(authenticateToken);

// Existing route for sending PDF
router.post('/send-pdf', sendPdfController);

module.exports = router;
