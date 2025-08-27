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
    userProfileMenu: document.getElementById('user-profile-menu'),
    settingsButton: document.getElementById('settings-button'),
    // Chat
    chatView: document.getElementById('chat-view'),
    messageList: document.getElementById('message-list'),
    chatTextInput: document.getElementById('chat-text-input'),
    micButtonChat: document.getElementById('mic-button-chat'),
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

    if (geminiApiKey) {
        appState.ai = new GoogleGenAI({ apiKey: geminiApiKey });
    }

    if (googleClientId) {
        await initializeGapiClient(googleClientId);
    }
    
    // Initial UI update based on keys and sign-in status
    const isSignedIn = appState.gapiInited && gapi.client.getToken() !== null;
    updateUiForAuthState(isSignedIn);
}

async function initializeGapiClient(clientId) {
    await gapiReady;
    await gapi.client.init({ discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"] });
    appState.gapiInited = true;
    
    await gisReady;
    appState.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
        callback: handleTokenResponse,
    });
    appState.gisInited = true;
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
            gapi.client.setToken('');
            appState.chatHistory = [];
            dom.messageList.innerHTML = '';
            updateUiForAuthState(false);
        });
    }
}

async function handleTokenResponse(response) {
    if (response.error) {
        console.error('Google token error:', response);
        appendMessage('error', `Ошибка авторизации: ${response.error_description}`);
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

    // Update Header Profile/Auth Button
    dom.userProfileMenu.innerHTML = '';
    if (isSignedIn) {
        const profile = await gapi.client.request({ path: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json' });
        const user = profile.result;
        dom.userProfileMenu.innerHTML = `
            <img src="${user.picture}" alt="${user.name}" class="user-avatar" id="user-avatar-button">
        `;
        // Simple dropdown for sign out
        document.getElementById('user-avatar-button').addEventListener('click', () => {
            const signOutButton = document.createElement('button');
            signOutButton.className = 'action-button';
            signOutButton.textContent = 'Выйти';
            signOutButton.style.position = 'absolute';
            signOutButton.style.top = '50px';
            signOutButton.style.right = '0';
            signOutButton.onclick = () => {
                handleSignOutClick();
                signOutButton.remove();
            };
            dom.userProfileMenu.appendChild(signOutButton);
            setTimeout(() => signOutButton.remove(), 5000); // Auto-remove after 5s
        });
    } else {
        const authButton = document.createElement('button');
        authButton.id = 'auth-button-header';
        authButton.className = 'action-button primary';
        authButton.innerHTML = `<span class="material-symbols-outlined">login</span> Войти`;
        authButton.onclick = handleAuthClick;
        authButton.style.display = keysExist ? 'inline-flex' : 'none';
        dom.userProfileMenu.appendChild(authButton);
    }

    // Update Main Content
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
    
    // Update Settings Modal
    if (isSignedIn) {
        dom.authContainerSettings.innerHTML = `<p>Вы вошли в аккаунт Google.</p>`;
    } else {
        dom.authContainerSettings.innerHTML = keysExist ? 
            `<p>Для доступа к календарю войдите в аккаунт Google.</p>` :
            `<p>Сначала сохраните ключи API, чтобы включить авторизацию.</p>`;
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
    if (!text && images.length === 0) return;
    if (!appState.ai) {
        appendMessage('error', 'Ключ Gemini API не настроен. Пожалуйста, добавьте его в настройках.');
        return;
    }

    showLoading(true);
    dom.welcomeScreen.style.opacity = '0';
    setTimeout(() => { dom.welcomeScreen.style.display = 'none'; }, 300);

    const userMessage = { role: 'user', parts: [{ text }] };
    if (images.length > 0) {
      userMessage.parts.push(...images.map(img => ({ inlineData: { mimeType: img.type, data: img.data } })));
    }
    appendMessage('user', text);
    appState.chatHistory.push(userMessage);
    
    dom.chatTextInput.value = '';
    dom.chatTextInput.style.height = 'auto';


    try {
        const result = await appState.ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: appState.chatHistory,
            systemInstruction: `Вы — ассистент, интегрированный с Google Календарем. Текущая дата: ${new Date().toISOString()}`,
            tools: [{ functionDeclarations: [
                {   name: 'create_calendar_event',
                    description: 'Создает событие в Google Календаре.',
                    parameters: { type: Type.OBJECT, properties: { summary: { type: Type.STRING }, location: {type: Type.STRING}, description: {type: Type.STRING}, startDateTime: { type: Type.STRING }, endDateTime: { type: Type.STRING } }, required: ['summary', 'startDateTime', 'endDateTime'] }
                },
                {   name: 'find_calendar_events',
                    description: 'Ищет события в Google Календаре.',
                    parameters: { type: Type.OBJECT, properties: { timeRangeStart: { type: Type.STRING }, timeRangeEnd: { type: Type.STRING } }, required: [] }
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
        appendMessage('system', `Выполняю: ${name}...`);
        appState.chatHistory.push(response.candidates[0].content);

        const apiResponse = await processFunctionCall(name, args);
        
        appState.chatHistory.push({ role: 'tool', parts: [{ functionResponse: { name, response: apiResponse } }] });

        const result2 = await appState.ai.models.generateContent({ model: 'gemini-2.5-flash', contents: appState.chatHistory });
        await handleApiResponse(result2);
    } else if (response.text) {
        const text = response.text;
        appendMessage('ai', text);
        appState.chatHistory.push({ role: 'model', parts: [{ text }] });
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
                };
                const createResponse = await gapi.client.calendar.events.insert({ calendarId: 'primary', resource: event });
                result = { success: true, event: createResponse.result };
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
            default:
                throw new Error(`Неизвестная функция: ${name}`);
        }
        return result;
    } catch (error) {
        console.error(`Error in function ${name}:`, error);
        return { error: error.message };
    }
}

function appendMessage(sender, content) {
    const messageBubble = document.createElement('div');
    messageBubble.className = `message-bubble ${sender}`;
    messageBubble.innerHTML = marked.parse(content);
    dom.messageList.appendChild(messageBubble);
    dom.messageList.scrollTop = dom.messageList.scrollHeight;
}

function showLoading(isLoading) {
    dom.loadingIndicator.style.display = isLoading ? 'flex' : 'none';
    dom.chatTextInput.disabled = isLoading;
    dom.micButtonChat.disabled = isLoading;
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
             sendMessage(dom.chatTextInput.value || 'Что на этом изображении?', [{ type: file.type, data: base64Data }]);
        }
        e.target.value = ''; // Reset input
    });

    dom.suggestionChipsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('suggestion-chip')) {
            sendMessage(e.target.textContent);
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