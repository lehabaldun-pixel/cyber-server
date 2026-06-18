// Скопируйте этот код в Блокнот и сохраните как server.js
const http = require('http');
const WebSocket = require('ws');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// База данных пользователей в памяти (в продакшене тут должна быть MongoDB/PostgreSQL)
// Структура: Логин -> { password: "...", registrationDate: "..." }
const registeredUsers = new Map();

// Хранилище активных сетевых соединений: Логин -> WebSocket-сокет
const activeConnections = new Map();

wss.on('connection', (ws) => {
    let authenticatedUser = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // ЛОГИКА РЕГИСТРАЦИИ И ВХОДА (AUTH)
            if (data.type === 'auth') {
                const { userId, password } = data;

                if (!userId || !password) {
                    ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'EMPTY_FIELDS' }));
                    return;
                }

                if (registeredUsers.has(userId)) {
                    // Пользователь существует -> проверяем пароль (Вход)
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
                    // Пользователя нет -> Создаем новый аккаунт (Регистрация)
                    registeredUsers.set(userId, { password: password, regTime: Date.now() });
                    authenticatedUser = userId;
                    activeConnections.set(userId, ws);
                    console.log(`[REG] Создан новый кибер-аккаунт: ${userId}`);
                    ws.send(JSON.stringify({ type: 'auth_response', success: true, status: 'REGISTERED' }));
                }
            }

            // ПЕРЕСЫЛКА СООБЩЕНИЙ (Только для авторизованных)
            if (data.type === 'message' && authenticatedUser) {
                const { receiverId, msgType, content } = data;
                const targetSocket = activeConnections.get(receiverId);

                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    targetSocket.send(JSON.stringify({
                        type: 'message',
                        senderId: authenticatedUser, // Подставляем проверенный ID с сервера
                        msgType: msgType,
                        content: content
                    }));
                } else {
                    console.log(`[MSG] Получатель ${receiverId} оффлайн. Сообщение не доставлено.`);
                }
            }
        } catch (e) {
            console.error('Ошибка парсинга даты:', e);
        }
    });

    ws.on('close', () => {
        if (authenticatedUser) {
            activeConnections.delete(authenticatedUser);
            console.log(`[DISCONNECT] Пользователь ${authenticatedUser} отключился.`);
        }
    });
});

server.listen(3000, () => {
    console.log('=== КИБЕР-СЕРВЕР ЗАПУЩЕН НА ПОРТУ 3000 ===');
});