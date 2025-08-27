
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import { marked } from 'marked';

// --- Config ---
let ai = null;
let GOOGLE_CLIENT_ID = null;
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";

let tokenClient;
let gapiInited = false;
let gisInited = false;
let chatHistory = [];
let currentDisplayedDate = new Date();

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

const gapiReady = new Promise(resolve => { window.gapiLoadedCallback = resolve; });
const gisReady = new Promise(resolve => { window.gisInitalisedCallback = resolve; });

// --- DOM Elements ---
const dom = {
    messageList: document.getElementById('message-list'),
    chatTextInput: document.getElementById('chat-text-input'),
    micButtonChat: document.getElementById('mic-button-chat'),
    cameraButtonChat: document.getElementById('camera-button-chat'),
    imageUploadInputChat: document.getElementById('image-upload-input-chat'),
    loadingIndicator: document.getElementById('loading-indicator'),
    welcomeScreen: document.getElementById('welcome-screen'),
    welcomeSubheading: document.getElementById('welcome-subheading'),
    suggestionChipsContainer: document.getElementById('suggestion-chips-container'),
    userProfile: document.getElementById('user-profile'),
    userAvatar: document.getElementById('user-avatar'),
    userName: document.getElementById('user-name'),
    settingsButton: document.getElementById('settings-button'),
    authButtonHeader: document.getElementById('auth-button-header'),
    signOutButtonHeader: document.getElementById('sign-out-button-header'),
    authContainerSettings: document.getElementById('auth-container-settings'),
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
    settingsModal: document.getElementById('settings-modal'),
    googleClientIdInstructionsModal: document.getElementById('google-client-id-instructions-modal'),
};

// --- Initialization ---

async function initializeApp() {
    setupEventListeners();
    const geminiApiKey = localStorage.getItem('geminiApiKey');
    GOOGLE_CLIENT_ID = localStorage.getItem('googleClientId');

    if (geminiApiKey) {
        ai = new GoogleGenAI({ apiKey: geminiApiKey });
    }
    if (GOOGLE_CLIENT_ID) {
        await initializeGapiClient();
    }
    updateUiForAuthState(gapi.client.getToken() !== null);
}

async function initializeGapiClient() {
    await gapiReady;
    await gapi.client.init({ discoveryDocs: DISCOVERY_DOCS });
    gapiInited = true;
    
    await gisReady;
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: handleTokenResponse,
    });
    gisInited = true;
}

// --- Authentication & UI Updates ---

function handleAuthClick() {
    if (gisInited && tokenClient) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        alert("Ошибка конфигурации. Проверьте Client ID в настройках.");
    }
}

function handleSignOutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken('');
            updateUiForAuthState(false);
            chatHistory = [];
            dom.messageList.innerHTML = '';
        });
    }
}

async function handleTokenResponse(response) {
    if (response.error) {
        console.error('Google token error:', response);
        return;
    }
    updateUiForAuthState(true);
    if (dom.settingsModal.classList.contains('visible')) {
        closeModal(dom.settingsModal);
    }
}

async function updateUiForAuthState(isSignedIn) {
    const keysExist = localStorage.getItem('geminiApiKey') && localStorage.getItem('googleClientId');

    if (isSignedIn) {
        dom.welcomeScreen.style.display = 'none';
        dom.calendarLoginPrompt.style.display = 'none';
        dom.calendarViewContainer.style.display = 'grid';
        dom.suggestionChipsContainer.style.display = 'flex';

        // Header UI
        dom.userProfile.style.display = 'flex';
        dom.authButtonHeader.style.display = 'none';
        dom.signOutButtonHeader.style.display = 'inline-flex';

        // Settings Modal UI
        dom.authContainerSettings.innerHTML = `<p>Вы вошли в аккаунт Google.</p>`;

        const profile = await gapi.client.request({
            path: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json'
        });
        dom.userName.textContent = profile.result.name;
        dom.userAvatar.src = profile.result.picture;

        renderCalendar(currentDisplayedDate);
        renderDailyEvents(currentDisplayedDate);

    } else {
        dom.welcomeScreen.style.display = 'flex';
        dom.userProfile.style.display = 'none';
        dom.calendarLoginPrompt.style.display = 'block';
        dom.calendarViewContainer.style.display = 'none';
        dom.suggestionChipsContainer.style.display = 'none';
        
        // Header UI
        dom.signOutButtonHeader.style.display = 'none';

        if (!keysExist) {
            dom.authButtonHeader.style.display = 'none';
            dom.welcomeSubheading.textContent = "Для начала работы введите ключи API в настройках (⚙️).";
            dom.calendarLoginPrompt.textContent = "Введите ключи API в настройках.";
            dom.authContainerSettings.innerHTML = `<p>Сначала сохраните ключи API.</p>`;
        } else {
            dom.authButtonHeader.style.display = 'inline-flex';
            dom.welcomeSubheading.textContent = "Войдите в свой аккаунт Google.";
            dom.calendarLoginPrompt.textContent = "Войдите, чтобы увидеть ваш календарь.";
            dom.authContainerSettings.innerHTML = `<p>Для доступа к календарю войдите в свой аккаунт Google, используя кнопку в заголовке.</p>`;
        }
    }
}

// --- Modals ---

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
    dom.currentMonthYear.textContent = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
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
    if (!gapi.client.getToken()) return;

    const timeMin = new Date(year, month, 1).toISOString();
    const timeMax = new Date(year, month + 1, 0).toISOString();
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
}

async function renderDailyEvents(date) {
    dom.dailyEventsHeader.textContent = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    dom.dailyEventsHeader.dataset.date = date.toISOString();
    dom.dailyEventsList.innerHTML = '<li>Загрузка...</li>';
    if (!gapi.client.getToken()) {
        dom.dailyEventsList.innerHTML = '<li>Войдите, чтобы увидеть события.</li>';
        return;
    }

    const timeMin = new Date(date.setHours(0, 0, 0, 0)).toISOString();
    const timeMax = new Date(date.setHours(23, 59, 59, 999)).toISOString();

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
    if (!ai) {
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
    chatHistory.push(userMessage);
    
    dom.chatTextInput.value = '';

    try {
        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: chatHistory,
            systemInstruction: `Вы — ассистент, интегрированный с Google Календарем. Текущая дата: ${new Date().toISOString()}`,
            tools: [{ functionDeclarations: [
                {   name: 'create_calendar_event',
                    description: 'Создает событие в Google Календаре.',
                    parameters: { type: Type.OBJECT, properties: { summary: { type: Type.STRING }, location: {type: Type.STRING}, description: {type: Type.STRING}, startDateTime: { type: Type.STRING }, endDateTime: { type: Type.STRING } }, required: ['summary', 'startDateTime', 'endDateTime'] }
                },
                {   name: 'find_calendar_events',
                    description: 'Ищет события в Google Календаре.',
                    parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] }
                }
            ]}]
        });
        
        await handleApiResponse(result);

    } catch (error) {
        console.error('Gemini Error:', error);
        appendMessage('error', 'Ошибка при обращении к AI. Проверьте ваш Gemini API Key.');
    } finally {
        showLoading(false);
    }
}

async function handleApiResponse(response) {
    const functionCall = response.candidates[0]?.content?.parts?.find(p => p.functionCall)?.functionCall;

    if (functionCall) {
        const { name, args } = functionCall;
        appendMessage('system', `Выполняю: ${name}...`);
        chatHistory.push(response.candidates[0].content);

        const apiResponse = await processFunctionCall(name, args);
        
        chatHistory.push({ role: 'tool', parts: [{ functionResponse: { name, response: apiResponse } }] });

        const result2 = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: chatHistory });
        await handleApiResponse(result2);
    } else if (response.text) {
        const text = response.text;
        appendMessage('ai', text);
        chatHistory.push({ role: 'model', parts: [{ text }] });
    }
}

async function processFunctionCall(name, args) {
    try {
        if (!gapi.client.getToken()) throw new Error("Пользователь не авторизован.");
        let result;
        switch (name) {
            case 'create_calendar_event':
                const event = {
                    summary: args.summary,
                    location: args.location,
                    description: args.description,
                    start: { dateTime: args.startDateTime, timeZone: 'Europe/Moscow' },
                    end: { dateTime: args.endDateTime, timeZone: 'Europe/Moscow' },
                };
                const createResponse = await gapi.client.calendar.events.insert({ calendarId: 'primary', resource: event });
                result = createResponse.result;
                renderCalendar(new Date(args.startDateTime));
                renderDailyEvents(new Date(args.startDateTime));
                break;
            case 'find_calendar_events':
                const findResponse = await gapi.client.calendar.events.list({
                    calendarId: 'primary', q: args.query, showDeleted: false, singleEvents: true, orderBy: 'startTime', maxResults: 5
                });
                result = findResponse.result.items;
                break;
            default:
                throw new Error(`Unknown function: ${name}`);
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
    });

    dom.suggestionChipsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('suggestion-chip')) {
            sendMessage(e.target.textContent);
        }
    });
    
    dom.prevMonthButton.addEventListener('click', () => {
        currentDisplayedDate.setMonth(currentDisplayedDate.getMonth() - 1);
        renderCalendar(currentDisplayedDate);
    });
    dom.nextMonthButton.addEventListener('click', () => {
        currentDisplayedDate.setMonth(currentDisplayedDate.getMonth() + 1);
        renderCalendar(currentDisplayedDate);
    });
    dom.todayButton.addEventListener('click', () => {
        currentDisplayedDate = new Date();
        renderCalendar(currentDisplayedDate);
        renderDailyEvents(currentDisplayedDate);
    });

    dom.settingsButton.addEventListener('click', () => showModal(dom.settingsModal));
    document.getElementById('close-settings-button').addEventListener('click', () => closeModal(dom.settingsModal));
    document.getElementById('close-instructions-button').addEventListener('click', () => closeModal(dom.googleClientIdInstructionsModal));
    
    dom.authButtonHeader.addEventListener('click', handleAuthClick);
    dom.signOutButtonHeader.addEventListener('click', handleSignOutClick);

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

    const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekdays.forEach(day => dom.calendarGridWeekdays.innerHTML += `<div class="weekday-header">${day}</div>`);
}

// --- Init ---
initializeApp();
