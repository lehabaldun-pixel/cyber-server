const http = require('http');
const WebSocket = require('ws');

const port = process.env.PORT || 10000;

// ИСПРАВЛЕНО: Добавлен обработчик HTTP-запросов, чтобы Android-радар переключался в READY
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('=== MATRIX_CORE: ONLINE AND READY ===');
});

const wss = new WebSocket.Server({ server, path: '/ws' }); 

const registeredUsers = new Map(); 
const activeConnections = new Map();

wss.on('connection', (ws) => {
    let authenticatedUser = null;
    console.log('[SERVER] Новое подключение к матрице.');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. ЗАЩИЩЕННАЯ АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ
            if (data.type === 'auth') {
                const { userId, password } = data;

                if (!userId || !password) {
                    ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'EMPTY_FIELDS' }));
                    return;
                }

                if (registeredUsers.has(userId)) {
                    const savedPassword = registeredUsers.get(userId);
                    if (savedPassword === password) {
                        authenticatedUser = userId;
                        activeConnections.set(userId, ws);
                        console.log(`[AUTH] Успешный вход: ${userId}`);
                        ws.send(JSON.stringify({ type: 'auth_response', success: true, status: 'LOGGED_IN' }));
                    } else {
                        console.log(`[AUTH] ОТКАЗАНО: Неверный пароль для ${userId}`);
                        ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'WRONG_PASSWORD' }));
                        ws.close();
                    }
                } else {
                    registeredUsers.set(userId, password);
                    authenticatedUser = userId;
                    activeConnections.set(userId, ws);
                    console.log(`[REG] Занят новый RUNNER_ID: ${userId}`);
                    ws.send(JSON.stringify({ type: 'auth_response', success: true, status: 'REGISTERED' }));
                }
                return;
            }

            if (!authenticatedUser) return;

            // ПРОТОКОЛ СИНХРОННОГО УДАЛЕНИЯ ЧАТА
            if (data.type === 'delete_chat_node') {
                const targetId = data.targetId;
                const targetSocket = activeConnections.get(targetId);
                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    targetSocket.send(JSON.stringify({
                        type: 'message',
                        senderId: 'SYSTEM',
                        msgType: 'text',
                        content: `ВНИМАНИЕ: Пользователь [${authenticatedUser}] изолировал ваш канал связи.`
                    }));
                }
                return;
            }

            // ПОЛНОЕ УНИЧТОЖЕНИЕ ПРОФИЛЯ
            if (data.type === 'delete_account') {
                registeredUsers.delete(authenticatedUser);
                activeConnections.delete(authenticatedUser);
                console.log(`[SYS_ALERT] Полная деструкция: ${authenticatedUser}`);
                ws.send(JSON.stringify({ type: 'account_deleted_confirm' }));
                ws.close();
                return;
            }

            // 2. МАРШРУТИЗАЦИЯ СИГНАЛОВ ЗВОНКА (Offer, Answer, ICE, Hangup)
            if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice' || data.type === 'hangup') {
                const targetId = data.targetId;
                const targetSocket = activeConnections.get(targetId);

                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    data.senderId = authenticatedUser; 
                    targetSocket.send(JSON.stringify(data));
                    console.log(`[SIGNAL] ${data.type} от ${authenticatedUser} к ${targetId}`);
                }
            }

            // 3. ПЕРЕСЫЛКА СООБЩЕНИЙ
            if (data.type === 'message') {
                const targetId = data.receiverId;
                const targetSocket = activeConnections.get(targetId);

                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    const payload = {
                        type: 'message',
                        senderId: authenticatedUser,
                        msgType: data.msgType,
                        content: data.content
                    };
                    targetSocket.send(JSON.stringify(payload));
                } else {
                    ws.send(JSON.stringify({
                        type: 'message',
                        senderId: 'SYSTEM',
                        msgType: 'text',
                        content: `Абонент [${targetId}] вне зоны доступа терминала.`
                    }));
                }
            }

        } catch (e) {
            console.error('[ERR] Критическая ошибка ядра:', e.message);
        }
    });

    ws.on('close', () => {
        if (authenticatedUser) {
            activeConnections.delete(authenticatedUser);
            console.log(`[DISCONNECT] Сессия закрыта: ${authenticatedUser}`);
        }
    });
});

server.listen(port, () => {
    console.log(`=== СИГНАЛЬНОЕ ЯДРО ЖИВЕТ НА ПОРТУ ${port} ===`);
});
