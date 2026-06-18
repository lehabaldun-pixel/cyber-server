const http = require('http');
const WebSocket = require('ws');

const port = process.env.PORT || 10000;
const server = http.createServer();
const wss = new WebSocket.Server({ server, path: '/ws' });

// Постоянная база данных пользователей в памяти сервера (Логин -> Пароль)
const registeredUsers = new Map();
// Активные сокеты онлайн-пользователей (Логин -> WebSocket)
const activeConnections = new Map();

wss.on('connection', (ws) => {
    let authenticatedUser = null;
    console.log('[SYSTEM] Новое кибер-подключение.');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. НАДЕЖНАЯ АВТОРИЗАЦИЯ И ЗАЩИТА АККАУНТА
            if (data.type === 'auth') {
                const { userId, password } = data;

                if (!userId || !password) {
                    ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'EMPTY_FIELDS' }));
                    return;
                }

                if (registeredUsers.has(userId)) {
                    // Логин занят -> проверяем пароль
                    const savedPassword = registeredUsers.get(userId);
                    if (savedPassword === password) {
                        authenticatedUser = userId;
                        activeConnections.set(userId, ws);
                        console.log(`[AUTH] Успешный вход: ${userId}`);
                        ws.send(JSON.stringify({ type: 'auth_response', success: true, status: 'LOGGED_IN' }));
                    } else {
                        console.log(`[AUTH] ОТКАЗ: Неверный пароль для занятого ID: ${userId}`);
                        ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'WRONG_PASSWORD_OR_ID_TAKEN' }));
                    }
                } else {
                    // Логин свободен -> Регистрация (привязываем пароль к нику навсегда)
                    registeredUsers.set(userId, password);
                    authenticatedUser = userId;
                    activeConnections.set(userId, ws);
                    console.log(`[REG] Логин "${userId}" успешно закреплен за пользователем.`);
                    ws.send(JSON.stringify({ type: 'auth_response', success: true, status: 'REGISTERED' }));
                }
            }

            // 2. ЕДИНАЯ МАРШРУТИЗАЦИЯ (Сообщения, Медиа, Сигналы WebRTC)
            if (authenticatedUser && data.targetId) {
                const targetSocket = activeConnections.get(data.targetId);
                data.senderId = authenticatedUser; // Сервер гарантирует подлинность отправителя

                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    targetSocket.send(JSON.stringify(data));
                    console.log(`[ROUTE] Сигнал "${data.type}" переслан от ${authenticatedUser} к ${data.targetId}`);
                } else {
                    console.log(`[ROUTE] Получатель ${data.targetId} оффлайн.`);
                    if (data.type === 'message') {
                        ws.send(JSON.stringify({ type: 'message', senderId: 'SYSTEM', msgType: 'text', content: `Пользователь ${data.targetId} сейчас оффлайн.` }));
                    }
                }
            }
        } catch (e) {
            console.error('[ERR] Ошибка обработки пакета:', e.message);
        }
    });

    ws.on('close', () => {
        if (authenticatedUser) {
            activeConnections.delete(authenticatedUser);
            console.log(`[DISCONNECT] Руннер ${authenticatedUser} покинул сеть.`);
        }
    });
});

server.listen(port, () => {
    console.log(`=== СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${port} ===`);
});
