const http = require('http');
const WebSocket = require('ws');

// ИСПРАВЛЕНО: Render сам передает порт. Если его нет, используем 10000
const port = process.env.PORT || 10000;

const server = http.createServer();

// ИСПРАВЛЕНО: Добавлен path: '/ws', чтобы сокеты со со смартфона подключались без ошибок
const wss = new WebSocket.Server({ server, path: '/ws' });

// База данных пользователей в памяти
const registeredUsers = new Map();

// Хранилище активных сетевых соединений
const activeConnections = new Map();

wss.on('connection', (ws) => {
    let authenticatedUser = null;
    console.log('[WS] Новое сырое подключение установлено');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // ЛОГИКА СОВМЕСТИМОСТИ: Обрабатываем тип 'join', который шлет ваш Android-код
            if (data.type === 'join') {
                authenticatedUser = data.userId;
                activeConnections.set(authenticatedUser, ws);
                console.log(`[WS] Пользователь "${authenticatedUser}" зашел в сеть по протоколу JOIN.`);
                ws.send(JSON.stringify({ type: 'text', senderId: 'SYSTEM', content: 'CONNECTED_TO_CYBER_NODE' }));
                return;
            }

            // ЛОГИКА РЕГИСТРАЦИИ И ВХОДА (AUTH)
            if (data.type === 'auth') {
                const { userId, password } = data;

                if (!userId || !password) {
                    ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'EMPTY_FIELDS' }));
                    return;
                }

                if (registeredUsers.has(userId)) {
                    const user = registeredUsers.get(userId);
                    if (user.password === password) {
                        authenticatedUser = userId;
                        activeConnections.set(userId, ws);
                        console.log(`[AUTH] Пользователь ${userId} успешно вошел в сеть.`);
                        ws.send(JSON.stringify({ type: 'auth_response', success: true, status: 'LOGGED_IN' }));
                    } else {
                        console.log(`[AUTH] Неверный пароль для ${userId}`);
                        ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'WRONG_PASSWORD' }));
                    }
                } else {
                    registeredUsers.set(userId, { password: password, regTime: Date.now() });
                    authenticatedUser = userId;
                    activeConnections.set(userId, ws);
                    console.log(`[REG] Создан новый кибер-аккаунт: ${userId}`);
                    ws.send(JSON.stringify({ type: 'auth_response', success: true, status: 'REGISTERED' }));
                }
            }

            // ПЕРЕСЫЛКА СООБЩЕНИЙ И СИГНАЛОВ ЗВОНКА (text, file, image, offer, answer, ice)
            if (authenticatedUser) {
                // Если тип сообщения 'text', 'file', 'image' или WebRTC сигналы звонка
                if (data.type === 'text' || data.type === 'file' || data.type === 'image' || data.type === 'offer' || data.type === 'answer' || data.type === 'ice') {
                    const receiverId = data.targetId || data.receiverId;
                    const targetSocket = activeConnections.get(receiverId);

                    if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                        data.senderId = authenticatedUser; // Фиксируем отправителя
                        targetSocket.send(JSON.stringify(data));
                        console.log(`[ROUTE] Переслано сообщение типа "${data.type}" от "${authenticatedUser}" к "${receiverId}"`);
                    } else {
                        console.log(`[ROUTE] Получатель ${receiverId} оффлайн. Тип: ${data.type}`);
                    }
                }
            }
        } catch (e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    });

    ws.on('close', () => {
        if (authenticatedUser) {
            activeConnections.delete(authenticatedUser);
            console.log(`[DISCONNECT] Пользователь ${authenticatedUser} отключился.`);
        }
    });
});

// ИСПРАВЛЕНО: Слушаем динамический порт вместо жесткого 3000
server.listen(port, () => {
    console.log(`=== КИБЕР-СЕРВЕР УСПЕШНО ЗАПУЩЕН НА ПОРТУ ${port} ===`);
});
