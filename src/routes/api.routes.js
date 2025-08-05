const express = require("express");
const authenticateToken = require("../middleware/auth.middleware");
const {
  sendPdfController,
  getStatusSession,
  createSession,
  logout,
} = require("../controllers/api.controller");

const router = express.Router();

// Apply authentication middleware to all API routes
router.use(authenticateToken);

// Existing route for sending PDF
router.post("/send-pdf", sendPdfController);
// router.get("/sessions/:sessionId/status", getStatusSession);
// router.post("/sessions/create", createSession);
router.post("/sessions/:sessionId/logout", logout);

module.exports = router;
