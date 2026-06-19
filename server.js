const http = require('http');
const WebSocket = require('ws');

const port = process.env.PORT || 10000;

// HTTP-обработчик для мгновенного переключения радара на Android в READY
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

                // Вспомогательная функция для безопасного сохранения новой сессии
                const handleSuccessfulAuth = (statusType) => {
                    // ИСПРАВЛЕНО: Если этот юзер уже сидит в сети с другого сокета, 
                    // принудительно закрываем его старое соединение, чтобы телефон не зависал в ложном онлайне!
                    if (activeConnections.has(userId)) {
                        const oldSocket = activeConnections.get(userId);
                        if (oldSocket && oldSocket.readyState === WebSocket.OPEN) {
                            oldSocket.send(JSON.stringify({ type: 'message', senderId: 'SYSTEM', msgType: 'text', content: 'СЕССИЯ ПЕРЕХВАЧЕНА ДРУГИМ ТЕРМИНАЛОМ' }));
                            oldSocket.close(1000, 'Session replaced');
                        }
                    }

                    authenticatedUser = userId;
                    activeConnections.set(userId, ws);
                    ws.send(JSON.stringify({ type: 'auth_response', success: true, status: statusType }));
                };

                if (registeredUsers.has(userId)) {
                    const savedPassword = registeredUsers.get(userId);
                    if (savedPassword === password) {
                        console.log(`[AUTH] Успешный вход: ${userId}`);
                        handleSuccessfulAuth('LOGGED_IN');
                    } else {
                        console.log(`[AUTH] ОТКАЗАНО: Неверный пароль для ${userId}`);
                        ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'WRONG_PASSWORD' }));
                        ws.close();
                    }
                } else {
                    registeredUsers.set(userId, password);
                    console.log(`[REG] Занят новый RUNNER_ID: ${userId}`);
                    handleSuccessfulAuth('REGISTERED');
                }
                return;
            }

            if (!authenticatedUser) return;

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

            if (data.type === 'delete_account') {
                registeredUsers.delete(authenticatedUser);
                activeConnections.delete(authenticatedUser);
                console.log(`[SYS_ALERT] Полная деструкция: ${authenticatedUser}`);
                ws.send(JSON.stringify({ type: 'account_deleted_confirm' }));
                ws.close();
                return;
            }

            if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice' || data.type === 'hangup') {
                const targetId = data.targetId;
                const targetSocket = activeConnections.get(targetId);

                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    data.senderId = authenticatedUser; 
                    targetSocket.send(JSON.stringify(data));
                    console.log(`[SIGNAL] ${data.type} от ${authenticatedUser} к ${targetId}`);
                }
            }

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
            if (activeConnections.get(authenticatedUser) === ws) {
                activeConnections.delete(authenticatedUser);
                console.log(`[DISCONNECT] Сессия закрыта: ${authenticatedUser}`);
            }
        }
    });
});

server.listen(port, () => {
    console.log(`=== СИГНАЛЬНОЕ ЯДРО ЖИВЕТ НА ПОРТУ ${port} ===`);
});
