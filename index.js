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
            discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"]
        });
        appState.gapiInited = true;

        await gisReady;
        const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/contacts.readonly";
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
    if (dom.settingsModal.classList.contains('visible')) {
        closeModal(dom.settingsModal);
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
            <p>Войдите для доступа к календарю.</p>
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
    appendMessage('user', textTrimmed);
    appState.chatHistory.push(userMessage);
    
    dom.chatTextInput.value = '';
    // Manually trigger input event to reset button states and textarea height
    dom.chatTextInput.dispatchEvent(new Event('input', { bubbles: true }));

    const systemInstruction = `Вы — ассистент, интегрированный с Google Календарем. Ваша задача — помогать пользователю управлять его расписанием. Текущая дата: ${new Date().toISOString()}.
- Всегда поддерживайте контекст разговора.
- Если пользователь просит создать онлайн-встречу или звонок, установите 'createMeetLink' в 'true' при вызове функции.
- При анализе изображений, если находите информацию о событии, предложите его создать.`;

    try {
        const result = await appState.ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: appState.chatHistory,
            systemInstruction: systemInstruction,
            tools: [{ functionDeclarations: [
                {   name: 'create_calendar_event',
                    description: 'Создает событие в Google Календаре. Для онлайн-встреч используйте createMeetLink.',
                    parameters: { 
                        type: Type.OBJECT, 
                        properties: { 
                            summary: { type: Type.STRING, description: "Название или тема события." }, 
                            location: {type: Type.STRING, description: "Место проведения."}, 
                            description: {type: Type.STRING, description: "Подробное описание события."}, 
                            startDateTime: { type: Type.STRING, description: "Дата и время начала в формате ISO 8601, например, 2024-08-15T09:00:00Z" }, 
                            endDateTime: { type: Type.STRING, description: "Дата и время окончания в формате ISO 8601." },
                            attendees: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Список email-адресов участников." },
                            createMeetLink: { type: Type.BOOLEAN, description: "Создать ли ссылку на Google Meet для этого события."}
                        }, 
                        required: ['summary', 'startDateTime', 'endDateTime'] 
                    }
                },
                {   name: 'find_calendar_events',
                    description: 'Ищет события в Google Календаре.',
                    parameters: { type: Type.OBJECT, properties: { timeRangeStart: { type: Type.STRING }, timeRangeEnd: { type: Type.STRING } }, required: [] }
                },
                {   name: 'search_contacts',
                    description: 'Ищет контакты в Google Контактах по имени или email.',
                    parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] }
                }
            ]}]
        });
        
        await handleApiResponse(result);

    } catch (error) {
        console.error('Gemini Error:', error);
        appendMessage('error', `Ошибка при обращении к AI: ${error.message}. Проверьте ваш Gemini API Key.`);
    } finally {
        showLoading(false);
    }
}

async function handleApiResponse(response) {
    const functionCall = response.candidates[0]?.content?.parts?.find(p => p.functionCall)?.functionCall;

    if (functionCall) {
        const { name, args } = functionCall;
        // Do not display the "Executing" message for a cleaner UI
        // appendMessage('system', `Выполняю: ${name}...`);
        appState.chatHistory.push(response.candidates[0].content);

        const apiResponse = await processFunctionCall(name, args);
        
        // If event was created, we've already shown the card. Just send a simplified success message to AI.
        const responseToSend = (name === 'create_calendar_event' && apiResponse.success)
            ? { success: true, eventId: apiResponse.event.id }
            : apiResponse;

        appState.chatHistory.push({ role: 'tool', parts: [{ functionResponse: { name, response: responseToSend } }] });

        const result2 = await appState.ai.models.generateContent({ model: 'gemini-2.5-flash', contents: appState.chatHistory });
        await handleApiResponse(result2);
    } else if (response.text) {
        const text = response.text;
        appendMessage('ai', text);
        appState.chatHistory.push({ role: 'model', parts: [{ text }] });
    } else {
         appendMessage('error', 'Ассистент не смог обработать ваш запрос.');
    }
}

async function processFunctionCall(name, args) {
    try {
        if (!appState.isSignedIn) throw new Error("Пользователь не авторизован для доступа к Google Календарю.");
        let result;
        switch (name) {
            case 'create_calendar_event':
                const event = {
                    summary: args.summary,
                    location: args.location,
                    description: args.description,
                    start: { dateTime: args.startDateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                    end: { dateTime: args.endDateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                    attendees: args.attendees ? args.attendees.map(email => ({ email })) : [],
                };
                if (args.createMeetLink) {
                    event.conferenceData = { createRequest: { requestId: `meet-${Date.now()}` } };
                }
                const createResponse = await gapi.client.calendar.events.insert({ 
                    calendarId: 'primary', 
                    resource: event,
                    conferenceDataVersion: 1 // Required to get Meet link details back
                });
                result = { success: true, event: createResponse.result };
                
                // Display interactive card immediately
                appendMessage('system', '', { eventType: 'eventCreated', eventData: createResponse.result });

                // Update calendar UI
                const eventDate = new Date(args.startDateTime);
                renderCalendar(eventDate);
                renderDailyEvents(eventDate);
                break;
            case 'find_calendar_events':
                const findResponse = await gapi.client.calendar.events.list({
                    calendarId: 'primary', 
                    timeMin: args.timeRangeStart || (new Date()).toISOString(),
                    timeMax: args.timeRangeEnd,
                    showDeleted: false, 
                    singleEvents: true, 
                    orderBy: 'startTime', 
                    maxResults: 10
                });
                result = findResponse.result.items;
                break;
            case 'search_contacts':
                 appendMessage('system', 'Функция поиска контактов находится в разработке.');
                 result = { info: 'Функция поиска контактов пока не реализована.' };
                 break;
            default:
                throw new Error(`Неизвестная функция: ${name}`);
        }
        return result;
    } catch (error) {
        console.error(`Error in function ${name}:`, error);
        appendMessage('error', `Ошибка выполнения команды: ${error.message}`);
        return { error: error.message };
    }
}

function appendMessage(sender, content, metadata = {}) {
    const messageBubble = document.createElement('div');
    
    if (metadata.eventType === 'eventCreated' && metadata.eventData) {
        messageBubble.className = 'message-bubble system event-card';
        const event = metadata.eventData;
        const startTime = new Date(event.start.dateTime || event.start.date);
        const meetLink = event.hangoutLink;
        
        messageBubble.innerHTML = `
            <div class="event-card-content">
                <div class="event-card-header">
                     <span class="material-symbols-outlined event-card-icon">event_available</span>
                    <div>
                        <h4 class="event-card-title">${event.summary || '(Без названия)'}</h4>
                    </div>
                </div>
                <div class="event-card-details">
                    <p>
                        <span class="material-symbols-outlined">schedule</span>
                        <span>${startTime.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}</span>
                    </p>
                    ${event.location ? `
                    <p>
                        <span class="material-symbols-outlined">location_on</span>
                        <span>${event.location}</span>
                    </p>` : ''}
                     ${meetLink ? `
                    <p>
                        <span class="material-symbols-outlined">videocam</span>
                        <span>Google Meet</span>
                    </p>` : ''}
                </div>
            </div>
            <div class="event-card-actions">
                <a href="${event.htmlLink}" target="_blank" rel="noopener noreferrer" class="action-button">
                    Посмотреть в Календаре
                    <span class="material-symbols-outlined" style="font-size: 16px;">open_in_new</span>
                </a>
            </div>
        `;
    } else {
        messageBubble.className = `message-bubble ${sender}`;
        messageBubble.innerHTML = marked.parse(content);
    }

    dom.messageList.appendChild(messageBubble);
    dom.messageList.scrollTop = dom.messageList.scrollHeight;
}

function showLoading(isLoading) {
    dom.loadingIndicator.style.display = isLoading ? 'flex' : 'none';
    dom.chatTextInput.disabled = isLoading;
    dom.micButtonChat.disabled = isLoading;
    dom.sendButtonChat.disabled = isLoading;
    dom.cameraButtonChat.disabled = isLoading;
}

async function base64Encode(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// --- Event Listeners ---
function setupEventListeners() {
    dom.sendButtonChat.addEventListener('click', () => sendMessage(dom.chatTextInput.value));
    
    dom.chatTextInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(dom.chatTextInput.value);
        }
    });
    
    dom.chatTextInput.addEventListener('input', () => {
        const el = dom.chatTextInput;
        el.style.height = 'auto';
        el.style.height = (el.scrollHeight) + 'px';

        const hasText = el.value.trim().length > 0;
        dom.micButtonChat.style.display = hasText ? 'none' : 'flex';
        dom.sendButtonChat.style.display = hasText ? 'flex' : 'none';
    });


    if (recognition) {
        dom.micButtonChat.addEventListener('click', () => {
            isRecognizing ? recognition.stop() : recognition.start();
        });
        recognition.onstart = () => { isRecognizing = true; dom.micButtonChat.classList.add('active'); };
        recognition.onend = () => { isRecognizing = false; dom.micButtonChat.classList.remove('active'); };
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            dom.chatTextInput.value = transcript;
            // Manually trigger input to show send button
            dom.chatTextInput.dispatchEvent(new Event('input', { bubbles: true }));
            sendMessage(transcript);
        };
    } else {
        dom.micButtonChat.disabled = true;
    }

    dom.cameraButtonChat.addEventListener('click', () => dom.imageUploadInputChat.click());
    dom.imageUploadInputChat.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
             const base64Data = await base64Encode(file);
             sendMessage(dom.chatTextInput.value, [{ type: file.type, data: base64Data }]);
        }
        e.target.value = ''; // Reset input
    });

    dom.suggestionChipsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('suggestion-chip')) {
            const text = e.target.textContent;
            dom.chatTextInput.value = text;
            dom.chatTextInput.dispatchEvent(new Event('input', { bubbles: true }));
            sendMessage(text);
        }
    });
    
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
    
    // Modals
    dom.settingsButton.addEventListener('click', () => showModal(dom.settingsModal));
    document.getElementById('close-settings-button').addEventListener('click', () => closeModal(dom.settingsModal));
    document.getElementById('close-instructions-button').addEventListener('click', () => closeModal(dom.googleClientIdInstructionsModal));
    
    document.querySelector('.open-client-id-instructions').addEventListener('click', (e) => {
        e.preventDefault();
        showModal(dom.googleClientIdInstructionsModal);
    });

    document.getElementById('save-api-keys-button').addEventListener('click', () => {
        const geminiKey = document.getElementById('settings-gemini-api-key').value.trim();
        const clientId = document.getElementById('settings-google-client-id').value.trim();
        if (!geminiKey || !clientId) {
            alert('Пожалуйста, введите оба ключа.');
            return;
        }
        localStorage.setItem('geminiApiKey', geminiKey);
        localStorage.setItem('googleClientId', clientId);
        alert('Ключи сохранены. Страница будет перезагружена.');
        window.location.reload();
    });
    
    // Mobile Navigation
    dom.mobileTabBar.addEventListener('click', (e) => {
        const button = e.target.closest('.tab-button');
        if (button) {
            switchView(button.dataset.view);
        }
    });


    const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekdays.forEach(day => dom.calendarGridWeekdays.innerHTML += `<div class="weekday-header">${day}</div>`);
}

// --- Run App ---
initializeApp();