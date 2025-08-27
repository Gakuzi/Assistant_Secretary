/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import { marked } from 'marked';

// --- Constants ---
// ВНИМАНИЕ: Этот Client ID предназначен для демонстрационных целей.
// Для реального приложения вы должны создать свой собственный в Google Cloud Console.
const GOOGLE_CLIENT_ID = '30050849489-0v528d7bpt2l0375fca94892o73ivp97.apps.googleusercontent.com';

// --- State Management ---
const appState = {
    ai: null,
    gapiInited: false,
    gisInited: false,
    tokenClient: null,
    isSignedIn: false,
    chatHistory: [],
    currentDisplayedDate: new Date(),
    currentView: 'chat',
    attachedImages: [],
};

// --- DOM Elements ---
const dom = {
    // Main layout
    appContainer: document.querySelector('.app-container'),
    chatInputContainer: document.querySelector('.chat-input-container'),
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
    // Modals & Setup
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsButton: document.getElementById('close-settings-button'),
    saveApiKeysButton: document.getElementById('save-api-keys-button'),
    resetAppButton: document.getElementById('reset-app-button'),
    settingsGeminiApiKey: document.getElementById('settings-gemini-api-key'),
    authContainerSettings: document.getElementById('auth-container-settings'),
    setupScreen: document.getElementById('setup-screen'),
    setupStep1: document.getElementById('setup-step-1'),
    setupStep2: document.getElementById('setup-step-2'),
    setupStepError: document.getElementById('setup-step-error'),
    setupErrorMessage: document.getElementById('setup-error-message'),
    setupTryAgainButton: document.getElementById('setup-try-again-button'),
    setupGeminiApiKey: document.getElementById('setup-gemini-api-key'),
    setupVerifyApiKeyButton: document.getElementById('setup-verify-api-key-button'),
    setupAuthButton: document.getElementById('setup-auth-button'),
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
const gisReady = new Promise(resolve => { window.gisInalidCallback = resolve; });

// --- Initialization ---

async function initializeApp() {
    setupEventListeners();
    const geminiApiKey = localStorage.getItem('geminiApiKey');

    if (GOOGLE_CLIENT_ID.startsWith('YOUR_GOOGLE_CLIENT_ID')) {
        alert('Ошибка конфигурации: необходимо указать Google Client ID в файле index.js');
        return;
    }

    if (!geminiApiKey) {
        // No key -> Start setup flow
        showSetupScreen(true, 1);
        setMainUiEnabled(false);
    } else {
        // Key exists -> Try to init Gemini, then Google
        appState.ai = new GoogleGenAI({ apiKey: geminiApiKey });
        dom.settingsGeminiApiKey.value = geminiApiKey;

        await initializeGapiClient();

        // GAPI is ready, but are we signed in? Let's check.
        // gapi.client.getToken() will be null if not signed in from a previous session
        if (gapi.client.getToken() && gapi.client.getToken().access_token) {
            // Already signed in, full steam ahead
            await updateUiForAuthState(true);
            setMainUiEnabled(true);
        } else {
            // Not signed in -> show step 2 of setup
            showSetupScreen(true, 2);
            setMainUiEnabled(false);
        }
    }
}

async function initializeGapiClient() {
    if (appState.gapiInited && appState.gisInited) return; // Don't re-initialize
    try {
        await gapiReady;
        await new Promise((resolve, reject) => gapi.load('client', { callback: resolve, onerror: reject }));

        await gapi.client.init({
            discoveryDocs: [
                "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
                "https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest"
            ]
        });
        appState.gapiInited = true;

        await gisReady;
        const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";
        appState.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: handleTokenResponse,
        });
        appState.gisInited = true;
    } catch (error) {
        console.error("Google API initialization error:", error);
        alert("Не удалось инициализировать Google API. Проверьте ваш Client ID и подключение к сети.");
    }
}

async function verifyGeminiApiKey(apiKey) {
    if (!apiKey) return false;
    const tempAi = new GoogleGenAI({ apiKey });
    try {
        const response = await tempAi.models.generateContent({
             model: 'gemini-2.5-flash',
             contents: 'Say "Hello"',
        });
        return response && response.text && response.text.trim().length > 0;
    } catch (error) {
        console.error("Gemini API Key validation failed:", error);
        return false;
    }
}

async function generateDynamicSuggestions() {
    if (!appState.ai) return;
    try {
        const prompt = `Создай 3 коротких примера-запроса для ассистента-календаря на русском языке. Ответ дай в виде JSON-массива строк. Пример: ["Какие у меня планы на завтра?", "Создай встречу в пятницу в 10 утра", "Напомни позвонить маме"]`;
        const response = await appState.ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        const suggestions = JSON.parse(response.text);
        
        dom.suggestionChipsContainer.innerHTML = '';
        suggestions.forEach(text => {
            const button = document.createElement('button');
            button.className = 'suggestion-chip';
            button.textContent = text;
            dom.suggestionChipsContainer.appendChild(button);
        });

    } catch (error) {
        console.error("Failed to generate dynamic suggestions:", error);
        // Fallback to static suggestions
         dom.suggestionChipsContainer.innerHTML = `
            <button class="suggestion-chip">Создать встречу на завтра в 10 утра</button>
            <button class="suggestion-chip">Какие у меня планы на пятницу?</button>
            <button class="suggestion-chip">Напомни мне позвонить в сервис в 15:00</button>
         `;
    }
}


// --- App Reset ---
function resetApp() {
    const confirmation = confirm("Вы уверены, что хотите сбросить все настройки? Все данные, включая API ключ и данные авторизации, будут удалены.");
    if (confirmation) {
        try {
            const token = gapi.client.getToken();
            if (token && token.access_token) {
                google.accounts.oauth2.revoke(token.access_token, () => {});
            }
        } catch (e) {
            console.error("Error revoking token on reset:", e);
        } finally {
            localStorage.clear();
            sessionStorage.clear();
            window.location.reload();
        }
    }
}


// --- Authentication & UI Updates ---

function handleAuthClick() {
    if (!appState.gisInited || !appState.tokenClient) {
        alert("Клиент авторизации Google еще не инициализирован. Пожалуйста, подождите несколько секунд и попробуйте снова.");
        return;
    }
    // 'consent' prompt is important to ensure the user gets a refresh token for offline access if needed
    appState.tokenClient.requestAccessToken({ prompt: 'consent' });
}


function handleSignOutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken(null);
            appState.isSignedIn = false;
            // Using reload is the simplest way to reset the app to a clean, logged-out state.
            window.location.reload();
        });
    }
}

async function handleTokenResponse(response) {
    if (response.error) {
        console.error('Google token error:', response);
        appendMessage('error', `Ошибка авторизации: ${response.error_description || 'Попробуйте еще раз.'}`);
        await updateUiForAuthState(false);
        return;
    }
    // The response contains the access token. Set it for the gapi client to use.
    gapi.client.setToken(response);
    showSetupScreen(false);
    setMainUiEnabled(true);
    await updateUiForAuthState(true);
}

async function updateUiForAuthState(isSignedIn) {
    appState.isSignedIn = isSignedIn;
    
    dom.authStatusContainer.innerHTML = '';
    dom.authContainerSettings.innerHTML = '';
    
    if (isSignedIn) {
        try {
            // Fetch user profile to display their name and picture
            const profile = await gapi.client.request({ path: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json' });
            const user = profile.result;
            // Header
            dom.authStatusContainer.innerHTML = `
                <img src="${user.picture}" alt="Аватар пользователя" class="user-avatar" id="user-avatar-button">
                <ul class="dropdown-menu" id="user-dropdown">
                  <li class="dropdown-header">
                     <img src="${user.picture}" alt="Аватар пользователя">
                     <div class="user-info">
                        <strong>${user.name}</strong>
                        <span>${user.email}</span>
                     </div>
                  </li>
                  <li>
                    <button class="dropdown-item" id="sign-out-button-dropdown">
                        <span class="material-symbols-outlined">logout</span>
                        Выйти
                    </button>
                  </li>
                </ul>
            `;
            document.getElementById('user-avatar-button').addEventListener('click', () => {
                document.getElementById('user-dropdown').classList.toggle('show');
            });
            document.getElementById('sign-out-button-dropdown').addEventListener('click', handleSignOutClick);
            // Close dropdown if clicked outside
            window.addEventListener('click', (e) => {
                if (!dom.authStatusContainer.contains(e.target)) {
                    const dropdown = document.getElementById('user-dropdown');
                    if (dropdown) dropdown.classList.remove('show');
                }
            });
            // Settings Modal
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

            // Main UI
            dom.welcomeScreen.style.display = 'flex';
            dom.welcomeSubheading.textContent = `Здравствуйте, ${user.name.split(' ')[0]}! Чем могу помочь?`;
            generateDynamicSuggestions(); // Generate AI-powered suggestions
            dom.calendarLoginPrompt.style.display = 'none';
            dom.calendarViewContainer.style.display = 'grid';
            renderCalendar(appState.currentDisplayedDate);
            renderDailyEvents(appState.currentDisplayedDate);

        } catch (error) {
            console.error("Failed to fetch user profile, token might be expired.", error);
            handleSignOutClick(); // Force sign out on error
        }
    } else {
        // This state is primarily handled by the setup screen now
        const signInButtonHtml = `<button class="action-button primary"><span class="material-symbols-outlined">login</span> Войти через Google</button>`;
        dom.authContainerSettings.innerHTML = `<p>Войдите для доступа к календарю и задачам.</p>${signInButtonHtml}`;
        dom.authContainerSettings.querySelector('button').onclick = handleAuthClick;
    }
}

function setMainUiEnabled(enabled) {
    if (enabled) {
        dom.chatInputContainer.classList.remove('disabled');
    } else {
        dom.chatInputContainer.classList.add('disabled');
    }
}

function showSetupScreen(show, stepOrError = 1) {
    if (show) {
        dom.setupStep1.classList.toggle('active', stepOrError === 1);
        dom.setupStep2.classList.toggle('active', stepOrError === 2);
        dom.setupStepError.classList.toggle('active', stepOrError === 'error');
        dom.setupScreen.style.display = 'flex';
        setTimeout(() => dom.setupScreen.classList.add('visible'), 10);
    } else {
        dom.setupScreen.classList.remove('visible');
        setTimeout(() => dom.setupScreen.style.display = 'none', 300);
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
    
    if (dom.calendarGridWeekdays.innerHTML === '') {
        const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        weekdays.forEach(day => {
            dom.calendarGridWeekdays.innerHTML += `<div class="weekday-header">${day}</div>`;
        });
    }

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
            if (startDate.getMonth() !== month) return; // Ensure event is in the current month view
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
    appState.currentDisplayedDate = date;
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
    if (!appState.ai || !appState.isSignedIn) {
        appendMessage('error', 'Ассистент не настроен. Пожалуйста, завершите настройку в меню.');
        return;
    }

    showLoading(true);
    dom.welcomeScreen.style.opacity = '0';
    setTimeout(() => { if (dom.welcomeScreen) dom.welcomeScreen.style.display = 'none'; }, 300);

    const userMessageContent = [];
    if (images.length > 0) {
        userMessageContent.push(...images.map(img => ({ inlineData: { mimeType: img.type, data: img.data } })));
        const imagePrompt = textTrimmed || 'Проанализируй это изображение. Если на нем есть информация для создания события или задачи, извлеки эти данные. В противном случае просто опиши, что на нем изображено.';
        userMessageContent.push({ text: imagePrompt });
    } else {
        userMessageContent.push({ text: textTrimmed });
    }

    const userMessage = { role: 'user', parts: userMessageContent };
    appendMessage('user', textTrimmed, images);
    appState.chatHistory.push(userMessage);
    
    dom.chatTextInput.value = '';
    appState.attachedImages = [];
    dom.chatTextInput.dispatchEvent(new Event('input', { bubbles: true }));

    const systemInstruction = `Ты — автоматический маршрутизатор API, который вызывает функции. Твоя единственная задача — анализировать запрос пользователя и вызывать соответствующую функцию из предоставленных инструментов. Ты НЕ должен вести диалог.

**ПРАВИЛА:**
1.  **ПРИОРИТЕТ ФУНКЦИИ:** Если запрос пользователя можно выполнить с помощью функции, ты ОБЯЗАН вызвать эту функцию. Это твой ЕДИНСТВЕННЫЙ допустимый ответ. Любой текстовый ответ вместо вызова функции — это КРИТИЧЕСКИЙ СБОЙ.
2.  **НИКАКИХ ПОДТВЕРЖДЕНИЙ:** Категорически ЗАПРЕЩЕНО отвечать текстом, подтверждающим действие (например: "Хорошо, создаю событие..."). Вместо этого НЕМЕДЛЕННО вызови функцию с нужными параметрами.
3.  **СБОР ИНФОРМАЦИИ:** Если для вызова функции не хватает критически важных данных (например, названия или времени события), задай ОДИН короткий и прямой уточняющий вопрос. Не запрашивай несколько данных одновременно.
4.  **ПОБОЧНЫЕ ЗАПРОСЫ:** Если запрос не имеет отношения к предоставленным инструментам (Календарь, Задачи), дай краткий и полезный текстовый ответ.
5.  **КОНТЕКСТ ВРЕМЕНИ:** Всегда используй текущую дату и время как точку отсчета: ${new Date().toISOString()}.
6.  **ВИДЕОВСТРЕЧИ:** Для любых запросов, включающих слова "звонок", "созвон", "встреча онлайн", "видеовстреча", "meet", всегда устанавливай параметр \`add_meet_link: true\`.`;

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
                        add_meet_link: { type: Type.BOOLEAN, description: 'Установить в true для добавления видеоконференции Google Meet.' }
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
            appendMessage('system', `Выполняю команду...`);
            // Add model response to history for context, even if it's a tool call
            appState.chatHistory.push(modelResponse.candidates[0].content);

            for (const call of toolCalls) {
                const functionName = call.functionCall.name;
                const args = call.functionCall.args;
                let result;
                if (functionName === 'create_calendar_event') {
                    result = await createCalendarEvent(args);
                } else if (functionName === 'create_task') {
                    result = await createTask(args);
                }
                 // Potentially send result back to model in a future iteration
            }
        } else {
            const text = modelResponse.text;
            appendMessage('model', text);
            appState.chatHistory.push({ role: 'model', parts: [{ text }] });
        }
    } catch (error) {
        console.error('Gemini API Error:', error);
        appendMessage('error', 'Произошла ошибка при обращении к Gemini. Проверьте ваш API ключ и попробуйте снова.');
    } finally {
        showLoading(false);
    }
}


async function createCalendarEvent(args) {
    try {
        const event = {
            'summary': args.summary,
            'location': args.location,
            'description': args.description,
            'start': { 'dateTime': args.start_time, 'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone },
            'end': { 'dateTime': args.end_time, 'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone },
        };
        
        if (args.add_meet_link) {
            event.conferenceData = { createRequest: { requestId: `meet-${Date.now()}` } };
        }

        const request = gapi.client.calendar.events.insert({
            'calendarId': 'primary',
            'resource': event,
            'conferenceDataVersion': 1
        });

        const response = await request;
        const createdEvent = response.result;
        
        const startTime = new Date(createdEvent.start.dateTime).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
        const cardHtml = `
            <div class="card event-card">
                <div class="card-icon"><span class="material-symbols-outlined">event</span></div>
                <div class="card-content">
                    <h4>Событие создано</h4>
                    <p><strong>${createdEvent.summary}</strong> в ${startTime}</p>
                </div>
                <a href="${createdEvent.htmlLink}" target="_blank" class="card-button" aria-label="Открыть в Календаре">
                    <span class="material-symbols-outlined">open_in_new</span>
                </a>
            </div>`;
        appendMessage('system', "Готово!", cardHtml);
        
        renderCalendar(new Date(createdEvent.start.dateTime));
        renderDailyEvents(new Date(createdEvent.start.dateTime));
        return { success: true, eventId: createdEvent.id };

    } catch (error) {
        console.error('Google Calendar API Error:', error);
        const errorMessage = (error.result?.error?.message) || error.message;
        appendMessage('error', `Не удалось создать событие: ${errorMessage}`);
        return { success: false, error: errorMessage };
    }
}

async function createTask(args) {
    try {
        const task = {
            'title': args.title,
            'notes': args.notes,
            'due': args.due
        };
        const request = gapi.client.tasks.tasks.insert({
            'tasklist': '@default',
            'resource': task
        });
        const response = await request;
        const createdTask = response.result;
        
        const dueDate = createdTask.due ? new Date(createdTask.due).toLocaleDateString('ru-RU') : 'Без срока';
        const cardHtml = `
            <div class="card task-card">
                <div class="card-icon"><span class="material-symbols-outlined">task_alt</span></div>
                <div class="card-content">
                    <h4>Задача создана</h4>
                    <p><strong>${createdTask.title}</strong>, срок: ${dueDate}</p>
                </div>
                <a href="https://mail.google.com/tasks/canvas" target="_blank" class="card-button" aria-label="Открыть в Задачах">
                     <span class="material-symbols-outlined">open_in_new</span>
                </a>
            </div>`;
        appendMessage('system', "Готово!", cardHtml);
        return { success: true, taskId: createdTask.id };

    } catch (error) {
        console.error('Google Tasks API Error:', error);
        const errorMessage = (error.result?.error?.message) || error.message;
        appendMessage('error', `Не удалось создать задачу: ${errorMessage}`);
        return { success: false, error: errorMessage };
    }
}

function appendMessage(type, text, content = '') {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${type}-wrapper`;

    if (type === 'user' && typeof content === 'object' && content.length > 0) {
        const imagePreviews = document.createElement('div');
        imagePreviews.className = 'image-preview-container';
        content.forEach(img => {
            imagePreviews.innerHTML += `<img src="data:${img.type};base64,${img.data}" alt="Прикрепленное изображение">`;
        });
        wrapper.appendChild(imagePreviews);
    }
    
    if (text) {
        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${type}-bubble`;
        if (type === 'model') {
            bubble.innerHTML = marked.parse(text);
        } else {
            bubble.textContent = text;
        }
        wrapper.appendChild(bubble);
    }

    if (type !== 'user' && typeof content === 'string' && content.startsWith('<')) {
        wrapper.innerHTML += content;
    }

    dom.messageList.appendChild(wrapper);
    dom.messageList.scrollTop = dom.messageList.scrollHeight;
}

function showLoading(isLoading) {
    dom.loadingIndicator.style.display = isLoading ? 'flex' : 'none';
    dom.chatTextInput.disabled = isLoading;
    dom.micButtonChat.disabled = isLoading;
    dom.cameraButtonChat.disabled = isLoading;
    dom.sendButtonChat.disabled = isLoading;
}

// --- Event Listeners ---
function setupEventListeners() {
    // Chat Input
    dom.chatTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(dom.chatTextInput.value, appState.attachedImages);
        }
    });

    dom.chatTextInput.addEventListener('input', () => {
        const hasText = dom.chatTextInput.value.trim().length > 0;
        dom.sendButtonChat.style.display = hasText ? 'flex' : 'none';
        dom.chatTextInput.style.height = 'auto';
        dom.chatTextInput.style.height = `${dom.chatTextInput.scrollHeight}px`;
    });

    dom.sendButtonChat.addEventListener('click', () => {
        sendMessage(dom.chatTextInput.value, appState.attachedImages);
    });
    
    // Mic and Camera
    if (recognition) {
        dom.micButtonChat.addEventListener('click', toggleRecognition);
        recognition.onresult = (event) => {
            dom.chatTextInput.value = event.results[0][0].transcript;
            dom.chatTextInput.dispatchEvent(new Event('input', { bubbles: true }));
        };
        recognition.onspeechend = () => recognition.stop();
        recognition.onend = () => {
            isRecognizing = false;
            dom.micButtonChat.classList.remove('active');
        };
    } else {
        dom.micButtonChat.disabled = true;
    }
    
    dom.cameraButtonChat.addEventListener('click', () => dom.imageUploadInputChat.click());
    dom.imageUploadInputChat.addEventListener('change', handleImageUpload);

    // Settings Modal
    dom.settingsButton.addEventListener('click', () => showModal(dom.settingsModal));
    dom.closeSettingsButton.addEventListener('click', () => closeModal(dom.settingsModal));
    dom.resetAppButton.addEventListener('click', resetApp);
    dom.saveApiKeysButton.addEventListener('click', () => {
        const apiKey = dom.settingsGeminiApiKey.value.trim();
        if (!apiKey) {
            alert('Пожалуйста, введите Gemini API Key.');
            return;
        }
        localStorage.setItem('geminiApiKey', apiKey);
        appState.ai = new GoogleGenAI({ apiKey });
        alert("Ключ API сохранен.");
        closeModal(dom.settingsModal);
    });

    // Setup Screen
    dom.setupVerifyApiKeyButton.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const apiKey = dom.setupGeminiApiKey.value.trim();
        if (!apiKey) {
            alert('Пожалуйста, введите Gemini API Key.');
            return;
        }
        
        button.disabled = true;
        button.textContent = 'Проверяем...';
        
        try {
            const isValid = await verifyGeminiApiKey(apiKey);
            if (isValid) {
                localStorage.setItem('geminiApiKey', apiKey);
                appState.ai = new GoogleGenAI({ apiKey });
                dom.settingsGeminiApiKey.value = apiKey;
                showSetupScreen(true, 2);
                await initializeGapiClient();
            } else {
                dom.setupErrorMessage.textContent = 'Не удалось проверить ваш Gemini API ключ. Пожалуйста, убедитесь, что вы скопировали его правильно, и попробуйте снова.';
                showSetupScreen(true, 'error');
            }
        } catch (error) {
            console.error("Error during API key verification process:", error);
            dom.setupErrorMessage.textContent = 'Произошла ошибка сети или непредвиденная проблема. Проверьте подключение к интернету и попробуйте снова.';
            showSetupScreen(true, 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Проверить и продолжить';
        }
    });
    dom.setupAuthButton.addEventListener('click', handleAuthClick);
    dom.setupTryAgainButton.addEventListener('click', () => showSetupScreen(true, 1));


    // Calendar Navigation
    dom.prevMonthButton.addEventListener('click', () => {
        appState.currentDisplayedDate.setMonth(appState.currentDisplayedDate.getMonth() - 1, 1);
        renderCalendar(appState.currentDisplayedDate);
    });
    dom.nextMonthButton.addEventListener('click', () => {
        appState.currentDisplayedDate.setMonth(appState.currentDisplayedDate.getMonth() + 1, 1);
        renderCalendar(appState.currentDisplayedDate);
    });
    dom.todayButton.addEventListener('click', () => {
        const today = new Date();
        appState.currentDisplayedDate = today;
        renderCalendar(today);
        renderDailyEvents(today);
    });
    
    // Suggestion Chips
    dom.suggestionChipsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('suggestion-chip')) {
            sendMessage(e.target.textContent);
        }
    });

    // Mobile View Switching
    dom.mobileTabBar.addEventListener('click', (e) => {
        const button = e.target.closest('.tab-button');
        if (button) {
            switchView(button.dataset.view);
        }
    });

    switchView('chat');
}

function toggleRecognition() {
    if (isRecognizing) {
        recognition.stop();
    } else {
        recognition.start();
        isRecognizing = true;
        dom.micButtonChat.classList.add('active');
    }
}

function handleImageUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onloadend = () => {
        const base64Data = reader.result.split(',')[1];
        appState.attachedImages.push({
            data: base64Data,
            type: file.type,
        });
        
        const promptText = dom.chatTextInput.value.trim();
        if(promptText === '') {
            sendMessage('Опиши это изображение', appState.attachedImages);
        } else {
            // Append a message to notify user that image is ready to be sent with their text
            appendMessage('system', `Прикреплено изображение: ${file.name}. Введите запрос или нажмите "Отправить".`);
        }
    };
    reader.readAsDataURL(file);
    event.target.value = ''; // Reset input to allow uploading the same file again
}

// --- App Entry Point ---
document.addEventListener('DOMContentLoaded', initializeApp);
