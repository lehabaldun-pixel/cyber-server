const http = require('http');
const WebSocket = require('ws');

const port = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('=== MATRIX_CORE: ONLINE AND READY ===');
});

const wss = new WebSocket.Server({ server, path: '/ws' }); 

const registeredUsers = new Map(); 
const activeConnections = new Map();

wss.on('connection', (ws) => {
    let authenticatedUser = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. Авторизация
            if (data.type === 'auth') {
                const { userId, password } = data;
                if (!userId || !password) {
                    ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'EMPTY_FIELDS' }));
                    return;
                }

                const handleSuccessfulAuth = (statusType) => {
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
                    if (registeredUsers.get(userId) === password) {
                        handleSuccessfulAuth('LOGGED_IN');
                    } else {
                        ws.send(JSON.stringify({ type: 'auth_response', success: false, error: 'WRONG_PASSWORD' }));
                        ws.close();
                    }
                } else {
                    registeredUsers.set(userId, password);
                    handleSuccessfulAuth('REGISTERED');
                }
                return;
            }

            if (!authenticatedUser) return;

            // 2. Полное удаление аккаунта
            if (data.type === 'delete_account') {
                registeredUsers.delete(authenticatedUser);
                activeConnections.delete(authenticatedUser);
                ws.send(JSON.stringify({ type: 'account_deleted_confirm' }));
                ws.close();
                return;
            }

            // 3. Универсальный пересылатель для ВСЕХ остальных пакетов
            // (message, typing, read_receipt, delete_msg, edit_msg, reaction, offer, answer, ice, hangup)
            const targetId = data.targetId || data.receiverId;
            if (targetId) {
                const targetSocket = activeConnections.get(targetId);
                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    // Подменяем отправителя на реального юзера и пересылаем пакет ЦЕЛИКОМ
                    data.senderId = authenticatedUser;
                    targetSocket.send(JSON.stringify(data));
                } else if (data.type === 'message') {
                    // Если сообщение не доставлено, отправляем System сообщение обратно
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
        if (authenticatedUser && activeConnections.get(authenticatedUser) === ws) {
            activeConnections.delete(authenticatedUser);
        }
    });
});

server.listen(port, () => {
    console.log(`=== СИГНАЛЬНОЕ ЯДРО ЖИВЕТ НА ПОРТУ ${port} ===`);
});
