const http = require('http');
const WebSocket = require('ws');

const port = process.env.PORT || 10000;
const server = http.createServer();
const wss = new WebSocket.Server({ server, path: '/ws' }); // Android должен стучаться именно сюда!

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
 if (data.type === 'delete_account') {
                if (authenticatedUser) {
                    registeredUsers.delete(authenticatedUser);
                    activeConnections.delete(authenticatedUser);
                    console.log(`[SYS_ALERT] Аккаунт полностью стерт из матрицы: ${authenticatedUser}`);
                    ws.send(JSON.stringify({ type: 'account_deleted_confirm' }));
                    ws.close();
                }
                return;
            }
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

            // 2. МАРШРУТИЗАЦИЯ СИГНАЛОВ ЗВОНКА (Offer, Answer, ICE, Hangup)
            // ИСПРАВЛЕНО: Добавлен тип 'hangup', чтобы звонок прерывался у обоих пользователей
            if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice' || data.type === 'hangup') {
                const targetId = data.targetId;
                const targetSocket = activeConnections.get(targetId);

                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    data.senderId = authenticatedUser; 
                    targetSocket.send(JSON.stringify(data));
                    console.log(`[SIGNAL] Сигнал ${data.type} переслан от ${authenticatedUser} к ${targetId}`);
                }
            }

            // 3. ПЕРЕСЫЛКА ТЕКСТА, ФОТО И ГОЛОСОВЫХ
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
