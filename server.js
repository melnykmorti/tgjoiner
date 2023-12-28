import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import { Api, TelegramClient, client, sessions } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";
import http from "http";
import asyncHandler from "express-async-handler";
import { WebSocketServer } from "ws";
import { uuid } from "uuidv4";
import cors from "cors";
import { error, log } from "console";
import helmet from "helmet";
import { exec } from "child_process";
dotenv.config();

const app = express();
const logs = [];
const usersLogs = [];
app.use(express.json());
app.use(cors());
app.use(
    helmet({
        contentSecurityPolicy: false,
    })
);
const PORT = process.env.PORT || 7005;
const ACCOUNTPORT = process.env.ACCOUNTPORT;
const LOGSPORT = process.env.LOGSPORT;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// Create an HTTP server
const server = http.createServer(app);
const second = 1000;
const minute = second * 60;
const wsConnectAccount = new WebSocketServer({
    port: ACCOUNTPORT,
    path: "/ws-account",
});
const wsLogs = new WebSocketServer({ port: LOGSPORT, path: "/ws-logs" ,});

wsConnectAccount.on("connection", (ws) => {
    try {
        console.log("new connection");

        // Send a welcome message to the connected client
        ws.send(
            JSON.stringify({
                type: "welcome",
                message: "Connection established",
            })
        );

        ws.on("close", () => {
            console.log("user disconnected from connect-account");
        });
        ws.on("message", async (msg) => {
            const message = JSON.parse(msg);
            const { type, data } = message;

            switch (type) {
                case "addAccount":
                    // Получаем номер телефона из сообщения от клиента
                    const { phoneNumber, apiId, apiHash } = data;
                    console.log(apiId, apiHash);
                    const stringSession = new StringSession(""); // Пустая сессия

                    const client = new TelegramClient(
                        stringSession,
                        parseInt(apiId),
                        apiHash,
                        {
                            connectionRetries: 5,
                        }
                    );

                    try {
                        await client.start({
                            phoneNumber: () => Promise.resolve(phoneNumber),
                            password: async () => {
                                // Запрос пароля от клиента
                                ws.send(
                                    JSON.stringify({ type: "requestPassword" })
                                );
                                return await waitForClientResponse(
                                    ws,
                                    "password"
                                );
                            },
                            phoneCode: async () => {
                                // Запрос кода подтверждения от клиента
                                ws.send(
                                    JSON.stringify({ type: "requestCode" })
                                );
                                return await waitForClientResponse(ws, "code");
                            },
                            onError: (err) => console.log(err),
                        });
                        console.log(client.getMe());
                        const meInfo = await client.getMe();
                        console.log(meInfo);
                        console.log("You should now be connected.");
                        saveLog("You should now be connected.");
                        saveSession(
                            { phoneNumber, ...meInfo, apiHash, apiId },
                            client.session.save()
                        ); // Сохранение сессии

                        await client.sendMessage("me", { message: "Hello!" });
                        client.session.save();
                    } catch (error) {
                        console.log(error);
                        // Отправляем информацию об ошибке на клиент
                        ws.send(
                            JSON.stringify({
                                type: "error",
                                message: error.toString(),
                            })
                        );
                    }
                    break;
            }
        });

        // Функция для ожидания ответа от клиента

        // You would have additional logic here to handle authentication, etc.
    } catch (error) {
        console.log(error);
    }
});

wsLogs.on("connection", (ws) => {
    try {
        console.log("new connection logs");
        ws.send(
            JSON.stringify({
                type: "welcome",
                message: "Connection established. Logs",
            }),
            
        );
    } catch (error) {
        console.log(error);
    }
});

function sendLogsToAll(data) {
    wsLogs.clients.forEach((client) => {
        if (client.readyState) {
            client.send(JSON.stringify(data));
        }
    });
}

function waitForClientResponse(ws, expectedType) {
    return new Promise((resolve, reject) => {
        const messageHandler = (msg) => {
            const response = JSON.parse(msg);
            if (response.type === expectedType) {
                ws.removeListener("message", messageHandler); // Удаляем обработчик после получения ответа
                resolve(response.data);
            }
        };

        ws.on("message", messageHandler);

        // Также нужно добавить обработку закрытия соединения и таймаута, если нужно
    });
}

app.post(
    "/reload",
    asyncHandler(async (req, res) => {
        exec("pm2 restart joiner");
        console.log("trying to reload");
    })
);

// Функция для загрузки сессии из файла
const loadSession = (phoneNumber) => {
    if (fs.existsSync("session.json")) {
        const sessions = JSON.parse(fs.readFileSync("session.json", "utf8"));
        const session = sessions.find((s) => s.phoneNumber === phoneNumber);
        try {
            console.log(session.phoneNumber, session.sessionString);
        } catch (error) {
            console.log("No session");
        }
        return session ? session : "";
    }
    return "";
};

// Функция для сохранения сессии в файл
const saveSession = (infoAccount, sessionString) => {
    const { phoneNumber } = infoAccount;
    let sessions = [];
    if (fs.existsSync("session.json")) {
        sessions = JSON.parse(fs.readFileSync("session.json", "utf8"));
    }
    const existingIndex = sessions.findIndex(
        (s) => s.phoneNumber === phoneNumber
    );
    if (existingIndex !== -1) {
        sessions[existingIndex].sessionString = sessionString;
    } else {
        sessions.push({
            phoneNumber,
            sessionString,
            ...infoAccount,
            infiniteSpamBlock: false,
        });
    }
    fs.writeFileSync("session.json", JSON.stringify(sessions, null, 2), "utf8");
};
const getSessions = () => {
    const allSessiom = JSON.parse(fs.readFileSync("session.json", "utf8"));
    return allSessiom;
};

const deleteSession = (phoneNumber) => {
    let sessions = [];
    if (fs.existsSync("session.json")) {
        sessions = JSON.parse(fs.readFileSync("session.json", "utf8"));
    }

    const existingIndex = sessions.findIndex(
        (s) => s.phoneNumber === phoneNumber
    );
    console.log("existingIndex", existingIndex);
    if (existingIndex !== -1) {
        //    sessions[existingIndex].sessionString = sessionString;
        sessions.splice(existingIndex, 1);
        fs.writeFileSync(
            "session.json",
            JSON.stringify(sessions, null, 2),
            "utf8"
        );
    }
};

const updateInfiniteSpamBlockSession = (phoneNumber, infiniteSpamBlock) => {
    let sessions = [];

    if (fs.existsSync("session.json")) {
        sessions = JSON.parse(fs.readFileSync("session.json", "utf8"));
    }

    const existingIndex = sessions.findIndex(
        (s) => s.phoneNumber === phoneNumber
    );
    if (existingIndex > -1) {
        sessions[existingIndex].infiniteSpamBlock = infiniteSpamBlock;
        fs.writeFileSync(
            "session.json",
            JSON.stringify(sessions, null, 2),
            "utf8"
        );
    }
};

(async () => {})();

const saveLog = (log) => {
    const pushState = { timestamp: Date.now(), message: log };
    logs.push(pushState);
    sendLogsToAll(pushState);
};

async function joinGroup(client, chat, sleepTime) {
    try {
        const result = await client.invoke(
            new Api.messages.ImportChatInvite({ hash: chat })
        );
        saveLog(`JOINED_GROUP: ${chat}`);
        console.log(result);
        return { result: true, next: false, response: result };
    } catch (error) {
        console.log(error.errorMessage, error);
        saveLog(error.errorMessage + " " + chat);
        if (error.errorMessage == "FLOOD") {
            const { seconds } = error;

            return {
                result: false,
                next: false,
                flood: {
                    isFlood: true,
                    seconds,
                },
            };
        }
        if (error.errorMessage == "USER_ALREADY_PARTICIPANT") {
            saveLog(`USER_ALREADY_PARTICIPANT: CHAT:${chat}`);
            return { result: false, next: false };
        } else if (error.errorMessage == "INVITE_REQUEST_SENT") {
            saveLog("INVITE_REQUEST_SENT: " + chat);
            return { result: true, next: false };
        } else {
            await sleep(sleepTime);
            return await joinChannel(client, chat);
        }
    }
}

async function joinChannel(client, channel) {
    try {
        const result = await client.invoke(
            new Api.channels.JoinChannel({ channel })
        );
        saveLog(`JOINED CHANNEL^ ${channel}`);

        return { result: true, next: false, response: result };
    } catch (error) {
        console.log("joinChannel error:", error.errorMessage, error);
        saveLog(error.errorMessage + channel);
        if (error.errorMessage == "FLOOD") {
            const { seconds } = error;
            return {
                result: false,
                next: false,
                flood: {
                    isFlood: true,
                    seconds,
                },
            };
        }
        if (error.errorMessage == "CHANNELS_TOO_MUCH") {
            saveLog("CURRENT CLIENT ERROR (CHANNELS_TOO_MUCH). Next User");
            return { result: false, next: true };
        } else if (error.errorMessage == "INVITE_REQUEST_SENT") {
            saveLog("INVITE_REQUEST_SENT:" + channel);
            return {
                result: true,
                next: false,
            };
        } else if (error.errorMessage == "USER_ALREADY_PARTICIPANT") {
            saveLog("USER_ALREADY_PARTICIPANT:" + channel);
            return {
                result: true,
                next: false,
            };
        } else {
            saveLog(`${error.errorMessage}: +${channel}`);
            return {
                result: true,
                next: false,
            };
        }
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function addChannelToFolder(client, channelId, folderId) {
    try {
        console.log("folderId", folderId);
        console.log("channelId", channelId);
        const dialogFilters = await client.invoke(
            new Api.messages.GetDialogFilters()
        );
        console.log(dialogFilters);
        let oldIncludePeers = dialogFilters.find((item) => item.id == folderId)
            ? dialogFilters.find((item) => item.id == folderId).includePeers
            : [];
        console.log("oldIncludePeers:", oldIncludePeers);

        //  oldIncludePeers=[];
        const response = await client.invoke(
            new Api.messages.UpdateDialogFilter({
                id: folderId,
                filter: new Api.DialogFilter({
                    title: "Folder",
                    id: folderId,
                    excludePeers: [],
                    pinnedPeers: [],
                    includePeers: [
                        ...oldIncludePeers,
                        new Api.InputPeerChannel({
                            channelId,
                        }),
                    ],
                }),
            })
        );

        console.log(response);

        return { next: false };
    } catch (error) {
        console.log(error);
    }
}

function checkInfiniteSpamBlock(text = "") {
    const includesArray = [
        "actions can trigger a harsh",
        "account is limited",
        "will not be able to send messages",
        "Пока действуют ограничения",
    ];

    for (let i = 0; i < includesArray.length; i++) {
        if (text.includes(includesArray[i])) {
            return true;
        }
    }
    return false;
}

function checkTemporarySpamBlock(text = "") {
    const includesArray = [
        "Ваш аккаунт временно ограничен:",
        "Ограничения будут автоматически сняты:",
    ];

    for (let i = 0; i < includesArray.length; i++) {
        if (text.includes(includesArray[i])) {
            return true;
        }
    }

    return false;
}

app.post(
    "/api/joiner",
    asyncHandler(async (req, res) => {
        function shuffle(array) {
            array.sort(() => Math.random() - 0.5);
            return array;
        }

        try {
            res.send({ success: true, message: "started" });
            let { chats, sleepTime, folderSize } = req.body;
            let { chatsPerAccount } = req.body;
            chatsPerAccount = parseInt(chatsPerAccount);
            const clients = [];
            chats = chatsValidation(chats);
            const allSessions = getSessions();
            chats = shuffle(chats);
            let currentChat = 0;
            // чистим повторящиеся чаты
            console.log("chats.length BEFORE:", chats.length);
            chats = chats.filter(function (item, pos) {
                return chats.indexOf(item) == pos;
            });
            chats = chats.map((item) => ({ ...item, isUsed: false }));
            saveLog("Кол-во валидированных чатов: " + chats.length);
            console.log(chats[2]);
            function getChat() {
                const indexNotUsed = chats.findIndex((item) => !item.isUsed);
                console.log("indexNotUser", indexNotUsed);
                chats[indexNotUsed].isUsed = true;
                console.log("chats[indexNotUsed]", chats[indexNotUsed]);
                return chats[indexNotUsed];
            }

            async function startJoiner(
                client = new TelegramClient(),
                firstSleep
            ) {
                await sleep(firstSleep);
                let currentIt = 0;
                let currentFolderId;
                let maxFoldersSize;
                const getMe = await client.getMe();
                saveLog(`Начал работу аккаунта: ${getMe.phone}`);
                if (!currentFolderId) {
                    const currentFilters = await client.invoke(
                        new Api.messages.GetDialogFilters()
                    );
                    console.log("currentFilter", currentFilters);
                    // Определение следующего доступного ID
                    let maxId = 0;
                    currentFilters.forEach((filter) => {
                        if (filter.id > maxId) {
                            maxId = filter.id;
                        }
                    });
                    currentFolderId = maxId + 2;

                    if (getMe.originalArgs.premium) {
                        maxFoldersSize = 20;
                    } else {
                        maxFoldersSize = 2;
                    }

                    let invitesIt = 0;
                    currentFilters.forEach((filter) => {
                        if (filter.hasMyInvites) {
                            invitesIt += 1;
                        }
                    });
                    console.log(invitesIt, maxFoldersSize);
                    if (invitesIt == maxFoldersSize) {
                        saveLog(
                            "Максималььное кол-во папок. Останавливаем выполнения для этого аккаунта"
                        );
                        //  continue;
                    }
                }
                console.log("currentfolderid", currentFolderId);
                if (currentFolderId == 1) {
                    currentFolderId = 2;
                }
                while (currentChat < chats.length) {
                    //   return;
                    //console.log("currentChat: ",currentChat,"chats.length % chatsPerAccount: ",chats.length % chatsPerAccount,"chats.length",chats.length,"chatsPerAccount",chatsPerAccount);
                    // for (
                    //     let j = currentChat;
                    //     currentChat*i < chatsPerAccount*(i+1);
                    //     j++
                    // ) {
                    //  console.log("currentChat+1 % folderSize == 0",currentChat+1 % folderSize);

                    let result;
                    let chat = getChat();
                    console.log("account chat:", chat);
                    if (chat.type == "channel") {
                        result = await joinChannel(
                            client,
                            chat.join,
                            sleepTime
                        );
                    } else {
                        result = await joinGroup(
                            client,
                            //   chats[j].join,
                            chat.join,
                            sleepTime
                        );
                    }
                    //  const result =
                    if (result.result) {
                        saveLog(
                            `Выполнил вход. Готово: ${currentChat}. Осталось: ${
                                chats.length - currentChat
                            }`
                        );
                        console.log("result.response", result.response);
                        try {
                            await addChannelToFolder(
                                client,
                                result.response.chats[0].id,
                                currentFolderId
                            );
                        } catch (error) {
                            console.log(error);
                            //saveLog(error);
                        }
                    }

                    console.log(result);

                    saveLog(`SLEEP:   ${sleepTime}  ms`);
                    await sleep(sleepTime);
                    currentChat++;
                    currentIt++;
                    if (result.next) {
                        return;
                    }
                    if (result.flood) {
                        if (result.flood.isFlood) {
                            saveLog(`FLOOD: ${result.flood.seconds} секунд`);
                            await sleep(result.flood.seconds * 1000);
                        }
                    }
                    if (
                        (currentIt > 1 && currentIt % folderSize == 0) ||
                        currentIt == chatsPerAccount ||
                        currentChat == chats.length - 1
                    ) {
                        console.log("currentIt", currentIt);
                        try {
                            let currentFilters = await client.invoke(
                                new Api.messages.GetDialogFilters()
                            );
                            const inviteLink = await client.invoke(
                                new Api.chatlists.ExportChatlistInvite({
                                    chatlist: new Api.InputChatlistDialogFilter(
                                        {
                                            filterId: currentFolderId,
                                        }
                                    ),
                                    title: "Folder",
                                    peers: currentFilters.find(
                                        (item) => item.id == currentFolderId
                                    ).includePeers,
                                })
                            );

                            console.log("inviteLink", inviteLink);
                            saveLog(
                                "FOLDER INVITE LINK:" + inviteLink.invite.url
                            );
                            currentFilters = await client.invoke(
                                new Api.messages.GetDialogFilters()
                            );
                            let invitesIt = 0;
                            currentFilters.forEach((filter) => {
                                if (filter.hasMyInvites) {
                                    invitesIt += 1;
                                }
                            });
                            console.log(invitesIt, maxFoldersSize);
                            if (invitesIt == maxFoldersSize) {
                                saveLog(
                                    "Максималььное кол-во папок. Скипает аккаунт"
                                );
                                return;
                            }

                            let maxId = 0;
                            currentFilters.forEach((filter) => {
                                if (filter.id > maxId) {
                                    maxId = filter.id;
                                }
                            });
                            currentFolderId = maxId + 1;
                        } catch (error) {
                            console.log(error);
                        }
                    }

                    // }
                }
            }

            try {
                for (let i = 0; i < allSessions.length; i++) {
                    let currentFolderId;
                    const session = allSessions[i];
                    const stringSession = new StringSession(
                        session.sessionString
                    ); // Пустая сессия
                    // console.log(
                    //     "stringSession",
                    //     stringSession,
                    //     session.apiId,
                    //     session.apiHash
                    // );
                    console.log("i:", i);
                    const client = new TelegramClient(
                        stringSession,
                        parseInt(session.apiId),
                        session.apiHash,
                        {
                            connectionRetries: 5,
                        }
                    );
                    await client.connect();
                    const isUserAuthorized = await client.isUserAuthorized();
                    if (isUserAuthorized) {
                        clients.push(client);
                    }
                    console.log("isUserAuthorize: ", isUserAuthorized);
                }
            } catch (error) {
                console.log(error);
            }
            const promises = clients.map((item, index) =>
                startJoiner(item, sleepTime * index)
            );

            Promise.all(promises).then(() => {
                saveLog("Работа Joiner закончена");
            });

            res.send({ result: true });
        } catch (error) {
            console.log(error);
        }
    })
);
app.get(
    "/api/accounts-current",
    asyncHandler(async (req, res) => {
        try {
            res.send(getSessions());
        } catch (error) {
            console.log(error);
        }
    })
);

app.get(
    "/api/logs",
    asyncHandler(async (req, res) => {
        try {
            res.send(logs);
        } catch (error) {
            console.log(error);
        }
    })
);
app.post(
    "/api/spammer",
    asyncHandler(async (req, res) => {
        function validateFolders(folders = []) {
            const splitArray = [
                "https://t.me/addlist/",
                "http://t.me/addlist/",
                "t.me/addlist",
                "tg://addlist?slug=",
            ];

            for (let i = 0; i < folders.length; i++) {
                for (let j = 0; j < splitArray.length; j++) {
                    if (folders[i].includes(splitArray[j])) {
                        folders[i] = folders[i].split(splitArray[j]);
                        console.log(folders[i]);
                        folders[i] = folders[i][1];
                        break;
                    }
                }
            }
            return folders;
        }
        function randomInteger(min, max) {
            return Math.floor(Math.random() * (max - min)) + min;
        }
        function getProxy(proxies) {
            console.log(randomInteger(0, proxies.length));
            return proxies[randomInteger(0, proxies.length)];
        }

        try {
            const {
                
                messageClient,
                enableForward,
                sleepTime,
                proxiesList,
            } = req.body;
            let {channelId}=req.body;

            console.log("messageClient", messageClient);
            console.log("channelId",channelId,typeof channelId);
            channelId=parseInt(channelId);
            console.log("channelId",channelId,typeof channelId);
            if (messageClient.length < 4&&!enableForward) {
                saveLog("Сообщение пустое. Останавливаем спам");
                return;
            }
            let { foldersList } = req.body;
            console.log("foldersList before validate", foldersList);
            let folderIt = 0;
            let chatIt = 0;
            foldersList = validateFolders(foldersList);
            console.log("foldersList", foldersList);
            const allSessions = getSessions();
            allSessions.filter((item) => !item.infiniteSpamBlock);

            //   return;
            for (let i = 0; i < allSessions.length; i++) {
                let folderId;
                const session = allSessions[i];
                const stringSession = new StringSession(session.sessionString); // Пустая сессия
                console.log(
                    "stringSession",
                    stringSession,
                    session.apiId,
                    session.apiHash
                );
                console.log(proxiesList);
                const proxy = getProxy(proxiesList).split(":");
                //proxy=proxy;
                console.log("proxy", proxy);
                const client = new TelegramClient(
                    stringSession,
                    parseInt(session.apiId),
                    session.apiHash,
                    {
                        connectionRetries: 5,

                        proxy: {
                            ip: proxy[0],
                            port: parseInt(proxy[1]),
                            socksType: 4,
                            timeout: second * 5,
                            username: proxy[2],
                            password: proxy[3],
                        },
                    }
                );
                try {
                    await client.connect();
                    const isUserAuthorized = await client.isUserAuthorized();

                    if (isUserAuthorized) {
                        async function deleteSpamLock() {
                            saveLog("Снимаем спам блок.");
                            let message;
                            try {
                                message = await client.sendMessage("spambot", {
                                    message: "/start",
                                });
                                console.log("message", message);
                            } catch (error) {
                                console.log(error);
                                saveLog(`${error.errorMessage}`);
                                await sleep(60000);
                            }
                            await sleep(2000);

                            const messages = await client.getMessages(
                                "spambot",
                                {
                                    limit: 1,
                                }
                            );
                            console.log("messages", messages);
                            console.log("message", message);

                            if (checkInfiniteSpamBlock(messages[0].text)) {
                                updateInfiniteSpamBlockSession(
                                    session.phoneNumber,
                                    true
                                );
                            }
                            if (checkTemporarySpamBlock(messages[0].text)) {
                                saveLog(
                                    `SLEEP: ${minute}. Временный спам блок`
                                );
                                await sleep(minute);
                                deleteSpamLock();
                                return;
                            }

                            if (
                                !(
                                    messages != message.id ||
                                    messages[0].id != message.id
                                )
                            ) {
                                await sleep(60000);
                                deleteSpamLock();
                            }
                        }
                        await deleteSpamLock();
                        for (let j = folderIt; j < foldersList.length; j++) {
                            let result;
                            try {
                                const slug = foldersList[j];

                                result = await client.invoke(
                                    new Api.chatlists.CheckChatlistInvite({
                                        slug,
                                    })
                                );
                                console.log("result", result);
                                const peers = result.peers;
                                console.log("peers", peers);
                                console.log("slug", slug);
                                try {
                                    result = await client.invoke(
                                        new Api.chatlists.JoinChatlistInvite({
                                            slug,
                                            peers,
                                        })
                                    );
                                } catch (error) {
                                    saveLog(
                                        `${allSessions[i].phoneNumber} ERROR: ${error}`
                                    );
                                    break;
                                }
                                console.log(result);

                                folderId =
                                    result.updates[result.updates.length - 1]
                                        .id;
                                console.log("folderId", folderId);
                            } catch (error) {
                                console.log(error);
                                saveLog(`${error}. Ошибка при добавлении`);
                                break;
                            }
                            const ids = [];
                            for (let k = 0; k < result.chats.length; k++) {
                                ids.push(result.chats[k].id);
                            }
                            console.log("ids", ids);
                            console.log("messageClient", messageClient);
                            let messageUser;
                            let channelPeer;
                            if (enableForward) {
                                const entity = await client.getEntity(
                                    "eumortidevchannel"
                                );

                                messageUser = await client.getMessages(entity, {
                                    limit: 1,
                                });

                                messageUser = messageUser[0];
                                console.log(messageUser);
                                let channelAccessHash = await client.invoke(
                                    new Api.channels.GetFullChannel({
                                        channel: -1001873052992,
                                    })
                                );
                                console.log(
                                    "channelAccessHash",
                                    channelAccessHash
                                );
                                channelPeer = new Api.InputPeerChannel({
                                    channelId: channelAccessHash.chats[0].id,
                                    accessHash:
                                        channelAccessHash.chats[0].accessHash,
                                });
                                console.log("channelPeer", channelPeer);
                            } else {
                                messageUser = await client.sendMessage("me", {
                                    message: messageClient,
                                });
                            }

                            for (let k = 0; k < ids.length; k++) {
                                try {
                                    let request;
                                    if (enableForward) {
                                        request =
                                            new Api.messages.ForwardMessages({
                                                toPeer: ids[k],
                                                id: [messageUser.id],
                                                fromPeer: channelPeer,
                                            });
                                    } else {
                                        request =
                                            new Api.messages.ForwardMessages({
                                                toPeer: ids[k],
                                                id: [messageUser.id],
                                                fromPeer: "me",
                                            });
                                    }

                                    const response = await client.invoke(
                                        request
                                    );
                                    console.log("response", response);
                                    saveLog(
                                        "FORWARDED MESSAGE: " +
                                            response.chats[0].title
                                    );
                                    await sleep(sleepTime);
                                    saveLog(`SLEEP:  ${sleepTime}`);
                                } catch (error) {
                                    console.log(error);
                                    saveLog(
                                        `Ссылка на чат: ${foldersList[j]} | ID Канала: ${ids[k]} | Ошибка: ${error.errorMessage}`
                                    );
                                }
                            }
                            saveLog("Рассылка закончена");

                            try {
                                const result = await client.invoke(
                                    new Api.chatlists.LeaveChatlist({
                                        chatlist:
                                            new Api.InputChatlistDialogFilter({
                                                filterId: folderId,
                                            }),
                                        peers: [],
                                    })
                                );
                                saveLog("Удалил папку");
                            } catch (error) {
                                console.log(error);
                                saveLog(
                                    "Произошла ошибка при удалении папки: " +
                                        error
                                );
                            }
                            sleep(minute * 5);
                            folderIt++;
                        }
                        sleep(sleepTime);
                    }
                } catch (error) {
                    console.log(error);
                //    saveLog(error);
                }
            }

            res.send({ empty: "" });
        } catch (error) {
            console.log(error);
            throw new Error(error);
        }
    })
);
app.post(
    "/api/account-params",
    asyncHandler(async (req, res) => {
        try {
            const { phoneNumber, action } = req.body;
            console.log(phoneNumber);
            console.log(action);
            //const allSessions = getSessions();
            const session = loadSession(phoneNumber);
            const stringSession = new StringSession(session.sessionString); // Пустая сессия
            // console.log(stringSession);
            const client = new TelegramClient(
                stringSession,
                parseInt(session.apiId),
                session.apiHash,
                {
                    connectionRetries: 5,
                }
            );

            switch (action) {
                case "DELETE_CHATS_CHANNELS":
                    await client.connect();
                    const dialogs = await client.getDialogs();

                    for (let i = 0; i < dialogs.length; i++) {
                        try {
                            if (dialogs[i].isChannel) {
                                await client.invoke(
                                    new Api.channels.LeaveChannel({
                                        channel: dialogs[i].inputEntity,
                                    })
                                );
                                saveLog(
                                    "LEFT CHANNEL: " +
                                        dialogs[i].inputEntity.channelId
                                );
                            } else if (dialogs[i].isGroup) {
                                await client.invoke(
                                    new Api.messages.DeleteChatUser({
                                        chatId: dialogs[i].id,
                                        userId: "me",
                                    })
                                );

                                saveLog("LEFT GROUP:" + dialogs[i].id);
                            }
                        } catch (error) {
                            console.log(error);
                        }
                    }
                    res.send("Chats deleted");
                    break;

                case "LEAVE_DIALOGS":
                    await client.connect();
                    const result = await client.invoke(
                        new Api.messages.GetDialogFilters()
                    );

                    console.log(result);

                    for (let i = 0; i < result.length; i++) {
                        //  if (result[i].className == "DialogFilterChatlist"||result[i].className) {
                        try {
                            console.log(result[i].id);
                            const left = await client.invoke(
                                new Api.chatlists.LeaveChatlist({
                                    chatlist: new Api.InputChatlistDialogFilter(
                                        {
                                            filterId: result[i].id,
                                        }
                                    ),
                                    peers: result[i].includePeers,
                                })
                            );
                            console.log(left);
                            saveLog(`Удалил папку: ` + result[i].title);
                        } catch (error) {
                            //    console.log(error);
                            console.log(
                                "Ошибка удаления папки:" + result[i].title,
                                error
                            );
                            saveLog(
                                "Ошибка удаления папки:" + result[i].title,
                                error
                            );
                        }
                        try {
                            console.log(result[i].id);

                            const left = await client.invoke(
                                new Api.messages.UpdateDialogFilter({
                                    id: result[i].id,
                                })
                            );
                            saveLog(`Удалил папку: ` + result[i].title);
                        } catch (error) {
                            console.log(
                                "Ошибка удаления папки:" + result[i].title,
                                error
                            );
                            saveLog(
                                "Ошибка удаления папки:" + result[i].title,
                                error
                            );
                        }

                        // }
                    }

                    break;

                case "DELETE_ACCOUNT":
                    deleteSession(phoneNumber);
                    res.send({ success: true, action: "DELETE_ACCOUNT" });
                    break;

                case "VALIDATE_ACCOUNT":
                    try {
                        await client.connect();
                        const isUserAuthorized =
                            await client.checkAuthorization();
                        const isAuthorized = await client.isUserAuthorized();

                        console.log(
                            "isUserAuthorized",
                            isUserAuthorized,
                            "isAuthorized",
                            isAuthorized
                        );
                        if (isUserAuthorized && isAuthorized) {
                            res.send({
                                success: true,
                                action: "VALIDATE_ACCOUNT",
                            });
                            //return;
                        } else {
                            res.send({
                                success: false,
                                action: "VALIDATE_ACCOUNT",
                            });

                            deleteSession(phoneNumber);
                            //return;
                        }
                    } catch (error) {
                        console.log("error", error);
                        saveLog(error);
                        deleteSession(phoneNumber);
                    }

                    break;
            }
        } catch (error) {
            console.log(error);
            throw new Error(error);
        }
    })
);

function multiplySplit(arraySplit, text) {
    //console.log(arraySplit);
    for (let i = 0; i < arraySplit.length; i++) {
        // console.log("text:",text,"includes:",arraySplit[i],"IS:",text.includes(arraySplit[i]));
        try {
            if (text.includes(arraySplit[i].param)) {
                text = text.split(arraySplit[i].param);
                text = {
                    type: arraySplit[i].type,
                    join: text[text.length - 1],
                };
                if (text.join.includes("/")) {
                    text.join = text.split("/")[0];
                }

                console.log("text:", text);
                return text;
            } else if (text.includes(":")) {
                text = text.split(":");
                text = {
                    type: "channel",
                    join: text[0],
                };
                return text;
            }
        } catch (error) {
            console.log(error);
            console.log(("error was with: ", text));
        }
    }
    return null;
}

function chatsValidation(chats) {
    // var regex = new RegExp('@(?:t|telegram)\\.(?:me|dog)/(joinchat/|\\+)?([\\w-]+)', 'i');

    chats = chats.split("\n");
    const splitArray = [
        {
            type: "group",
            param: "https://t.me/+",
        },
        {
            type: "group",
            param: "http://t.me/+",
        },
        {
            type: "group",
            param: "t.me/+",
        },
        {
            type: "group",
            param: "https://t.me/joinchat/",
        },
        {
            type: "group",
            param: "http://t.me/joinchat/",
        },
        {
            type: "group",
            param: "tg://join?invite=",
        },
        {
            type: "channel",
            param: "t.me/",
        },
        {
            type: "channel",
            param: "@",
        },
        {
            type: "group",
            param: "@",
        },
    ];
    console.log(chats);
    for (let i = 0; i < chats.length; i++) {
        chats[i] = multiplySplit(splitArray, chats[i]);
        //  console.log(chats[i]);
    }

    // for(let i=0;i<chats.length;i++){
    //     if(chats[i].join.includes(":")){
    //         chats[i].join=chats[i].join.split(":")[0];
    //     }
    // }

    // в прошлом функции есть null. сортируем и убираем
    chats = chats.filter((item) => item != null);
    console.log(chats);
    return chats;
}

// I'm maintaining all active connections in this object
const clients = {};

// A new client connection request received
// wsServer.on("connection", function (connection) {
//     // Generate a unique code for every user
//     const userId = uuid();
//     console.log(`Recieved a new connection.`);

//     // Store the new connection and handle messages
//     clients[userId] = connection;
//     console.log(`${userId} connected.`);
//     // User disconnected
//     wsServer.on("close", () => handleDisconnect(userId));
// });

setInterval(() => {
    broadcastLogs();
}, 3000);

function broadcastLogs() {
    // We are sending the current data to all connected active clients
    const data = JSON.stringify(logs);
    for (let userId in clients) {
        let client = clients[userId];

        client.send(data);
        console.log("sended to client");
    }
}

function getLoginData(message, userId) {}
