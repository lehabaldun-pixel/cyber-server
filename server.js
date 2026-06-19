const http = require('http');
const WebSocket = require('ws');

const port = process.env.PORT || 10000;
const server = http.createServer();
const wss = new WebSocket.Server({ server, path: '/ws' });

// База данных пользователей (теперь сохраняется между сессиями в памяти)
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
                    // Пользователь существует -> Проверяем пароль
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
                    // Пользователя нет -> Регистрируем и привязываем пароль навсегда к нему
                    registeredUsers.set(userId, password);
                    authenticatedUser = userId;
                    activeConnections.set(userId, ws);
                    console.log(`[REG] Занят новый RUNNER_ID: ${userId}`);
                    ws.send(JSON.stringify({ type: 'auth_response', success: true, status: 'REGISTERED' }));
                }
                return;
            }

            // ВСЕ ПОСЛЕДУЮЩИЕ ДЕЙСТВИЯ ДОСТУПНЫ ТОЛЬКО АВТОРИЗОВАННЫМ
            if (!authenticatedUser) return;

            // 2. МАРШРУТИЗАЦИЯ СИГНАЛОВ ЗВОНКА (Offer, Answer, ICE)
            if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice') {
                const targetId = data.targetId;
                const targetSocket = activeConnections.get(targetId);

                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    data.senderId = authenticatedUser; // Гарантируем подлинность автора
                    targetSocket.send(JSON.stringify(data));
                    console.log(`[SIGNAL] Сигнал ${data.type} переслан от ${authenticatedUser} к ${targetId}`);
                }
            }

            // 3. ПЕРЕСЫЛКА ТЕКСТА, ФОТО И ГОЛОСОВЫХ (Тип 'message')
            if (data.type === 'message') {
                const targetId = data.receiverId;
                const targetSocket = activeConnections.get(targetId);

                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    // Формируем чистый пакет для получателя
                    const payload = {
                        type: 'message',
                        senderId: authenticatedUser,
                        msgType: data.msgType,
                        content: data.content
                    };
                    targetSocket.send(JSON.stringify(payload));
                    console.log(`[MSG] Переслано от ${authenticatedUser} к ${targetId}. Тип: ${data.msgType}`);
                } else {
                    console.log(`[MSG] Получатель ${targetId} оффлайн.`);
                    ws.send(JSON.stringify({
                        type: 'message',
                        senderId: 'SYSTEM',
                        msgType: 'text',
                        content: `Пользователь [${targetId}] сейчас оффлайн. Доставка невозможна.`
                    }));
                }
            }

        } catch (e) {
            console.error('[ERR] Сбой обработки пакета:', e.message);
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
