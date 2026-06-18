const http = require('http');
const WebSocket = require('ws');

const port = process.env.PORT || 10000;
const server = http.createServer();
const wss = new WebSocket.Server({ server, path: '/ws' });

// База данных пользователей (сохраняется, пока сервер не перезагружен)
const registeredUsers = new Map();
const activeConnections = new Map();

wss.on('connection', (ws) => {
    let authenticatedUser = null;
    console.log('[WS] Новое подключение');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // МОЩНАЯ КИБЕР-АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ
            if (data.type === 'auth') {
                const { userId, password } = data;

                if (!userId || !password) {
                    ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'EMPTY_FIELDS' }));
                    return;
                }

                if (registeredUsers.has(userId)) {
                    // Пользователь уже есть -> СВЕРЯЕМ ПАРОЛЬ (Защита аккаунта)
                    const savedPassword = registeredUsers.get(userId);
                    if (savedPassword === password) {
                        authenticatedUser = userId;
                        activeConnections.set(userId, ws);
                        console.log(`[AUTH] Успешный вход: ${userId}`);
                        ws.send(JSON.stringify({ type: 'auth_response', success: true, status: 'LOGGED_IN' }));
                    } else {
                        console.log(`[AUTH] Отказ: неверный пароль для ${userId}`);
                        ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'WRONG_PASSWORD_OR_ID_TAKEN' }));
                    }
                } else {
                    // Аккаунт свободен -> Создаем и намертво бронируем за вами
                    registeredUsers.set(userId, password);
                    authenticatedUser = userId;
                    activeConnections.set(userId, ws);
                    console.log(`[REG] Забронирован новый аккаунт: ${userId}`);
                    ws.send(JSON.stringify({ type: 'auth_response', success: true, status: 'REGISTERED' }));
                }
                return;
            }

            // ИСПРАВЛЕНО: ГЛОБАЛЬНАЯ МАРШРУТИЗАЦИЯ (Сообщения, звонки, медиа)
            if (authenticatedUser) {
                const receiverId = data.targetId || data.receiverId;
                if (!receiverId) return;

                const targetSocket = activeConnections.get(receiverId);
                data.senderId = authenticatedUser; // Сервер гарантирует подлинность автора

                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    targetSocket.send(JSON.stringify(data));
                    console.log(`[ROUTE] Успешно переслано от ${authenticatedUser} к ${receiverId} (Тип: ${data.type || data.msgType})`);
                } else {
                    console.log(`[ROUTE] Абонент ${receiverId} оффлайн.`);
                    // Если это текстовое сообщение, возвращаем ошибку отправителю
                    if (data.type === 'message' || data.type === 'text') {
                        ws.send(JSON.stringify({
                            type: 'message',
                            senderId: 'SYSTEM',
                            msgType: 'text',
                            content: `Runner [${receiverId}] сейчас оффлайн. Сигнал потерян.`
                        }));
                    }
                }
            }
        } catch (e) {
            console.error('Ошибка сервера:', e.message);
        }
    });

    ws.on('close', () => {
        if (authenticatedUser) {
            activeConnections.delete(authenticatedUser);
            console.log(`[DISCONNECT] Отключен: ${authenticatedUser}`);
        }
    });
});

server.listen(port, () => {
    console.log(`=== СЕРВЕР ОБНОВЛЕН И РАБОТАЕТ НА ПОРТУ ${port} ===`);
});
