/**
 * @file app.js
 * @description Punto de entrada principal para el microservicio de bot de WhatsApp.
 * Configura el servidor Express para la API REST, el servidor WebSocket para la gestión
 * de sesiones en tiempo real, y una interfaz HTML embebida para vinculación vía iframe.
 */

require("dotenv").config(); // Carga las variables de entorno desde el archivo .env
const express = require("express");
const http = require("http"); // Módulo nativo de Node.js para crear el servidor HTTP
const { WebSocketServer } = require("ws"); // Librería WebSocket
const apiRoutes = require("./src/routes/api.routes"); // Rutas de la API REST
const sessionManager = require("./src/managers/sessionManager"); // Gestor de sesiones de Baileys
const { isValidSessionToken } = require("./src/middleware/auth.middleware"); // Validador de tokens

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));
app.use("/", apiRoutes);

// ========================================================================
// RUTA HTML EMBEBIDA PARA VINCULACION VIA IFRAME
// ========================================================================

/**
 * Sirve una pagina HTML completa para la vinculacion de WhatsApp.
 * Esta pagina se carga en un iframe desde el frontend principal (React)
 * a traves del proxy HTTPS del backend central.
 *
 * La pagina maneja internamente:
 * - Conexion WebSocket al bot para recibir QR y estado
 * - Visualizacion del codigo QR
 * - Estados: conectado, desconectado, error, desvinculado
 * - Boton de desvincular sesion
 * - Auto-reconexion con backoff exponencial
 * - postMessage al padre con el estado actual
 *
 * @name GET /link/:sessionId
 */
app.get("/ws-bot/link/:token", (req, res) => {
  const { token } = req.params;

  if (!token) {
    return res.status(400).send("Token es requerido");
  }

  // Validar que el token exista en tokens.json
  if (!isValidSessionToken(token)) {
    return res
      .status(403)
      .send(
        `Token '${token}' no está registrado. Verifique que exista en tokens.json.`,
      );
  }

  // Determinar la URL base para el WebSocket.
  // Si el frontend envía ?host=... (cuando usa proxy del backend), se usa tal cual
  // (debe incluir el protocolo y el prefijo /ws-bot, ej: wss://www.corpdluque.com:5002/ws-bot).
  // Si no, se asume acceso directo al bot y se construye con el protocolo detectado.
  // const wsBaseUrl = "wss://127.00.1:5002/ws-bot/ws/session";
  const wsBaseUrl = req.query.host
    ? `${req.query.host}/ws/session`
    : `${req.protocol === "https" ? "wss" : "ws"}://localhost:${PORT}/ws/session`;
  console.log("wsBaseUrl", wsBaseUrl);
  // El token se usa como sessionId para Baileys

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vincular WhatsApp</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: transparent;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      background: #f5f5f5;
      border-radius: 16px;
      padding: 24px;
      width: 100%;
      max-width: 360px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      text-align: center;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .header h2 {
      font-size: 1.1rem;
      color: #333;
    }
    .chip {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .chip.connected { background: #e8f5e9; color: #2e7d32; }
    .chip.disconnected { background: #f5f5f5; color: #666; }
    .chip.qr_pending { background: #fff3e0; color: #e65100; }
    .chip.initializing { background: #e3f2fd; color: #1565c0; }
    .chip.error { background: #ffebee; color: #c62828; }
    .chip.unlinked { background: #fce4ec; color: #880e4f; }
    .chip.linking { background: #e8f5e9; color: #2e7d32; }
    .qr-container {
      background: white;
      border-radius: 12px;
      padding: 16px;
      margin: 16px 0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 256px;
      box-shadow: inset 0 2px 8px rgba(0,0,0,0.06);
    }
    .qr-container svg, .qr-container img { display: block; max-width: 100%; height: auto; }
    .status-display {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 256px;
      padding: 16px;
    }
    .status-icon { font-size: 48px; margin-bottom: 12px; }
    .status-title { font-size: 1.1rem; font-weight: 600; color: #333; margin-bottom: 4px; }
    .status-subtitle { font-size: 0.85rem; color: #666; margin-bottom: 16px; }
    .btn {
      padding: 8px 20px;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary { background: #25D366; color: white; }
    .btn-primary:hover { background: #1da851; }
    .btn-danger { background: transparent; color: #d32f2f; border: 1px solid #d32f2f; }
    .btn-danger:hover { background: #ffebee; }
    .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-outline { background: transparent; color: #25D366; border: 1px solid #25D366; }
    .btn-outline:hover { background: #e8f5e9; }
    .spinner {
      width: 40px; height: 40px;
      border: 4px solid #e0e0e0;
      border-top: 4px solid #25D366;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .hidden { display: none; }
    .error-text { color: #d32f2f; font-size: 0.85rem; margin-top: 8px; }
    .refresh-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1.2rem; color: #666; padding: 4px;
    }
    .refresh-btn:hover { color: #333; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>WhatsApp</h2>
      <div style="display:flex;align-items:center;gap:8px;">
        <span id="statusChip" class="chip initializing">Inicializando</span>
        <button class="refresh-btn" id="refreshBtn" title="Reconectar">&#x21bb;</button>
      </div>
    </div>

    <!-- QR Pendiente -->
    <div id="qrView" class="hidden">
      <div class="qr-container" id="qrContainer"></div>
      <p style="font-size:0.85rem;color:#666;">Escanee el codigo QR con WhatsApp</p>
    </div>

    <!-- Inicializando -->
    <div id="initializingView" class="status-display">
      <div class="spinner"></div>
      <div class="status-title">Inicializando conexion...</div>
    </div>

    <!-- Vinculando -->
    <div id="linkingView" class="status-display hidden">
      <div class="spinner"></div>
      <div class="status-title">Vinculando sesion</div>
      <div class="status-subtitle">Esto puede tardar unos segundos</div>
    </div>

    <!-- Conectado -->
    <div id="connectedView" class="status-display hidden">
      <div class="status-icon">&#x2705;</div>
      <div class="status-title">WhatsApp Conectado</div>
      <div class="status-subtitle">La sesion esta activa y lista para enviar mensajes</div>
      <button class="btn btn-danger" id="logoutBtn">Desvincular Sesion</button>
    </div>

    <!-- Desvinculado -->
    <div id="unlinkedView" class="status-display hidden">
      <div class="status-icon">&#x26A0;&#xFE0F;</div>
      <div class="status-title">Sesion Desvinculada</div>
      <div class="status-subtitle">La sesion fue cerrada desde el telefono</div>
      <button class="btn btn-primary" id="relinkBtn">Vincular de Nuevo</button>
    </div>

    <!-- Desconectado -->
    <div id="disconnectedView" class="status-display hidden">
      <div class="status-icon">&#x1F517;</div>
      <div class="status-title">WhatsApp Desconectado</div>
      <div class="status-subtitle">Reconectando automaticamente...</div>
      <button class="btn btn-primary" id="reconnectBtn">Vincular Dispositivo</button>
    </div>

    <!-- Error -->
    <div id="errorView" class="status-display hidden">
      <div class="status-icon">&#x274C;</div>
      <div class="status-title">Error de Conexion</div>
      <div class="status-subtitle" id="errorMessage">Error desconocido</div>
    </div>
  </div>

  <script>
    (function() {
      var sessionId = '${token}';
      // CORRECCION: El backend (puerto 5002) siempre corre con HTTPS,
      // tanto en local como en produccion. El iframe se carga via HTTPS,
      // por lo que el WebSocket DEBE usar wss:// para evitar mixed content.
      // El server.on("upgrade") del backend captura wss:// y lo redirige al bot.
      var wsBaseUrl = '${wsBaseUrl}'
      var ws = null;
      var reconnectTimeout = null;
      var reconnectAttempts = 0;
      var MAX_RECONNECT_ATTEMPTS = 5;
      var isLoggingOut = false;
      var currentStatus = 'initializing';

      function $(id) { return document.getElementById(id); }

      /** Envia el estado actual al padre via postMessage */
      function notifyParent(status) {
        try {
          window.parent.postMessage({
            type: 'whatsapp-linker-status',
            sessionId: sessionId,
            status: status
          }, '*');
        } catch(e) {
          // Si no hay padre (no esta en iframe), ignorar silenciosamente
        }
      }

      function showView(viewId) {
        var views = ['qrView','initializingView','linkingView','connectedView','unlinkedView','disconnectedView','errorView'];
        for (var i = 0; i < views.length; i++) {
          $(views[i]).classList.toggle('hidden', views[i] !== viewId);
        }
      }

      function updateChip(label, className) {
        var chip = $('statusChip');
        chip.textContent = label;
        chip.className = 'chip ' + className;
      }

      function setStatus(status) {
        currentStatus = status;
        notifyParent(status);
      }

      function connect() {
        if (ws && ws.readyState < 2) {
          return;
        }

        showView('initializingView');
        updateChip('Inicializando', 'initializing');
        setStatus('initializing');

        var url = wsBaseUrl + '/' + sessionId;
        ws = new WebSocket(url);

        ws.onopen = function() {
          reconnectAttempts = 0;
        };

        ws.onmessage = function(event) {
          try {
            var msg = JSON.parse(event.data);
            switch (msg.event) {
              case 'status':
                handleStatus(msg.data);
                break;
              case 'qr':
                renderQr(msg.data);
                showView('qrView');
                updateChip('Esperando QR', 'qr_pending');
                setStatus('qr_pending');
                break;
              case 'error':
                $('errorMessage').textContent = msg.message || 'Error del servidor';
                showView('errorView');
                updateChip('Error', 'error');
                setStatus('error');
                break;
            }
          } catch(e) {
            console.error('Error parseando mensaje:', e);
          }
        };

        ws.onerror = function() {
          if (!isLoggingOut) {
            $('errorMessage').textContent = 'No se pudo conectar al servidor';
            showView('errorView');
            updateChip('Error', 'error');
            setStatus('error');
          }
        };

        ws.onclose = function() {
          if (isLoggingOut) return;

          // Si estamos en un estado final, no reconectar
          if (currentStatus === 'connected' || currentStatus === 'unlinked') return;

          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            var delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            reconnectAttempts++;
            showView('disconnectedView');
            updateChip('Desconectado', 'disconnected');
            setStatus('disconnected');
            reconnectTimeout = setTimeout(connect, delay);
          } else {
            showView('disconnectedView');
            updateChip('Desconectado', 'disconnected');
            setStatus('disconnected');
          }
        };
      }

      function handleStatus(status) {
        switch (status) {
          case 'connected':
          case 'already_connected':
            showView('connectedView');
            updateChip('Conectado', 'connected');
            setStatus('connected');
            break;
          case 'disconnected':
            showView('disconnectedView');
            updateChip('Desconectado', 'disconnected');
            setStatus('disconnected');
            break;
          case 'unlinked':
            showView('unlinkedView');
            updateChip('Desvinculado', 'unlinked');
            setStatus('unlinked');
            break;
          case 'linking':
            showView('linkingView');
            updateChip('Vinculando', 'linking');
            setStatus('linking');
            break;
          case 'qr_pending':
            updateChip('Esperando QR', 'qr_pending');
            setStatus('qr_pending');
            break;
          case 'initializing':
            showView('initializingView');
            updateChip('Inicializando', 'initializing');
            setStatus('initializing');
            break;
        }
      }

      function renderQr(qrData) {
        var container = $('qrContainer');
        container.innerHTML = '';
        if (!qrData) return;

        // Si el QR viene como SVG
        if (qrData.startsWith('<svg')) {
          container.innerHTML = qrData;
        } else if (qrData.startsWith('data:image')) {
          var img = document.createElement('img');
          img.src = qrData;
          img.style.width = '256px';
          img.style.height = '256px';
          container.appendChild(img);
        } else {
          // Si es texto plano, mostrar como QR usando qrcode-generator
          if (typeof QRCode === 'undefined') {
            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
            script.onload = function() {
              new QRCode(container, { text: qrData, width: 256, height: 256 });
            };
            document.head.appendChild(script);
          } else {
            new QRCode(container, { text: qrData, width: 256, height: 256 });
          }
        }
      }

      function logout() {
        if (!confirm('Esta seguro de que desea desvincular esta sesion?')) return;
        isLoggingOut = true;
        $('logoutBtn').disabled = true;
        $('logoutBtn').textContent = 'Desvinculando...';

        fetch('/ws-bot/sessions/' + sessionId + '/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success) {
            handleStatus('unlinked');
          } else {
            alert(data.message || 'Error al desvincular');
          }
        })
        .catch(function(err) {
          alert('Error de red: ' + err.message);
        })
        .finally(function() {
          isLoggingOut = false;
          $('logoutBtn').disabled = false;
          $('logoutBtn').textContent = 'Desvincular Sesion';
        });
      }

      // Eventos de botones
      $('logoutBtn').addEventListener('click', logout);
      $('relinkBtn').addEventListener('click', function() {
        reconnectAttempts = 0;
        connect();
      });
      $('reconnectBtn').addEventListener('click', function() {
        reconnectAttempts = 0;
        connect();
      });
      $('refreshBtn').addEventListener('click', function() {
        if (ws) { ws.onclose = null; ws.close(); }
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectAttempts = 0;
        connect();
      });

      // Iniciar conexion
      connect();
    })();
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Permitir que sea cargado en iframe desde cualquier origen
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.send(html);
});

/**
 * Maneja las nuevas conexiones WebSocket.
 * Extrae el sessionId de la URL y delega la gestión a `handleWebSocketSession`.
 * @param {WebSocket} ws - La instancia del WebSocket conectado.
 * @param {IncomingMessage} req - El objeto de la solicitud HTTP entrante.
 */
wss.on("connection", (ws, req) => {
  const urlParts = req.url.split("/");
  // El sessionId se espera como el último segmento de la URL (ej. /ws/session/mySessionId)
  const sessionId = urlParts[urlParts.length - 1];

  if (!sessionId) {
    // Si no se proporciona un sessionId, envía un error y cierra la conexión.
    ws.send(
      JSON.stringify({ event: "error", message: "Session ID es requerido." }),
    );
    ws.close();
    return;
  }

  // Validar que el sessionId (token) exista en tokens.json
  if (!isValidSessionToken(sessionId)) {
    console.log(
      `[${sessionId}] Token no registrado. Rechazando conexión WebSocket.`,
    );
    ws.send(
      JSON.stringify({
        event: "error",
        message: `Token '${sessionId}' no está registrado. Verifique que exista en tokens.json.`,
      }),
    );
    ws.close();
    return;
  }

  console.log(`[${sessionId}] Cliente conectado vía WebSocket.`);
  // Inicia la gestión de la sesión WebSocket para el sessionId dado.
  handleWebSocketSession(ws, sessionId);
});

/**
 * Orquesta el ciclo de vida de una sesión de WhatsApp a través de una conexión WebSocket.
 * Maneja la persistencia de la sesión, la emisión de eventos de Baileys al cliente
 * y el inicio/reinicio del proceso de conexión de Baileys.
 * @param {WebSocket} ws - La instancia del WebSocket conectado para esta sesión.
 * @param {string} sessionId - El ID único de la sesión de WhatsApp.
 */
const handleWebSocketSession = async (ws, sessionId) => {
  console.log(`[${sessionId}] Petición WebSocket recibida.`);

  /**
   * Handler para el evento 'qr' emitido por sessionManager.
   * Envía el código QR al cliente WebSocket.
   * @param {{sessionId: string, qr: string}} data - Datos del evento QR.
   */
  const handleQrEvent = (data) => {
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "qr", data: data.qr }));
    }
  };

  /**
   * Handler para el evento 'connection_open' emitido por sessionManager.
   * Notifica al cliente WebSocket que la sesión está conectada.
   * @param {{sessionId: string}} data - Datos del evento de conexión abierta.
   */
  const handleOpenEvent = (data) => {
    const currentSession = sessionManager.getSession(sessionId);
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      if (currentSession && currentSession.status === "connected") {
        ws.send(JSON.stringify({ event: "status", data: "connected" }));
      }
    }
  };

  /**
   * Handler para el evento 'connection_close' emitido por sessionManager.
   * Notifica al cliente WebSocket sobre el cierre de la conexión.
   * @param {{sessionId: string, status: string}} data - Datos del evento de conexión cerrada.
   */
  const handleCloseEvent = (data) => {
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "status", data: data.status }));
      // Si la sesión fue desvinculada permanentemente, cerramos el WebSocket.
      if (data.status === "unlinked") {
        ws.close();
      }
    }
  };

  /**
   * Handler para el evento 'status_update' emitido por sessionManager.
   * Envía actualizaciones de estado al cliente WebSocket.
   * @param {{sessionId: string, status: string}} data - Datos del evento de actualización de estado.
   */
  const handleStatusUpdateEvent = (data) => {
    if (data.sessionId === sessionId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "status", data: data.status }));
    }
  };

  /**
   * Limpia todos los listeners de eventos asociados a esta conexión WebSocket
   * para prevenir fugas de memoria.
   */
  const cleanupListeners = () => {
    console.log(`[${sessionId}] Limpiando listeners para la conexión WS.`);
    sessionManager.sessionEmitter.removeListener("qr", handleQrEvent);
    sessionManager.sessionEmitter.removeListener(
      "connection_open",
      handleOpenEvent,
    );
    sessionManager.sessionEmitter.removeListener(
      "connection_close",
      handleCloseEvent,
    );
    sessionManager.sessionEmitter.removeListener(
      "status_update",
      handleStatusUpdateEvent,
    );
  };

  // Registra los handlers de eventos en el sessionManager.
  sessionManager.sessionEmitter.on("qr", handleQrEvent);
  sessionManager.sessionEmitter.on("connection_open", handleOpenEvent);
  sessionManager.sessionEmitter.on("connection_close", handleCloseEvent);
  sessionManager.sessionEmitter.on("status_update", handleStatusUpdateEvent);

  // Registra el cleanup de listeners cuando el WebSocket se cierra o hay un error.
  ws.on("close", cleanupListeners);
  ws.on("error", (err) => {
    console.error(`[${sessionId}] Error en WebSocket:`, err);
    cleanupListeners();
  });

  // Lógica para iniciar o verificar el estado de la sesión de Baileys.
  const existingSession = sessionManager.getSession(sessionId);

  if (existingSession) {
    // Si la sesión ya existe en memoria.
    console.log(
      `[${sessionId}] Sesión existente encontrada con estado: ${existingSession.status}`,
    );

    // Envía el estado actual de la sesión al cliente inmediatamente.
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({ event: "status", data: existingSession.status }),
      );
    }

    // Si la sesión ya está conectada, notifica al cliente.
    // No cerramos el WebSocket aquí, ya que el cliente podría querer seguir recibiendo actualizaciones
    // o iniciar un logout desde la interfaz.
    if (existingSession.status === "connected") {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: "status", data: "already_connected" }));
      }
      // No hay 'return' aquí, permitimos que la función continúe para que los listeners se mantengan activos.
    }

    // Si está esperando un QR, se lo envía si está disponible.
    if (existingSession.status === "qr_pending" && existingSession.qr) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: "qr", data: existingSession.qr }));
      }
    }
    // Si está 'disconnected' o 'unlinked', reinicia el proceso de conexión.
    if (
      existingSession.status === "disconnected" ||
      existingSession.status === "unlinked"
    ) {
      console.log(
        `[${sessionId}] Reiniciando proceso de conexión para sesión existente.`,
      );
      await sessionManager.createSession(sessionId);
    }
  } else {
    // Si la sesión es completamente nueva.
    console.log(`[${sessionId}] Sesión nueva. Creando e inicializando...`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: "status", data: "initializing" }));
    }

    // Inicia el proceso de creación de la sesión de Baileys.
    // Baileys guarda automaticamente las credenciales en sessions/{sessionId}/
    // usando useMultiFileAuthState. El sessionId es el RUC de la empresa.
    await sessionManager.createSession(sessionId);
  }
};

/**
 * Inicia el servidor HTTP y WebSocket, y luego inicializa las sesiones de WhatsApp.
 */
server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  // Inicializa las sesiones definidas en sessions.config.json al arrancar la aplicación.
  sessionManager.initialize();
});
