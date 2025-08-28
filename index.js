/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import { marked } from 'marked';

// --- Configuration ---
const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/contacts.readonly";

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
    chatInputContainer: document.querySelector('.chat-input-container'),
    // Header
    authStatusContainer: document.getElementById('auth-status-container'),
    settingsButton: document.getElementById('settings-button'),
    // Chat
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
    // Settings Modal
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsButton: document.getElementById('close-settings-button'),
    saveSettingsButton: document.getElementById('save-settings-button'),
    resetAppButton: document.getElementById('reset-app-button'),
    settingsGeminiApiKey: document.getElementById('settings-gemini-api-key'),
    settingsGoogleClientId: document.getElementById('settings-google-client-id'),
    authContainerSettings: document.getElementById('auth-container-settings'),
    // Instructions Modal
    instructionsModal: document.getElementById('instructions-modal'),
    showApiClientIdInstructions: document.getElementById('show-client-id-instructions'),
    showApiKeyInstructions: document.getElementById('show-api-key-instructions'),
    closeInstructionsButton: document.getElementById('close-instructions-button'),
    clientIdInstructionsContent: document.getElementById('client-id-instructions-content'),
    apiKeyInstructionsContent: document.getElementById('api-key-instructions-content'),
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
const gapiReady = new Promise(resolve => {
    if (window.gapiLoaded) resolve(true);
    else window.gapiLoadCallback = resolve;
});
const gisReady = new Promise(resolve => {
    if (window.gisLoaded) resolve(true);
    else window.gisLoadCallback = resolve;
});

// --- Initialization ---
async function initializeApp() {
    setupEventListeners();

    const geminiApiKey = localStorage.getItem('geminiApiKey');
    const googleClientId = localStorage.getItem('googleClientId');

    if (geminiApiKey) dom.settingsGeminiApiKey.value = geminiApiKey;
    if (googleClientId) dom.settingsGoogleClientId.value = googleClientId;

    if (!geminiApiKey || !googleClientId) {
        setMainUiEnabled(false);
        showModal(dom.settingsModal);
    } else {
        try {
            appState.ai = new GoogleGenAI({ apiKey: geminiApiKey });
            setMainUiEnabled(true);
            await initializeGoogleServices();
        } catch (error) {
            console.error("Failed to initialize Gemini AI:", error);
            appendMessage('error', "Не удалось инициализировать Gemini. Проверьте ваш API ключ.");
            setMainUiEnabled(false);
            showModal(dom.settingsModal);
        }
    }
    
    // Initial UI state before we know if signed in
    updateUiForAuthState(false); 
}

async function initializeGoogleServices() {
    if (appState.gapiInited && appState.gisInited) return;

    const googleClientId = localStorage.getItem('googleClientId');
    if (!googleClientId) {
        console.warn("Google Client ID не найден. Пожалуйста, укажите его в настройках, чтобы включить интеграцию с Google.");
        return;
    }

    try {
        await gapiReady;
        await new Promise((resolve, reject) => gapi.load('client', { callback: resolve, onerror: reject }));
        await gapi.client.init({
            discoveryDocs: [
                "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
                "https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest",
                "https://people.googleapis.com/$discovery/rest?version=v1"
            ]
        });
        appState.gapiInited = true;

        await gisReady;
        appState.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: googleClientId,
            scope: SCOPES,
            callback: handleTokenResponse,
        });
        appState.gisInited = true;
    } catch (error) {
        console.error("Google API initialization error:", error);
        appendMessage('error', "Не удалось инициализировать сервисы Google. Проверьте ваш Client ID и настройки в Google Cloud Console.");
    }
}

// --- App Reset ---
function resetApp() {
    const isConfirmed = confirm("Вы уверены, что хотите сбросить все настройки? Ключи API и история чата будут удалены. Страница будет перезагружена.");
    if (isConfirmed) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
    }
}

// --- Authentication & UI Updates ---
function handleAuthClick() {
    if (!localStorage.getItem('googleClientId')) {
        alert("Пожалуйста, укажите ваш Google Client ID в настройках.");
        showModal(dom.settingsModal);
        return;
    }
    if (!appState.gisInited || !appState.tokenClient) {
        alert("Клиент авторизации Google еще не инициализирован. Пожалуйста, подождите или проверьте настройки Client ID.");
        initializeGoogleServices(); 
        return;
    }
    appState.tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleSignOutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken(null);
            updateUiForAuthState(false);
        });
    } else {
        updateUiForAuthState(false);
    }
    appState.chatHistory = [];
    dom.messageList.innerHTML = '';
}

async function handleTokenResponse(response) {
    if (response.error) {
        console.error('Google token error:', response);
        appendMessage('error', `Ошибка авторизации: ${response.error_description || 'Попробуйте еще раз.'}`);
        await updateUiForAuthState(false);
        return;
    }
    gapi.client.setToken(response);
    await updateUiForAuthState(true);
}

async function updateUiForAuthState(isSignedIn) {
    appState.isSignedIn = isSignedIn;
    dom.authStatusContainer.innerHTML = '';
    dom.authContainerSettings.innerHTML = '';

    if (isSignedIn) {
        try {
            const profile = await gapi.client.request({ path: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json' });
            const user = profile.result;

            // Header Dropdown
            dom.authStatusContainer.innerHTML = `
                <img src="${user.picture}" alt="Аватар пользователя" class="user-avatar" id="user-avatar-button">
                <ul class="dropdown-menu" id="user-dropdown">
                  <li class="dropdown-header">
                     <img src="${user.picture}" alt="Аватар пользователя">
                     <div class="user-info"><strong>${user.name}</strong><span>${user.email}</span></div>
                  </li>
                  <li><button class="dropdown-item" id="sign-out-dropdown"><span class="material-symbols-outlined">logout</span>Выйти</button></li>
                </ul>`;
            document.getElementById('user-avatar-button').onclick = () => document.getElementById('user-dropdown')?.classList.toggle('show');
            document.getElementById('sign-out-dropdown').onclick = handleSignOutClick;
            window.addEventListener('click', (e) => {
                if (!dom.authStatusContainer.contains(e.target)) {
                    document.getElementById('user-dropdown')?.classList.remove('show');
                }
            });

            // Settings Modal
            dom.authContainerSettings.innerHTML = `
                <div class="settings-user-info">
                    <img src="${user.picture}" alt="Аватар пользователя"><div class="settings-user-info-text"><strong>${user.name}</strong><small>${user.email}</small></div>
                </div>
                <button id="sign-out-settings" class="action-button">Выйти</button>`;
            document.getElementById('sign-out-settings').onclick = handleSignOutClick;

            // Main UI
            dom.welcomeScreen.style.display = 'flex';
            dom.welcomeSubheading.textContent = `Здравствуйте, ${user.name.split(' ')[0]}! Чем могу помочь?`;
            generateDynamicSuggestions();
            dom.calendarLoginPrompt.style.display = 'none';
            dom.calendarViewContainer.style.display = 'grid';
            renderCalendar(appState.currentDisplayedDate);
            renderDailyEvents(appState.currentDisplayedDate);

        } catch (error) {
            console.error("Failed to fetch user profile, token might be expired.", error);
            handleSignOutClick(); // Force sign out on error
        }
    } else {
        const signInButtonHtml = `<button id="auth-button" class="action-button primary"><span class="material-symbols-outlined">login</span> Войти через Google</button>`;
        dom.authStatusContainer.innerHTML = signInButtonHtml;
        dom.authContainerSettings.innerHTML = `<p>Войдите для доступа к календарю и задачам.</p>${signInButtonHtml.replace('id="auth-button"', 'id="auth-button-settings"')}`;
        document.getElementById('auth-button').onclick = handleAuthClick;
        document.getElementById('auth-button-settings').onclick = handleAuthClick;

        dom.welcomeScreen.style.display = 'none';
        dom.calendarLoginPrompt.style.display = 'flex';
        dom.calendarViewContainer.style.display = 'none';
    }
}

// --- UI Interaction ---
function setMainUiEnabled(enabled) {
    dom.chatInputContainer.classList.toggle('disabled', !enabled);
}

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
        ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(day => {
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
        cell.textContent = day.toString();
        cell.dataset.day = day.toString();

        const today = new Date();
        if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
            cell.classList.add('today');
        }
        
        const selectedDate = new Date(dom.dailyEventsHeader.dataset.date || today);
        if (day === selectedDate.getDate() && month === selectedDate.getMonth() && year === selectedDate.getFullYear()) {
            cell.classList.add('selected');
        }

        cell.onclick = () => {
            dom.calendarGridDays.querySelector('.selected')?.classList.remove('selected');
            cell.classList.add('selected');
            renderDailyEvents(new Date(year, month, day));
        };
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
        response.result.items.forEach((event) => {
            const startDate = new Date(event.start.dateTime || event.start.date);
            if (startDate.getMonth() !== month) return;
            const dayOfMonth = startDate.getDate();
            const cell = dom.calendarGridDays.querySelector(`[data-day="${dayOfMonth}"]`);
            if (cell && !cell.querySelector('.event-dot')) {
                cell.innerHTML += `<div class="event-dot"></div>`;
            }
        });
    } catch (err) { console.error("Error loading calendar events:", err); }
}

async function renderDailyEvents(date) {
    appState.currentDisplayedDate = date;
    dom.dailyEventsHeader.textContent = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    dom.dailyEventsHeader.dataset.date = date.toISOString();
    dom.dailyEventsList.innerHTML = '<li>Загрузка...</li>';

    if (!appState.isSignedIn) {
        dom.dailyEventsList.innerHTML = ''; return;
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
            response.result.items.forEach((event) => dom.dailyEventsList.appendChild(createEventElement(event)));
        }
    } catch (err) {
        console.error("Error fetching daily events:", err);
        dom.dailyEventsList.innerHTML = '<li>Не удалось загрузить события.</li>';
    }
}

function createEventElement(event) {
    const li = document.createElement('li');
    li.className = 'event-item';
    const startTime = (event.start.dateTime) ? new Date(event.start.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Весь день';
    li.innerHTML = `
        <div class="event-color-indicator"></div>
        <div class="event-details">
            <h4 class="event-item-title">${event.summary || '(Без названия)'}</h4>
            <div class="event-item-time"><span class="material-symbols-outlined">schedule</span><span>${startTime}</span></div>
            ${event.location ? `<div class="event-item-location"><span class="material-symbols-outlined">location_on</span><span>${event.location}</span></div>` : ''}
        </div>`;
    return li;
}

// --- Chat & Gemini ---
async function generateDynamicSuggestions() {
    if (!appState.ai) return;
    try {
        const prompt = `Создай 3 коротких, разнообразных примера-запроса для ассистента-календаря на русском языке. Ответ дай в виде JSON-массива строк. Включи запросы на поиск и создание. Пример: ["Какие у меня планы на завтра?", "Создай встречу с Анной в пятницу в 10 утра", "Найди все встречи по проекту 'Альфа'"]`;
        const response = await appState.ai.models.generateContent({
            model: "gemini-2.5-flash", contents: prompt, config: { responseMimeType: "application/json" }
        });
        const suggestions = JSON.parse(response.text.trim());
        dom.suggestionChipsContainer.innerHTML = '';
        suggestions.forEach((text) => {
            const button = document.createElement('button');
            button.className = 'suggestion-chip';
            button.textContent = text;
            dom.suggestionChipsContainer.appendChild(button);
        });
    } catch (error) {
        console.error("Failed to generate suggestions:", error);
        dom.suggestionChipsContainer.innerHTML = `
            <button class="suggestion-chip">Создать встречу на завтра в 10 утра</button>
            <button class="suggestion-chip">Какие у меня планы на пятницу?</button>
            <button class="suggestion-chip">Напомни мне позвонить в сервис в 15:00</button>`;
    }
}

async function sendMessage(text, images = []) {
    if (!text.trim() && images.length === 0) return;
    if (!appState.ai) {
        appendMessage('error', 'Ассистент не настроен. Пожалуйста, введите API ключ в настройках.');
        showModal(dom.settingsModal); return;
    }
    if (!appState.isSignedIn) {
        appendMessage('error', 'Пожалуйста, войдите в аккаунт Google, чтобы использовать эту функцию.'); return;
    }

    showLoading(true);
    dom.welcomeScreen.style.opacity = '0';
    setTimeout(() => { if (dom.welcomeScreen) dom.welcomeScreen.style.display = 'none'; }, 300);

    const userMessageContent = [];
    if (images.length > 0) {
        userMessageContent.push(...images.map(img => ({ inlineData: { mimeType: img.type, data: img.data } })));
        const imagePrompt = text.trim() || 'Опиши это изображение и извлеки любую информацию, полезную для календаря или задач.';
        userMessageContent.push({ text: imagePrompt });
    } else {
        userMessageContent.push({ text: text.trim() });
    }

    appendMessage('user', text.trim(), images);
    appState.chatHistory.push({ role: 'user', parts: userMessageContent });
    dom.chatTextInput.value = '';
    appState.attachedImages = [];
    dom.chatTextInput.dispatchEvent(new Event('input', { bubbles: true }));

    const systemInstruction = `Ты — высокоинтеллектуальный ассистент по управлению Google Workspace. Твоя задача — точно и эффективно вызывать функции API в ответ на запросы пользователя.
- **ПРАВИЛА:**
- **ВСЕГДА ИСПОЛЬЗУЙ ФУНКЦИИ:** Если запрос можно выполнить с помощью функции, ты ОБЯЗАН вызвать ее. Не отвечай текстом, если можешь действовать.
- **МНОГОШАГОВЫЕ ДЕЙСТВИЯ:** Если для выполнения запроса (например, "добавить Ивана на встречу") нужно сначала найти контакт, а потом обновить событие, вызывай функции последовательно.
- **УТОЧНЕНИЕ:** Если не хватает критически важных данных (названия, времени), задай ОДИН короткий уточняющий вопрос.
- **КОНТЕКСТ ВРЕМЕНИ:** Текущая дата: ${new Date().toISOString()}.
- **ВИДЕОВСТРЕЧИ:** Для "звонок", "созвон", "meet", "онлайн" всегда устанавливай \`add_meet_link: true\`.
- **ОБНОВЛЕНИЕ:** Для обновления события используй event_id и передавай только изменяемые поля.`;

    const tools = [{ functionDeclarations: [
        { name: 'create_calendar_event', description: 'Создает событие в Google Календаре.',
            parameters: { type: Type.OBJECT, properties: {
                summary: { type: Type.STRING, description: 'Название события.' },
                description: { type: Type.STRING, description: 'Описание события.' },
                start_time: { type: Type.STRING, description: 'Время начала в формате ISO 8601.' },
                end_time: { type: Type.STRING, description: 'Время окончания в формате ISO 8601.' },
                location: { type: Type.STRING, description: 'Место проведения.' },
                attendees: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Массив email-адресов участников.' },
                add_meet_link: { type: Type.BOOLEAN, description: 'Добавить ссылку Google Meet.' }
            }, required: ['summary', 'start_time', 'end_time'] }
        },
        { name: 'find_events', description: 'Ищет события в календаре по дате или ключевому слову.',
            parameters: { type: Type.OBJECT, properties: {
                time_min: { type: Type.STRING, description: 'Начало периода поиска в ISO 8601.' },
                time_max: { type: Type.STRING, description: 'Конец периода поиска в ISO 8601.' },
                query: { type: Type.STRING, description: 'Ключевые слова для поиска в названии или описании.' }
            }, required: [] }
        },
        { name: 'update_calendar_event', description: 'Обновляет существующее событие в календаре.',
            parameters: { type: Type.OBJECT, properties: {
                event_id: { type: Type.STRING, description: 'ID события для обновления.' },
                summary: { type: Type.STRING, description: 'Новое название события.' },
                start_time: { type: Type.STRING, description: 'Новое время начала в ISO 8601.' },
                end_time: { type: Type.STRING, description: 'Новое время окончания в ISO 8601.' },
                location: { type: Type.STRING, description: 'Новое место проведения.' },
                attendees_to_add: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Массив email-адресов для добавления.' },
            }, required: ['event_id'] }
        },
        { name: 'delete_calendar_event', description: 'Удаляет событие из календаря.',
            parameters: { type: Type.OBJECT, properties: {
                event_id: { type: Type.STRING, description: 'ID события для удаления.' }
            }, required: ['event_id'] }
        },
        { name: 'create_task', description: 'Создает задачу в Google Задачах.',
            parameters: { type: Type.OBJECT, properties: {
                title: { type: Type.STRING, description: 'Название задачи.' },
                notes: { type: Type.STRING, description: 'Описание задачи.' },
                due: { type: Type.STRING, description: 'Срок выполнения в формате ISO 8601 (только дата).' }
            }, required: ['title'] }
        },
        { name: 'find_contacts', description: 'Ищет контакты по имени для добавления в события.',
             parameters: { type: Type.OBJECT, properties: {
                name_query: { type: Type.STRING, description: 'Имя или часть имени для поиска.' }
            }, required: ['name_query'] }
        }
    ] }];

    try {
        const response = await appState.ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [...appState.chatHistory],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            tools: tools,
        });

        const modelResponsePart = response.candidates[0].content.parts[0];
        if (modelResponsePart.functionCall) {
            appendMessage('system', `Выполняю команду...`);
            appState.chatHistory.push(response.candidates[0].content);
            const { name, args } = modelResponsePart.functionCall;
            let result;
            // TODO: Handle multiple function calls in one response if the API supports it
            if (name === 'create_calendar_event') result = await createCalendarEvent(args);
            else if (name === 'create_task') result = await createTask(args);
            else if (name === 'find_events') result = await findEvents(args);
            else if (name === 'update_calendar_event') result = await updateCalendarEvent(args);
            else if (name === 'delete_calendar_event') result = await deleteCalendarEvent(args);
            else if (name === 'find_contacts') result = await findContacts(args);
            // TODO: Send result back to model for summary
        } else {
            const text = response.text;
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

// --- API Function Implementations ---

async function createCalendarEvent(args) {
    try {
        const event = {
            'summary': args.summary, 'location': args.location, 'description': args.description,
            'start': { 'dateTime': args.start_time, 'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone },
            'end': { 'dateTime': args.end_time, 'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone },
        };
        if (args.attendees && args.attendees.length > 0) {
            event.attendees = args.attendees.map(email => ({ email }));
        }
        if (args.add_meet_link) {
            event.conferenceData = { createRequest: { requestId: `meet-${Date.now()}` } };
        }
        const request = gapi.client.calendar.events.insert({ 'calendarId': 'primary', 'resource': event, 'conferenceDataVersion': 1 });
        const response = await request;
        const createdEvent = response.result;
        const startTime = new Date(createdEvent.start.dateTime).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
        const cardHtml = `<div class="card event-card" data-event-id="${createdEvent.id}">
            <div class="card-icon"><span class="material-symbols-outlined">event</span></div>
            <div class="card-content"><h4>Событие создано</h4><p><strong>${createdEvent.summary}</strong> в ${startTime}</p></div>
            <div class="card-actions">
              <button class="icon-button card-action-button" data-action="edit" aria-label="Изменить"><span class="material-symbols-outlined">edit</span></button>
              <button class="icon-button card-action-button" data-action="delete" aria-label="Удалить"><span class="material-symbols-outlined">delete</span></button>
              <a href="${createdEvent.htmlLink}" target="_blank" class="icon-button" aria-label="Открыть в Календаре"><span class="material-symbols-outlined">open_in_new</span></a>
            </div>
          </div>`;
        appendMessage('system', "Готово!", cardHtml);
        renderCalendar(new Date(createdEvent.start.dateTime));
        renderDailyEvents(new Date(createdEvent.start.dateTime));
    } catch (error) {
        console.error('Google Calendar API Error:', error);
        appendMessage('error', `Не удалось создать событие: ${(error.result?.error?.message) || error.message}`);
    }
}

async function createTask(args) {
    try {
        const task = { 'title': args.title, 'notes': args.notes, 'due': args.due };
        const request = gapi.client.tasks.tasks.insert({ 'tasklist': '@default', 'resource': task });
        const response = await request;
        const createdTask = response.result;
        const dueDate = createdTask.due ? new Date(createdTask.due).toLocaleDateString('ru-RU') : 'Без срока';
        const cardHtml = `<div class="card task-card" data-task-id="${createdTask.id}">
            <div class="card-icon"><span class="material-symbols-outlined">task_alt</span></div>
            <div class="card-content"><h4>Задача создана</h4><p><strong>${createdTask.title}</strong>, срок: ${dueDate}</p></div>
            <a href="https://mail.google.com/tasks/canvas" target="_blank" class="icon-button" aria-label="Открыть в Задачах"><span class="material-symbols-outlined">open_in_new</span></a></div>`;
        appendMessage('system', "Готово!", cardHtml);
    } catch (error) {
        console.error('Google Tasks API Error:', error);
        appendMessage('error', `Не удалось создать задачу: ${(error.result?.error?.message) || error.message}`);
    }
}

async function findEvents(args) {
    try {
        const response = await gapi.client.calendar.events.list({
            'calendarId': 'primary',
            'timeMin': args.time_min || (new Date()).toISOString(),
            'timeMax': args.time_max,
            'q': args.query,
            'showDeleted': false,
            'singleEvents': true,
            'maxResults': 10,
            'orderBy': 'startTime'
        });
        const events = response.result.items;
        if (events.length === 0) {
            appendMessage('model', 'По вашему запросу ничего не найдено.');
        } else {
            let resultText = 'Вот что я нашел:\n';
            events.forEach(event => {
                const start = new Date(event.start.dateTime || event.start.date).toLocaleString('ru-RU');
                resultText += `- **${event.summary}** в ${start}\n`;
            });
            appendMessage('model', resultText);
        }
    } catch (error) {
        console.error('Find Events Error:', error);
        appendMessage('error', `Ошибка при поиске событий: ${error.message}`);
    }
}

async function updateCalendarEvent(args) {
    try {
        // First, get the existing event to patch it correctly
        const existingEventResponse = await gapi.client.calendar.events.get({
            calendarId: 'primary',
            eventId: args.event_id,
        });
        const eventToUpdate = existingEventResponse.result;

        // Apply updates
        if (args.summary) eventToUpdate.summary = args.summary;
        if (args.start_time) eventToUpdate.start.dateTime = args.start_time;
        if (args.end_time) eventToUpdate.end.dateTime = args.end_time;
        if (args.location) eventToUpdate.location = args.location;
        if (args.attendees_to_add) {
            eventToUpdate.attendees = (eventToUpdate.attendees || []).concat(args.attendees_to_add.map(email => ({ email })));
        }
        
        const response = await gapi.client.calendar.events.update({
            'calendarId': 'primary',
            'eventId': args.event_id,
            'resource': eventToUpdate
        });
        appendMessage('system', `Событие "${response.result.summary}" успешно обновлено.`);
        renderCalendar(new Date(response.result.start.dateTime));
        renderDailyEvents(new Date(response.result.start.dateTime));
    } catch (error) {
        console.error('Update Event Error:', error);
        appendMessage('error', `Не удалось обновить событие: ${error.message}`);
    }
}


async function deleteCalendarEvent(args) {
    try {
        await gapi.client.calendar.events.delete({
            'calendarId': 'primary',
            'eventId': args.event_id
        });
        appendMessage('system', 'Событие успешно удалено.');
        const cardToRemove = dom.messageList.querySelector(`[data-event-id="${args.event_id}"]`);
        if(cardToRemove) cardToRemove.style.opacity = '0.5';
        renderCalendar(appState.currentDisplayedDate);
        renderDailyEvents(appState.currentDisplayedDate);
    } catch (error) {
        console.error('Delete Event Error:', error);
        appendMessage('error', `Не удалось удалить событие: ${error.message}`);
    }
}


async function findContacts(args) {
    try {
        const response = await gapi.client.people.people.searchContacts({
            query: args.name_query,
            readMask: 'names,emailAddresses',
            pageSize: 5
        });
        const contacts = response.result.results;
        if (!contacts || contacts.length === 0) {
            appendMessage('model', `Контакт с именем "${args.name_query}" не найден.`);
            return;
        }
        // For simplicity, let's just show the found contacts for now
        // A real implementation would send this back to the model to ask the user which one to use
        let resultText = `Я нашел несколько контактов. Кого вы имели в виду?\n`;
        contacts.forEach(result => {
             const person = result.person;
             const name = person.names?.[0]?.displayName || 'Без имени';
             const email = person.emailAddresses?.[0]?.value || 'Нет email';
             resultText += `- ${name} (${email})\n`;
        });
        appendMessage('model', resultText);
    } catch (error) {
        console.error('Find Contacts Error:', error);
        appendMessage('error', `Ошибка при поиске контактов: ${error.message}`);
    }
}


function appendMessage(type, text, content = '') {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${type}-wrapper`;
    let messageHtml = '';
    if (type === 'user' && Array.isArray(content) && content.length > 0) {
        messageHtml += `<div class="image-preview-container">`;
        content.forEach(img => {
            messageHtml += `<img src="data:${img.type};base64,${img.data}" alt="Прикрепленное изображение">`;
        });
        messageHtml += `</div>`;
    }
    if (text) {
        const bubbleContent = type === 'model' ? marked.parse(text) : text;
        messageHtml += `<div class="message-bubble ${type}-bubble">${bubbleContent}</div>`;
    }
    if (type !== 'user' && typeof content === 'string' && content.startsWith('<')) {
        messageHtml += content;
    }
    wrapper.innerHTML = messageHtml;
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
    dom.chatTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(dom.chatTextInput.value, appState.attachedImages);
        }
    });
    dom.chatTextInput.addEventListener('input', () => {
        dom.sendButtonChat.style.display = dom.chatTextInput.value.trim().length > 0 ? 'flex' : 'none';
        dom.chatTextInput.style.height = 'auto';
        dom.chatTextInput.style.height = `${dom.chatTextInput.scrollHeight}px`;
    });
    dom.sendButtonChat.onclick = () => sendMessage(dom.chatTextInput.value, appState.attachedImages);

    if (recognition) {
        dom.micButtonChat.onclick = () => {
            if (isRecognizing) { recognition.stop(); } 
            else { recognition.start(); isRecognizing = true; dom.micButtonChat.classList.add('active'); }
        };
        recognition.onresult = (event) => { dom.chatTextInput.value = event.results[0][0].transcript; dom.chatTextInput.dispatchEvent(new Event('input')); };
        recognition.onend = () => { isRecognizing = false; dom.micButtonChat.classList.remove('active'); };
    } else { 
        dom.micButtonChat.disabled = true; 
    }

    dom.cameraButtonChat.onclick = () => dom.imageUploadInputChat.click();
    dom.imageUploadInputChat.onchange = (event) => {
        const target = event.target;
        const file = target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                const base64Data = reader.result.split(',')[1];
                appState.attachedImages.push({ data: base64Data, type: file.type });
                appendMessage('system', `Прикреплено изображение: ${file.name}. Введите запрос или нажмите "Отправить".`);
            }
        };
        reader.readAsDataURL(file);
        target.value = '';
    };

    dom.settingsButton.onclick = () => showModal(dom.settingsModal);
    dom.closeSettingsButton.onclick = () => {
        if (localStorage.getItem('geminiApiKey') && localStorage.getItem('googleClientId')) {
            closeModal(dom.settingsModal);
        } else {
            alert("Пожалуйста, введите Gemini API Key и Google Client ID для продолжения.");
        }
    };
    dom.resetAppButton.onclick = resetApp;
    dom.saveSettingsButton.onclick = () => {
        const geminiApiKey = dom.settingsGeminiApiKey.value.trim();
        const googleClientId = dom.settingsGoogleClientId.value.trim();
        if (!geminiApiKey) { alert('Пожалуйста, введите ваш Gemini API Key.'); return; }
        if (!googleClientId) { alert('Пожалуйста, введите ваш Google Client ID.'); return; }
        
        localStorage.setItem('geminiApiKey', geminiApiKey);
        localStorage.setItem('googleClientId', googleClientId);

        alert("Настройки сохранены. Приложение будет перезагружено.");
        window.location.reload();
    };
    
    // Instructions Modal Listeners
    dom.showApiClientIdInstructions.onclick = (e) => {
        e.preventDefault();
        dom.clientIdInstructionsContent.style.display = 'block';
        dom.apiKeyInstructionsContent.style.display = 'none';
        showModal(dom.instructionsModal);
    };
     dom.showApiKeyInstructions.onclick = (e) => {
        e.preventDefault();
        dom.clientIdInstructionsContent.style.display = 'none';
        dom.apiKeyInstructionsContent.style.display = 'block';
        showModal(dom.instructionsModal);
    };
    dom.closeInstructionsButton.onclick = () => closeModal(dom.instructionsModal);


    dom.prevMonthButton.onclick = () => { appState.currentDisplayedDate.setMonth(appState.currentDisplayedDate.getMonth() - 1, 1); renderCalendar(appState.currentDisplayedDate); };
    dom.nextMonthButton.onclick = () => { appState.currentDisplayedDate.setMonth(appState.currentDisplayedDate.getMonth() + 1, 1); renderCalendar(appState.currentDisplayedDate); };
    dom.todayButton.onclick = () => { const today = new Date(); appState.currentDisplayedDate = today; renderCalendar(today); renderDailyEvents(today); };
    dom.suggestionChipsContainer.onclick = (e) => { const target = e.target; if (target.classList.contains('suggestion-chip')) sendMessage(target.textContent || ''); };
    dom.mobileTabBar.onclick = (e) => { const btn = e.target.closest('.tab-button'); if (btn) switchView(btn.dataset.view); };
    
    // Listener for interactive card actions
    dom.messageList.addEventListener('click', (e) => {
        const button = e.target.closest('.card-action-button');
        if (!button) return;
        
        const action = button.dataset.action;
        const card = button.closest('.card');
        const eventId = card?.dataset.eventId;

        if (action === 'delete' && eventId) {
            if (confirm('Вы уверены, что хотите удалить это событие?')) {
                deleteCalendarEvent({ event_id: eventId });
            }
        } else if (action === 'edit' && eventId) {
            const new_text = prompt("Что вы хотите изменить в этом событии? (Например: 'перенеси на завтра в 15:00', 'измени название на ...')");
            if (new_text) {
                sendMessage(`Обнови событие с ID ${eventId}: ${new_text}`);
            }
        }
    });

    switchView('chat');
}

// --- App Entry Point ---
document.addEventListener('DOMContentLoaded', initializeApp);
