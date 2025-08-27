/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import { marked } from 'marked';

// --- State Management ---
const appState = {
    ai: null,
    gapiInited: false,
    gisInited: false,
    tokenClient: null,
    isSignedIn: false,
    chatHistory: [],
    currentDisplayedDate: new Date(),
    currentView: 'chat', // 'chat' or 'calendar'
};

// --- DOM Elements ---
const dom = {
    // Main layout
    appContainer: document.querySelector('.app-container'),
    // Header
    authStatusContainer: document.getElementById('auth-status-container'),
    settingsButton: document.getElementById('settings-button'),
    // Chat
    chatView: document.getElementById('chat-view'),
    messageList: document.getElementById('message-list'),
    chatTextInput: document.getElementById('chat-text-input'),
    micButtonChat: document.getElementById('mic-button-chat'),
    sendButtonChat: document.getElementById('send-button-chat'),
    cameraButtonChat: document.getElementById('camera-button-chat'),
    imageUploadInputChat: document.getElementById('image-upload-input-chat'),
    loadingIndicator: document.getElementById('loading-indicator'),
    welcomeScreen: document.getElementById('welcome-screen'),
    welcomeSubheading: document.getElementById('welcome-subheading'),
    suggestionChipsContainer: document.getElementById('suggestion-chips-container'),
    // Calendar
    calendarView: document.getElementById('calendar-view'),
    calendarLoginPrompt: document.getElementById('calendar-login-prompt'),
    calendarViewContainer: document.getElementById('calendar-view-container'),
    prevMonthButton: document.getElementById('prev-month-button'),
    nextMonthButton: document.getElementById('next-month-button'),
    todayButton: document.getElementById('today-button'),
    currentMonthYear: document.getElementById('current-month-year'),
    calendarGridWeekdays: document.getElementById('calendar-grid-weekdays'),
    calendarGridDays: document.getElementById('calendar-grid-days'),
    dailyEventsHeader: document.getElementById('daily-events-header'),
    dailyEventsList: document.getElementById('daily-events-list'),
    // Modals
    settingsModal: document.getElementById('settings-modal'),
    authContainerSettings: document.getElementById('auth-container-settings'),
    googleClientIdInstructionsModal: document.getElementById('google-client-id-instructions-modal'),
    // Mobile Nav
    mobileTabBar: document.querySelector('.mobile-tab-bar'),
};

// --- Speech Recognition ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
let isRecognizing = false;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
}

// --- Promises for API loading ---
const gapiReady = new Promise(resolve => { window.gapiLoadedCallback = resolve; });
const gisReady = new Promise(resolve => { window.gisInitalisedCallback = resolve; });

// --- Initialization ---

async function initializeApp() {
    setupEventListeners();
    const geminiApiKey = localStorage.getItem('geminiApiKey');
    const googleClientId = localStorage.getItem('googleClientId');
    
    document.getElementById('settings-gemini-api-key').value = geminiApiKey || '';
    document.getElementById('settings-google-client-id').value = googleClientId || '';


    if (geminiApiKey) {
        try {
            appState.ai = new GoogleGenAI({ apiKey: geminiApiKey });
        } catch (error) {
            console.error("Failed to initialize GoogleGenAI:", error);
            localStorage.removeItem('geminiApiKey'); // Clear bad key
            alert("Ошибка инициализации Gemini API. Проверьте ключ.");
        }
    }

    if (googleClientId) {
        await initializeGapiClient(googleClientId);
    }
    
    // Always start in a logged-out state for stability. User must explicitly sign in.
    updateUiForAuthState(false);
}

async function initializeGapiClient(clientId) {
    try {
        await gapiReady;
        // Ensure the client library is loaded before trying to use it.
        await new Promise((resolve, reject) => gapi.load('client', { callback: resolve, onerror: reject }));
        
        await gapi.client.init({
            discoveryDocs: [
                "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
                "https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest"
            ]
        });
        appState.gapiInited = true;

        await gisReady;
        const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/contacts.readonly";
        appState.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPES,
            callback: handleTokenResponse,
        });
        appState.gisInited = true;
    } catch (error) {
        console.error("Google API initialization error:", error);
        alert("Не удалось инициализировать Google API. Проверьте ваш Client ID.");
        localStorage.removeItem('googleClientId');
    }
}

// --- Authentication & UI Updates ---

function handleAuthClick() {
    if (appState.gisInited && appState.tokenClient) {
        appState.tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        alert("Ошибка конфигурации. Проверьте Client ID в настройках.");
    }
}

function handleSignOutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken(null);
            appState.chatHistory = [];
            dom.messageList.innerHTML = '';
            updateUiForAuthState(false);
        });
    }
}

async function handleTokenResponse(response) {
    if (response.error) {
        console.error('Google token error:', response);
        appendMessage('error', `Ошибка авторизации: ${response.error_description || 'Попробуйте еще раз.'}`);
        updateUiForAuthState(false);
        return;
    }
    gapi.client.setToken(response);
    if (document.getElementById('settings-modal').style.display === 'flex') {
        closeModal(document.getElementById('settings-modal'));
    }
    updateUiForAuthState(true);
}

async function updateUiForAuthState(isSignedIn) {
    appState.isSignedIn = isSignedIn;
    const geminiKey = localStorage.getItem('geminiApiKey');
    const clientId = localStorage.getItem('googleClientId');
    const keysExist = geminiKey && clientId;

    // --- 1. Update Header: Auth Button / User Avatar ---
    dom.authStatusContainer.innerHTML = '';
    if (isSignedIn) {
        try {
            const profile = await gapi.client.request({ path: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json' });
            const user = profile.result;
            dom.authStatusContainer.innerHTML = `
                <img src="${user.picture}" alt="Аватар пользователя" class="user-avatar" id="user-avatar-button">
                <div class="dropdown-menu" id="user-dropdown">
                  <div class="dropdown-header">
                     <img src="${user.picture}" alt="Аватар пользователя">
                     <div class="user-info">
                        <strong>${user.name}</strong>
                        <span>${user.email}</span>
                     </div>
                  </div>
                  <button class="dropdown-item" id="sign-out-button-dropdown">
                    <span class="material-symbols-outlined">logout</span>
                    Выйти
                  </button>
                </div>
            `;
            document.getElementById('user-avatar-button').addEventListener('click', () => {
                document.getElementById('user-dropdown').classList.toggle('show');
            });
            document.getElementById('sign-out-button-dropdown').addEventListener('click', handleSignOutClick);
            
            // Close dropdown if clicked outside
            window.addEventListener('click', (e) => {
                if (!dom.authStatusContainer.contains(e.target)) {
                    document.getElementById('user-dropdown')?.classList.remove('show');
                }
            });

        } catch (error) {
            console.error("Failed to fetch user profile", error);
            // Fallback to sign out button if profile fetch fails
            handleSignOutClick(); 
        }
    } else {
        const authButton = document.createElement('button');
        authButton.id = 'auth-button-header';
        authButton.className = 'action-button';
        authButton.innerHTML = `<span class="material-symbols-outlined">login</span> Войти через Google`;
        authButton.onclick = handleAuthClick;
        authButton.disabled = !keysExist;
        authButton.title = keysExist ? 'Войти в аккаунт Google' : 'Сначала введите API ключи в настройках';
        dom.authStatusContainer.appendChild(authButton);
    }
    
    // --- 2. Update Settings Modal ---
    dom.authContainerSettings.innerHTML = '';
     if (isSignedIn) {
        const profile = await gapi.client.request({ path: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json' });
        const user = profile.result;
        dom.authContainerSettings.innerHTML = `
            <div class="settings-user-info">
                <img src="${user.picture}" alt="Аватар пользователя">
                <div class="settings-user-info-text">
                    <strong>${user.name}</strong>
                    <small>${user.email}</small>
                </div>
            </div>
            <button id="sign-out-button-settings" class="action-button">Выйти</button>
        `;
        document.getElementById('sign-out-button-settings').addEventListener('click', handleSignOutClick);
    } else if (keysExist) {
        dom.authContainerSettings.innerHTML = `
            <p>Войдите для доступа к календарю и задачам.</p>
            <button id="sign-in-button-settings" class="action-button primary">Войти</button>
        `;
        document.getElementById('sign-in-button-settings').addEventListener('click', handleAuthClick);
    } else {
        dom.authContainerSettings.innerHTML = `<p>Введите и сохраните API-ключи, чтобы включить авторизацию Google.</p>`;
    }

    // --- 3. Update Main Content Panes ---
    if (isSignedIn) {
        dom.welcomeScreen.style.display = 'none';
        dom.calendarLoginPrompt.style.display = 'none';
        dom.calendarViewContainer.style.display = 'grid';
        dom.suggestionChipsContainer.style.display = 'flex';
        renderCalendar(appState.currentDisplayedDate);
        renderDailyEvents(appState.currentDisplayedDate);
    } else {
        dom.welcomeScreen.style.display = 'flex';
        dom.calendarLoginPrompt.style.display = 'flex';
        dom.calendarViewContainer.style.display = 'none';
        dom.suggestionChipsContainer.style.display = 'none';
        
        if (!keysExist) {
            dom.welcomeSubheading.textContent = "Для начала работы введите ключи API в настройках (⚙️).";
            dom.calendarLoginPrompt.querySelector('p').textContent = "Сначала настройте ключи API.";
        } else {
            dom.welcomeSubheading.textContent = "Войдите в свой аккаунт Google, чтобы начать.";
            dom.calendarLoginPrompt.querySelector('p').textContent = "Войдите в аккаунт Google, чтобы увидеть ваш календарь.";
        }
    }
}


// --- UI Interaction ---

function switchView(viewName) {
    appState.currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${viewName}-view`).classList.add('active');

    dom.mobileTabBar.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    dom.mobileTabBar.querySelector(`[data-view="${viewName}"]`).classList.add('active');
}

function showModal(modalElement) {
    modalElement.style.display = 'flex';
    setTimeout(() => modalElement.classList.add('visible'), 10);
}

function closeModal(modalElement) {
    modalElement.classList.remove('visible');
    setTimeout(() => { modalElement.style.display = 'none'; }, 300);
}


// --- Calendar ---

function renderCalendar(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    dom.currentMonthYear.textContent = date.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
    dom.calendarGridDays.innerHTML = '';

    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayOffset = (firstDayOfMonth === 0) ? 6 : firstDayOfMonth - 1;

    for (let i = 0; i < dayOffset; i++) {
        dom.calendarGridDays.innerHTML += `<div class="day-cell other-month"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        cell.textContent = day;
        cell.dataset.day = day;

        const today = new Date();
        if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
            cell.classList.add('today');
        }
        
        const selectedDate = new Date(dom.dailyEventsHeader.dataset.date || today);
        if (day === selectedDate.getDate() && month === selectedDate.getMonth() && year === selectedDate.getFullYear()) {
            cell.classList.add('selected');
        }

        cell.addEventListener('click', () => {
            dom.calendarGridDays.querySelector('.selected')?.classList.remove('selected');
            cell.classList.add('selected');
            renderDailyEvents(new Date(year, month, day));
        });
        dom.calendarGridDays.appendChild(cell);
    }
    loadCalendarEvents(year, month);
}

async function loadCalendarEvents(year, month) {
    if (!appState.isSignedIn) return;

    const timeMin = new Date(year, month, 1).toISOString();
    const timeMax = new Date(year, month + 1, 0).toISOString();
    try {
        const response = await gapi.client.calendar.events.list({
            'calendarId': 'primary', 'timeMin': timeMin, 'timeMax': timeMax, 'showDeleted': false, 'singleEvents': true
        });
        
        dom.calendarGridDays.querySelectorAll('.event-dot').forEach(dot => dot.remove());

        response.result.items.forEach(event => {
            const startDate = new Date(event.start.dateTime || event.start.date);
            const dayOfMonth = startDate.getDate();
            const cell = dom.calendarGridDays.querySelector(`[data-day="${dayOfMonth}"]`);
            if (cell && !cell.querySelector('.event-dot')) {
                const dot = document.createElement('div');
                dot.className = 'event-dot';
                cell.appendChild(dot);
            }
        });
    } catch (err) {
        console.error("Error loading calendar events:", err);
    }
}

async function renderDailyEvents(date) {
    dom.dailyEventsHeader.textContent = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    dom.dailyEventsHeader.dataset.date = date.toISOString();
    dom.dailyEventsList.innerHTML = '<li>Загрузка...</li>';
    if (!appState.isSignedIn) {
        dom.dailyEventsList.innerHTML = '';
        return;
    }

    const timeMin = new Date(date.setHours(0, 0, 0, 0)).toISOString();
    const timeMax = new Date(date.setHours(23, 59, 59, 999)).toISOString();

    try {
        const response = await gapi.client.calendar.events.list({
            'calendarId': 'primary', 'timeMin': timeMin, 'timeMax': timeMax, 'showDeleted': false, 'singleEvents': true, 'orderBy': 'startTime'
        });
        
        dom.dailyEventsList.innerHTML = '';
        if (response.result.items.length === 0) {
            dom.dailyEventsList.innerHTML = '<li>Нет событий на этот день.</li>';
        } else {
            response.result.items.forEach(event => {
                dom.dailyEventsList.appendChild(createEventElement(event));
            });
        }
    } catch (err) {
        console.error("Error fetching daily events:", err);
        dom.dailyEventsList.innerHTML = '<li>Не удалось загрузить события.</li>';
    }
}

function createEventElement(event) {
    const li = document.createElement('li');
    li.className = 'event-item';
    const startTime = (event.start.dateTime)
        ? new Date(event.start.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : 'Весь день';

    li.innerHTML = `
        <div class="event-color-indicator"></div>
        <div class="event-details">
            <h4 class="event-item-title">${event.summary || '(Без названия)'}</h4>
            <div class="event-item-time">
                <span class="material-symbols-outlined">schedule</span>
                <span>${startTime}</span>
            </div>
            ${event.location ? `<div class="event-item-location"><span class="material-symbols-outlined">location_on</span><span>${event.location}</span></div>` : ''}
        </div>
    `;
    return li;
}


// --- Chat & Gemini ---

async function sendMessage(text, images = []) {
    const textTrimmed = text.trim();
    if (!textTrimmed && images.length === 0) return;
    if (!appState.ai) {
        appendMessage('error', 'Ключ Gemini API не настроен. Пожалуйста, добавьте его в настройках.');
        return;
    }

    showLoading(true);
    dom.welcomeScreen.style.opacity = '0';
    setTimeout(() => { dom.welcomeScreen.style.display = 'none'; }, 300);

    const userMessageContent = [];
    if (images.length > 0) {
        userMessageContent.push(...images.map(img => ({ inlineData: { mimeType: img.type, data: img.data } })));
        const imagePrompt = textTrimmed || 'Проанализируй это изображение. Если на нем есть информация о событии (название, дата, время, место), извлеки эти данные. В противном случае просто опиши, что на нем изображено.';
        userMessageContent.push({ text: imagePrompt });
    } else {
        userMessageContent.push({ text: textTrimmed });
    }

    const userMessage = { role: 'user', parts: userMessageContent };
    appendMessage('user', textTrimmed, images);
    appState.chatHistory.push(userMessage);
    
    dom.chatTextInput.value = '';
    dom.chatTextInput.dispatchEvent(new Event('input', { bubbles: true }));

    const systemInstruction = `Вы — высокоэффективный ассистент, интегрированный с Google Календарем и Google Задачами.
- Ваша основная задача — ВЫПОЛНЯТЬ ДЕЙСТВИЯ, а не давать инструкции или шаблоны.
- Текущая дата: ${new Date().toISOString()}.
- Если запрос пользователя можно выполнить с помощью одного из ваших инструментов, вы ОБЯЗАНЫ вызвать этот инструмент.
- ЗАПРЕЩЕНО: Отвечать текстом, имитирующим создание события или задачи (например: "Хорошо, я создам событие..."). Вместо этого вы должны НЕЗАМЕДЛИТЕЛЬНО вызвать соответствующий инструмент.
- ПОСЛЕ успешного вызова инструмента, ваш финальный ответ должен быть коротким подтверждением (например, "Готово", "Событие создано", "Задача добавлена") и ОБЯЗАТЕЛЬНО содержать интерактивную карточку.
- Если для создания события или задачи не хватает информации (например, нет времени или названия), задайте уточняющий вопрос. Не предполагайте недостающие детали.
- Если пользователь упоминает "онлайн-встречу", "звонок", "созвон" или "митинг", автоматически добавляйте ссылку на Google Meet.`;

    const tools = [{
        functionDeclarations: [
            {
                name: 'create_calendar_event',
                description: 'Создает событие в Google Календаре пользователя.',
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        summary: { type: Type.STRING, description: 'Название или заголовок события.' },
                        description: { type: Type.STRING, description: 'Подробное описание события.' },
                        start_time: { type: Type.STRING, description: 'Время начала в формате ISO 8601 (например, "2024-08-15T10:00:00Z").' },
                        end_time: { type: Type.STRING, description: 'Время окончания в формате ISO 8601 (например, "2024-08-15T11:00:00Z").' },
                        location: { type: Type.STRING, description: 'Место проведения события.' },
                        add_meet_link: { type: Type.BOOLEAN, description: 'Установить в true, если нужна ссылка на видеоконференцию Google Meet.' }
                    },
                    required: ['summary', 'start_time', 'end_time']
                }
            },
            {
                name: 'create_task',
                description: 'Создает задачу в Google Задачах пользователя.',
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: 'Название задачи.' },
                        notes: { type: Type.STRING, description: 'Дополнительные детали или описание задачи.' },
                        due: { type: Type.STRING, description: 'Срок выполнения задачи в формате ISO 8601 (только дата, например, "2024-08-15T00:00:00Z").' }
                    },
                    required: ['title']
                }
            }
        ]
    }];

    try {
        const response = await appState.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [...appState.chatHistory],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            tools: tools,
        });

        const modelResponse = response;
        const toolCalls = modelResponse.candidates[0].content.parts.filter(part => part.functionCall);

        if (toolCalls && toolCalls.length > 0) {
            const call = toolCalls[0].functionCall;
            const functionName = call.name;
            const args = call.args;
            let toolResult;

            appendMessage('system', `Вызываю инструмент: ${functionName}...`);

            if (functionName === 'create_calendar_event') {
                toolResult = await createCalendarEvent(args);
            } else if (functionName === 'create_task') {
                toolResult = await createTask(args);
            } else {
                toolResult = { success: false, error: 'Неизвестный инструмент' };
            }
            
            // We don't need a second call to the model for this app's flow.
            // The tool result itself is enough to inform the user.
        } else {
             // If no tool is called, display the text response.
            const text = modelResponse.text;
            appendMessage('model', text);
            appState.chatHistory.push({ role: 'model', parts: [{ text }] });
        }
    } catch (error) {
        console.error('Gemini API Error:', error);
        appendMessage('error', 'Произошла ошибка при обращении к Gemini. Попробуйте снова.');
    } finally {
        showLoading(false);
    }
}


async function createCalendarEvent(args) {
    if (!appState.isSignedIn) {
        appendMessage('error', 'Необходимо войти в аккаунт Google для создания событий.');
        return { success: false, error: 'Not signed in' };
    }
    try {
        const event = {
            'summary': args.summary,
            'location': args.location,
            'description': args.description,
            'start': { 'dateTime': args.start_time, 'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone },
            'end': { 'dateTime': args.end_time, 'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone },
            'attendees': [],
            'reminders': { 'useDefault': true },
        };

        if (args.add_meet_link) {
            event.conferenceData = {
                createRequest: { requestId: `meet-${Date.now()}` }
            };
        }

        const request = gapi.client.calendar.events.insert({
            'calendarId': 'primary',
            'resource': event,
            'conferenceDataVersion': 1
        });

        const response = await request;
        const createdEvent = response.result;
        appendMessage('model', `Событие создано!`);
        appendCard('event-card', createdEvent);
        renderCalendar(appState.currentDisplayedDate); // Refresh calendar view
        renderDailyEvents(new Date(createdEvent.start.dateTime)); // Refresh daily events
        return { success: true, event: createdEvent };
    } catch (error) {
        console.error('Google Calendar API Error:', error);
        appendMessage('error', `Не удалось создать событие: ${error.result?.error?.message || error.message}`);
        return { success: false, error: error.message };
    }
}

async function createTask(args) {
    if (!appState.isSignedIn) {
        appendMessage('error', 'Необходимо войти в аккаунт Google для создания задач.');
        return { success: false, error: 'Not signed in' };
    }
    try {
        const task = {
            'title': args.title,
            'notes': args.notes,
            'due': args.due,
        };
        const response = await gapi.client.tasks.tasks.insert({
            'tasklist': '@default',
            'resource': task
        });
        const createdTask = response.result;
        appendMessage('model', `Задача добавлена.`);
        appendCard('task-card', createdTask);
        return { success: true, task: createdTask };
    } catch (error) {
        console.error('Google Tasks API Error:', error);
        appendMessage('error', `Не удалось создать задачу: ${error.result?.error?.message || error.message}`);
        return { success: false, error: error.message };
    }
}

// --- UI Helpers ---

function appendMessage(role, text, images = []) {
    const messageWrapper = document.createElement('div');
    messageWrapper.className = `message-wrapper ${role}-wrapper`;

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${role}-bubble`;
    
    if (images.length > 0) {
        const imageContainer = document.createElement('div');
        imageContainer.className = 'image-preview-container';
        images.forEach(img => {
            const imgEl = document.createElement('img');
            imgEl.src = `data:${img.type};base64,${img.data}`;
            imageContainer.appendChild(imgEl);
        });
        bubble.appendChild(imageContainer);
    }

    const textElement = document.createElement('div');
    if (role === 'model') {
        textElement.innerHTML = marked.parse(text);
    } else {
        textElement.textContent = text;
    }
    bubble.appendChild(textElement);
    
    messageWrapper.appendChild(bubble);
    dom.messageList.appendChild(messageWrapper);
    dom.messageList.scrollTop = dom.messageList.scrollHeight;
}

function appendCard(type, data) {
    const cardWrapper = document.createElement('div');
    cardWrapper.className = 'message-wrapper model-wrapper'; // Display as model response
    let cardHtml = '';

    if (type === 'event-card' && data) {
        const startTime = new Date(data.start.dateTime).toLocaleString('ru-RU', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        cardHtml = `
            <div class="card event-card">
                <div class="card-icon"><span class="material-symbols-outlined">event</span></div>
                <div class="card-content">
                    <h4>${data.summary || '(Без названия)'}</h4>
                    <p>${startTime}</p>
                </div>
                <a href="${data.htmlLink}" target="_blank" class="card-button" aria-label="Открыть событие в Google Календаре">
                    <span class="material-symbols-outlined">open_in_new</span>
                </a>
            </div>`;
    } else if (type === 'task-card' && data) {
        cardHtml = `
            <div class="card task-card">
                <div class="card-icon"><span class="material-symbols-outlined">task_alt</span></div>
                <div class="card-content">
                    <h4>${data.title || '(Без названия)'}</h4>
                    <p>Задача добавлена</p>
                </div>
                <a href="https://mail.google.com/tasks/canvas" target="_blank" class="card-button" aria-label="Открыть Google Задачи">
                    <span class="material-symbols-outlined">open_in_new</span>
                </a>
            </div>`;
    }
    
    if (cardHtml) {
        cardWrapper.innerHTML = cardHtml;
        dom.messageList.appendChild(cardWrapper);
        dom.messageList.scrollTop = dom.messageList.scrollHeight;
    }
}

function showLoading(isLoading) {
    dom.loadingIndicator.style.display = isLoading ? 'flex' : 'none';
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
    });
}

// --- Event Listeners ---
function setupEventListeners() {
    // Chat input
    dom.chatTextInput.addEventListener('input', () => {
        const hasText = dom.chatTextInput.value.trim().length > 0;
        dom.sendButtonChat.style.display = hasText ? 'flex' : 'none';
        dom.micButtonChat.style.display = hasText ? 'none' : 'flex';
        // Auto-resize textarea
        dom.chatTextInput.style.height = 'auto';
        dom.chatTextInput.style.height = `${dom.chatTextInput.scrollHeight}px`;
    });

    dom.chatTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(dom.chatTextInput.value);
        }
    });

    dom.sendButtonChat.addEventListener('click', () => sendMessage(dom.chatTextInput.value));
    
    // Suggestion chips
    document.querySelectorAll('.suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.textContent;
            dom.chatTextInput.value = prompt;
            dom.chatTextInput.dispatchEvent(new Event('input')); // Update UI
            sendMessage(prompt);
        });
    });

    // Mic and Camera
    if (recognition) {
        dom.micButtonChat.addEventListener('click', toggleRecognition);
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            dom.chatTextInput.value = transcript;
            dom.chatTextInput.dispatchEvent(new Event('input', { bubbles: true })); // Trigger UI update
            sendMessage(transcript);
        };
        recognition.onerror = (event) => { console.error('Speech recognition error:', event.error); };
        recognition.onend = () => {
            isRecognizing = false;
            dom.micButtonChat.classList.remove('active');
            dom.micButtonChat.querySelector('.material-symbols-outlined').textContent = 'mic';
        };
    } else {
        dom.micButtonChat.disabled = true;
    }

    dom.cameraButtonChat.addEventListener('click', () => dom.imageUploadInputChat.click());
    dom.imageUploadInputChat.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file) {
            const base64Data = await fileToBase64(file);
            sendMessage(dom.chatTextInput.value, [{ type: file.type, data: base64Data }]);
        }
        event.target.value = null; // Reset input
    });
    
    // Calendar Navigation
    dom.prevMonthButton.addEventListener('click', () => {
        appState.currentDisplayedDate.setMonth(appState.currentDisplayedDate.getMonth() - 1);
        renderCalendar(appState.currentDisplayedDate);
    });
    dom.nextMonthButton.addEventListener('click', () => {
        appState.currentDisplayedDate.setMonth(appState.currentDisplayedDate.getMonth() + 1);
        renderCalendar(appState.currentDisplayedDate);
    });
    dom.todayButton.addEventListener('click', () => {
        appState.currentDisplayedDate = new Date();
        renderCalendar(appState.currentDisplayedDate);
        renderDailyEvents(appState.currentDisplayedDate);
    });

    // Settings Modal
    dom.settingsButton.addEventListener('click', () => showModal(dom.settingsModal));
    document.getElementById('close-settings-button').addEventListener('click', () => closeModal(dom.settingsModal));
    document.getElementById('save-api-keys-button').addEventListener('click', () => {
        const geminiKey = document.getElementById('settings-gemini-api-key').value;
        const clientId = document.getElementById('settings-google-client-id').value;
        localStorage.setItem('geminiApiKey', geminiKey);
        localStorage.setItem('googleClientId', clientId);
        closeModal(dom.settingsModal);
        // Re-initialize to apply new keys
        location.reload();
    });
    
    // Client ID instructions modal
    document.querySelector('.open-client-id-instructions').addEventListener('click', (e) => {
        e.preventDefault();
        showModal(dom.googleClientIdInstructionsModal);
    });
    document.getElementById('close-instructions-button').addEventListener('click', () => {
        closeModal(dom.googleClientIdInstructionsModal);
    });


    // Mobile Tab Bar
    dom.mobileTabBar.addEventListener('click', (e) => {
        const button = e.target.closest('.tab-button');
        if (button) {
            switchView(button.dataset.view);
        }
    });

    // Initialize with chat view active
    switchView('chat');

    // Add weekday headers to calendar
    const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekdays.forEach(day => {
        dom.calendarGridWeekdays.innerHTML += `<div class="weekday-header">${day}</div>`;
    });
}

function toggleRecognition() {
    if (isRecognizing) {
        recognition.stop();
        isRecognizing = false;
        dom.micButtonChat.classList.remove('active');
        dom.micButtonChat.querySelector('.material-symbols-outlined').textContent = 'mic';
    } else {
        recognition.start();
        isRecognizing = true;
        dom.micButtonChat.classList.add('active');
        dom.micButtonChat.querySelector('.material-symbols-outlined').textContent = 'stop_circle';
    }
}


// --- App Start ---
document.addEventListener('DOMContentLoaded', initializeApp);
