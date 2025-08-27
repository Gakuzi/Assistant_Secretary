
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import { marked } from 'marked';

// --- API Config ---
let ai = null;
let GOOGLE_CLIENT_ID = null;

const DISCOVERY_DOCS = [
    "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
    "https://www.googleapis.com/discovery/v1/apis/people/v1/rest",
    "https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest",
    "https://www.googleapis.com/discovery/v1/apis/docs/v1/rest"
];
const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/documents";

let tokenClient;
let gapiInited = false;
let gisInited = false;
let pickerApiLoaded = false;
let chatHistory = [];
let currentReplyContext = null;
let currentDisplayedDate = new Date();
let selectedCalendarId = 'primary';
let tempEventAttachments = []; // For the edit modal

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

// Promise-based script loading to prevent race conditions
const gapiReady = new Promise(resolve => { window.gapiLoadedCallback = resolve; });
const gisReady = new Promise(resolve => { window.gisInitalisedCallback = resolve; });

// --- DOM Elements ---
const dom = {
    messageList: document.getElementById('message-list'),
    chatTextInput: document.getElementById('chat-text-input'),
    micButtonChat: document.getElementById('mic-button-chat'),
    cameraButtonChat: document.getElementById('camera-button-chat'),
    cameraOptionsMenu: document.getElementById('camera-options-menu'),
    takePhotoOption: document.getElementById('take-photo-option'),
    uploadPhotoOption: document.getElementById('upload-photo-option'),
    imageUploadInputChat: document.getElementById('image-upload-input-chat'),
    loadingIndicator: document.getElementById('loading-indicator'),
    cameraModal: document.getElementById('camera-modal'),
    cameraStreamElement: document.getElementById('camera-stream'),
    capturePhotoButton: document.getElementById('capture-photo-button'),
    cancelCameraButton: document.getElementById('cancel-camera-button'),
    welcomeScreen: document.getElementById('welcome-screen'),
    welcomeSubheading: document.getElementById('welcome-subheading'),
    suggestionChipsContainer: document.getElementById('suggestion-chips-container'),
    chatReplyContext: document.getElementById('chat-reply-context'),
    chatReplyContextText: document.getElementById('chat-reply-context-text'),
    chatReplyContextClose: document.getElementById('chat-reply-context-close'),
    userProfile: document.getElementById('user-profile'),
    userAvatar: document.getElementById('user-avatar'),
    userName: document.getElementById('user-name'),
    settingsButton: document.getElementById('settings-button'),
    calendarLoginPrompt: document.getElementById('calendar-login-prompt'),
    calendarViewContainer: document.getElementById('calendar-view-container'),
    prevMonthButton: document.getElementById('prev-month-button'),
    nextMonthButton: document.getElementById('next-month-button'),
    todayButton: document.getElementById('today-button'),
    currentMonthYear: document.getElementById('current-month-year'),
    calendarGridWeekdays: document.getElementById('calendar-grid-weekdays'),
    calendarGridDays: document.getElementById('calendar-grid-days'),
    dailyEventsContainer: document.getElementById('daily-events-container'),
    dailyEventsHeader: document.getElementById('daily-events-header'),
    dailyEventsList: document.getElementById('daily-events-list'),
    settingsModal: document.getElementById('settings-modal'),
    googleClientIdInstructionsModal: document.getElementById('google-client-id-instructions-modal'),
    calendarSelect: document.getElementById('calendar-select'),
    eventEditModal: document.getElementById('event-edit-modal'),
    closeEventEditModalButton: document.getElementById('close-event-edit-modal-button'),
    saveEventButton: document.getElementById('save-event-button'),
    attachFromDriveButton: document.getElementById('attach-from-drive-button'),
};

// --- Core Application Logic ---

async function initializeGapiClient() {
    try {
        await gapiReady;
        gapi.load('client:picker', () => { pickerApiLoaded = true; });
        await gisReady;

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: handleTokenResponse,
        });
        gisInited = true;

        await gapi.client.init({}); // Init without discovery docs first
        gapiInited = true;

        const token = gapi.client.getToken();
        updateUiForAuthState(token !== null && token.access_token);
        return true;
    } catch (error) {
        console.error('Error initializing Google API client:', error);
        updateUiForAuthState(false);
        return false;
    }
}

async function reconfigureClientsFromStorage() {
    const geminiApiKey = localStorage.getItem('geminiApiKey');
    GOOGLE_CLIENT_ID = localStorage.getItem('googleClientId');

    let geminiOk = false;
    if (geminiApiKey) {
        try {
            ai = new GoogleGenAI({ apiKey: geminiApiKey });
            geminiOk = true;
        } catch (error) {
            console.error("Invalid Gemini API Key:", error);
            alert("Неверный формат Gemini API Key. Пожалуйста, проверьте его в настройках.");
        }
    }

    if (geminiOk && GOOGLE_CLIENT_ID) {
        return await initializeGapiClient();
    } else {
         updateUiForAuthState(false);
    }
    return false;
}

async function initializeApp() {
    setupEventListeners();

    document.getElementById('instructions-js-origin').textContent = window.location.origin;
    document.getElementById('instructions-redirect-uri').textContent = window.location.origin;

    await reconfigureClientsFromStorage();
}


// --- Authentication & UI Updates ---

function handleAuthClick() {
    if (!gisInited || !tokenClient) {
        console.error("Auth button clicked before GIS token client initialization.");
        alert("Сервисы аутентификации Google еще не загружены или произошла ошибка конфигурации. Проверьте ключи в настройках.");
        return;
    }
    tokenClient.requestAccessToken({ prompt: 'consent' });
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
        appendMessage('error', `Ошибка авторизации: ${response.error}. Убедитесь, что вы предоставили доступ, и попробуйте еще раз.`);
        return;
    }
    gapi.client.setToken(response);
    await gapi.client.load('calendar', 'v3');
    await gapi.client.load('people', 'v1');
    await gapi.client.load('tasks', 'v1');
    await gapi.client.load('docs', 'v1');
    await updateUiForAuthState(true);
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

        try {
            const profile = await gapi.client.people.people.get({
                resourceName: 'people/me',
                personFields: 'names,emailAddresses,photos',
            });
            const { names, photos, emailAddresses } = profile.result;
            const name = names?.[0]?.displayName || 'User';
            const avatarUrl = photos?.[0]?.url;
            const email = emailAddresses?.[0]?.value;

            dom.userName.textContent = name;
            dom.userAvatar.src = avatarUrl;
            dom.userProfile.style.display = 'flex';

            document.getElementById('settings-user-avatar').src = avatarUrl;
            document.getElementById('settings-user-name').textContent = name;
            document.getElementById('settings-user-email').textContent = email;
            document.getElementById('settings-user-profile').style.display = 'flex';

        } catch (err) { console.error('Error fetching user profile:', err); }

        await loadUserCalendars();
        renderCalendar(currentDisplayedDate);

        document.getElementById('auth-container-settings').innerHTML = '';
        const signOutButton = document.getElementById('sign-out-button');
        signOutButton.style.display = 'block';
        signOutButton.onclick = handleSignOutClick;

    } else {
        dom.welcomeScreen.style.display = 'flex';
        dom.userProfile.style.display = 'none';
        dom.calendarLoginPrompt.style.display = 'block';
        dom.calendarViewContainer.style.display = 'none';
        document.getElementById('settings-user-profile').style.display = 'none';
        document.getElementById('sign-out-button').style.display = 'none';
        dom.suggestionChipsContainer.style.display = 'none';
        
        if (!keysExist) {
            dom.welcomeSubheading.textContent = "Для начала работы введите ключи API в настройках (⚙️).";
            dom.calendarLoginPrompt.textContent = "Введите ключи API в настройках.";
        } else if (keysExist && !gapiInited) { 
             dom.welcomeSubheading.textContent = "Ошибка конфигурации. Проверьте Client ID в настройках и попробуйте войти снова.";
             dom.calendarLoginPrompt.textContent = "Ошибка конфигурации.";
        } else {
            dom.welcomeSubheading.textContent = "Войдите в свой аккаунт Google через меню настроек (⚙️).";
            dom.calendarLoginPrompt.textContent = "Войдите, чтобы увидеть ваш календарь.";
        }
        displayAuthButtons();
    }
}


function displayAuthButtons() {
    const authContainerSettings = document.getElementById('auth-container-settings');
    if (!authContainerSettings) return;

    authContainerSettings.innerHTML = '';
    const keysExist = localStorage.getItem('geminiApiKey') && localStorage.getItem('googleClientId');

    if (!keysExist) {
        authContainerSettings.innerHTML = '<p style="font-size: 0.9em; color: var(--text-color-secondary);">Сначала сохраните ключи API, чтобы включить авторизацию.</p>';
        return;
    }

    if (gisInited) {
        const button = document.createElement('button');
        button.className = 'action-button primary';
        button.style.margin = '0';
        button.onclick = handleAuthClick;
        button.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" style="margin-right: 8px;" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.6 10.2045C19.6 9.50907 19.5409 8.83180 19.4273 8.1818H10V11.8727H15.5545C15.3364 13.0182 14.7364 14.0182 13.8455 14.6591V17.1364H16.7136C18.5273 15.4636 19.6 13.0318 19.6 10.2045Z" fill="#4285F4"/><path d="M10 20C12.7 20 15.0136 19.0455 16.7136 17.1364L13.8455 14.6591C12.9227 15.2545 11.5864 15.6818 10 15.6818C7.38182 15.6818 5.15 13.9818 4.31818 11.6409H1.35909V14.2C3.05909 17.65 6.27727 20 10 20Z" fill="#34A853"/><path d="M4.31818 11.6409C4.12727 11.0864 4.01364 10.4955 4.01364 9.88636C4.01364 9.27727 4.12727 8.68636 4.31818 8.13182V5.57273H1.35909C0.5 7.15909 0 8.46364 0 9.88636C0 11.3091 0.5 12.6136 1.35909 14.2L4.31818 11.6409Z" fill="#FBBC05"/><path d="M10 4.09091C11.4318 4.09091 12.7727 4.58636 13.8 5.53182L16.7818 2.58636C15.0091 0.981818 12.6955 0 10 0C6.27727 0 3.05909 2.35 1.35909 5.57273L4.31818 8.13182C5.15 5.79091 7.38182 4.09091 10 4.09091Z" fill="#EA4335"/></svg> Войти через Google`;
        authContainerSettings.appendChild(button);
    } else {
        authContainerSettings.innerHTML = '<p style="font-size: 0.9em; color: var(--error-color);">Не удалось загрузить сервисы авторизации. Проверьте Client ID.</p>';
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

// --- Calendar Logic ---

async function loadUserCalendars() {
    try {
        const response = await gapi.client.calendar.calendarList.list();
        const calendars = response.result.items;
        dom.calendarSelect.innerHTML = '';
        calendars.forEach(cal => {
            const option = document.createElement('option');
            option.value = cal.id;
            option.textContent = cal.summary;
            if (cal.primary) {
                option.selected = true;
                selectedCalendarId = cal.id;
            }
            dom.calendarSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading calendar list:', error);
    }
}

async function loadCalendarEvents(year, month) {
    if (!gapi?.client?.calendar) return;

    const timeMin = new Date(year, month, 1).toISOString();
    const timeMax = new Date(year, month + 1, 1).toISOString();

    try {
        const response = await gapi.client.calendar.events.list({
            'calendarId': selectedCalendarId,
            'timeMin': timeMin,
            'timeMax': timeMax,
            'showDeleted': false,
            'singleEvents': true,
            'orderBy': 'startTime'
        });

        const events = response.result.items;
        const dayCells = dom.calendarGridDays.querySelectorAll('.day-cell:not(.other-month)');
        dayCells.forEach(cell => {
            const dot = cell.querySelector('.event-dot');
            if (dot) dot.remove();
        });

        events.forEach(event => {
            const startDate = new Date(event.start.dateTime || event.start.date);
            if (startDate.getMonth() !== month) return; // Fix for multi-day events spilling over
            const dayOfMonth = startDate.getDate();
            const cell = dom.calendarGridDays.querySelector(`[data-day="${dayOfMonth}"]`);
            if (cell && !cell.querySelector('.event-dot')) {
                const dot = document.createElement('div');
                dot.className = 'event-dot';
                cell.appendChild(dot);
            }
        });

    } catch (error) {
        console.error('Error loading calendar events:', error);
        appendMessage('error', 'Не удалось загрузить события календаря.');
    }
}

function renderCalendar(date) {
    if (!gapi.client.getToken()) return;
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
        
        const selectedDateStr = dom.dailyEventsHeader.dataset.date;
        if (selectedDateStr) {
            const selectedDate = new Date(selectedDateStr);
            if (day === selectedDate.getDate() && month === selectedDate.getMonth() && year === selectedDate.getFullYear()) {
                cell.classList.add('selected');
            }
        }

        cell.addEventListener('click', () => {
            const currentlySelected = dom.calendarGridDays.querySelector('.selected');
            if (currentlySelected) currentlySelected.classList.remove('selected');
            cell.classList.add('selected');
            renderDailyEvents(new Date(year, month, day));
        });
        dom.calendarGridDays.appendChild(cell);
    }
    loadCalendarEvents(year, month);
    if (!dom.calendarGridDays.querySelector('.selected')) {
        const todayCell = dom.calendarGridDays.querySelector('.today');
        if (todayCell) {
             todayCell.classList.add('selected');
             renderDailyEvents(new Date());
        } else {
             const firstDayCell = dom.calendarGridDays.querySelector('[data-day="1"]');
             if (firstDayCell) {
                firstDayCell.classList.add('selected');
                renderDailyEvents(new Date(year, month, 1));
             }
        }
    }
}


async function renderDailyEvents(date) {
    dom.dailyEventsHeader.textContent = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    dom.dailyEventsHeader.dataset.date = date.toISOString();
    dom.dailyEventsList.innerHTML = '<li>Загрузка...</li>';

    if (!gapi?.client?.calendar) {
        dom.dailyEventsList.innerHTML = '<li>Войдите, чтобы увидеть события.</li>';
        return;
    };

    const timeMin = new Date(date.setHours(0, 0, 0, 0)).toISOString();
    const timeMax = new Date(date.setHours(23, 59, 59, 999)).toISOString();

    try {
        const response = await gapi.client.calendar.events.list({
            'calendarId': selectedCalendarId,
            'timeMin': timeMin,
            'timeMax': timeMax,
            'showDeleted': false,
            'singleEvents': true,
            'orderBy': 'startTime'
        });

        const events = response.result.items;
        dom.dailyEventsList.innerHTML = '';
        if (events.length === 0) {
            dom.dailyEventsList.innerHTML = '<li>Нет событий на этот день.</li>';
        } else {
            events.forEach(event => {
                const eventElement = createEventElement(event, 'list-item');
                dom.dailyEventsList.appendChild(eventElement);
            });
        }
    } catch (error) {
        console.error('Error fetching daily events:', error);
        dom.dailyEventsList.innerHTML = '<li>Ошибка загрузки событий.</li>';
    }
}

function formatEventTime(start, end) {
    const startDate = new Date(start.dateTime || start.date);
    if (start.date) return 'Весь день';
    
    const startTime = startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (!end || !end.dateTime) return startTime;
    
    const endTime = new Date(end.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `${startTime} - ${endTime}`;
}

function createEventElement(event, context = 'chat') {
    const li = document.createElement(context === 'list-item' ? 'li' : 'div');
    li.className = context === 'list-item' ? 'event-item' : 'event-card-in-chat';
    li.dataset.eventId = event.id;
    li.tabIndex = 0;

    const eventColor = event.colorId ? getCalendarColor(event.colorId) : getCalendarColor('default');
    
    let attendeesHtml = '';
    if (event.attendees && event.attendees.length > 0) {
        attendeesHtml = `<div class="event-item-attendees">`;
        event.attendees.slice(0, 5).forEach(att => {
            attendeesHtml += `<img class="attendee-avatar" src="https://ui-avatars.com/api/?name=${att.email || 'A'}&background=random&size=32" alt="${att.email || 'Attendee'}" title="${att.email || 'Attendee'}">`;
        });
        if (event.attendees.length > 5) {
            attendeesHtml += `<div class="attendee-avatar" style="background-color: #e0e0e0; display: flex; align-items: center; justify-content: center; font-size: 0.8em;">+${event.attendees.length - 5}</div>`;
        }
        attendeesHtml += `</div>`;
    }

    li.innerHTML = `
        <div class="event-color-indicator" style="background-color: ${eventColor.background};"></div>
        <div class="event-details">
            <h4 class="event-item-title">${event.summary || '(Без названия)'}</h4>
            <div class="event-item-time">
                <span class="material-symbols-outlined">schedule</span>
                <span>${formatEventTime(event.start, event.end)}</span>
            </div>
            ${event.location ? `<div class="event-item-location"><span class="material-symbols-outlined">location_on</span><span>${event.location}</span></div>` : ''}
            ${event.hangoutLink ? `<div class="event-item-meet"><span class="material-symbols-outlined">videocam</span><a href="${event.hangoutLink}" target="_blank" rel="noopener noreferrer" class="meet-link">Присоединиться к встрече</a></div>` : ''}
            ${event.description ? `<div class="event-item-description" style="white-space: pre-wrap; max-height: 60px; overflow: hidden; text-overflow: ellipsis;"><span class="material-symbols-outlined">notes</span><span>${event.description}</span></div>` : ''}
            ${attendeesHtml}
        </div>
        ${context === 'list-item' ? `
        <div class="event-item-actions">
            <button class="event-action-button edit" aria-label="Редактировать событие" data-event-id="${event.id}">
                <span class="material-symbols-outlined">edit</span>
            </button>
            <a href="${event.htmlLink}" target="_blank" rel="noopener noreferrer" class="event-action-button" aria-label="Открыть в Google Календаре">
                <span class="material-symbols-outlined">open_in_new</span>
            </a>
            <button class="event-action-button delete" aria-label="Удалить событие" data-event-id="${event.id}">
                <span class="material-symbols-outlined">delete</span>
            </button>
        </div>
        ` : ''}
    `;
    if (context === 'list-item') {
        li.querySelector('.delete')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Вы уверены, что хотите удалить событие "${event.summary}"?`)) {
                try {
                    await gapi.client.calendar.events.delete({ calendarId: selectedCalendarId, eventId: event.id });
                    li.remove();
                    loadCalendarEvents(currentDisplayedDate.getFullYear(), currentDisplayedDate.getMonth());
                    appendMessage('system', `Событие "${event.summary}" удалено.`);
                } catch (error) {
                    console.error('Error deleting event:', error);
                    appendMessage('error', 'Не удалось удалить событие.');
                }
            }
        });
        li.querySelector('.edit')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditEventModal(event.id);
        });
    } else {
        li.addEventListener('click', () => {
             const eventDate = new Date(event.start.dateTime || event.start.date);
             currentDisplayedDate = eventDate;
             renderCalendar(currentDisplayedDate);
             renderDailyEvents(currentDisplayedDate);
        });
    }

    return li;
}

function getCalendarColor(colorId) {
    const colors = {
        '1': { background: '#a4bdfc' }, '2': { background: '#7ae7bf' }, '3': { background: '#dbadff' },
        '4': { background: '#ff887c' }, '5': { background: '#fbd75b' }, '6': { background: '#ffb878' },
        '7': { background: '#46d6db' }, '8': { background: '#e1e1e1' }, '9': { background: '#5484ed' },
        '10': { background: '#51b749' }, '11': { background: '#dc2127' }, 'default': { background: '#039be5' },
    };
    return colors[colorId] || colors['default'];
}


// --- Chat & Gemini ---

function getSystemInstruction() {
    const selectedCalendar = dom.calendarSelect.options[dom.calendarSelect.selectedIndex];
    const calendarContext = selectedCalendar ? `Текущий выбранный календарь: "${selectedCalendar.text}" (ID: ${selectedCalendarId}). Используй этот ID для всех операций с календарем.` : '';

    return `Вы — высокоинтеллектуальный ассистент, интегрированный с Google Календарем, задачами и документами.
        Ваша цель — помогать пользователю управлять своим расписанием, задачами и заметками.
        Всегда отвечайте на русском языке.
        Текущая дата и время: ${new Date().toISOString()}.
        ${calendarContext}
        
        Когда пользователь просит создать событие, используйте функцию create_calendar_event.
        Когда пользователь просит найти событие, используйте find_calendar_events.
        Когда пользователь просит создать задачу, используйте create_task.
        Когда пользователь просит создать документ для встречи, используйте create_document_for_event.
        
        Различайте задачи и события:
        - "Напомни мне позвонить маме в 5 вечера" - это событие (create_calendar_event) с конкретным временем.
        - "Добавь в список дел 'купить молоко'" - это задача (create_task).
        
        Если для создания события не хватает информации (например, даты, времени или названия), вежливо уточните ее у пользователя.
        После успешного создания события, подтвердите это и предоставьте детали.
        Если пользователь просит создать документ для встречи, сначала найдите эту встречу с помощью find_calendar_events, чтобы получить ее ID и название. Если встреч несколько, уточните, для какой именно создать документ.
        `;
}

async function sendMessage(text, images = []) {
    if (!text && images.length === 0) return;

    showLoading(true);
    dom.welcomeScreen.style.opacity = '0';
    setTimeout(() => { dom.welcomeScreen.style.display = 'none'; }, 300);

    const userMessage = { role: 'user', parts: [] };
    if (text) userMessage.parts.push({ text: text });
    if (images.length > 0) {
        images.forEach(img => userMessage.parts.push({ inlineData: { mimeType: img.type, data: img.data } }));
    }

    appendMessage('user', text, chatHistory.length);
    chatHistory.push(userMessage);
    
    dom.chatTextInput.value = '';
    dom.chatTextInput.style.height = 'auto';

    try {
        if (!ai) throw new Error("Gemini AI client is not initialized. Please check your API key.");

        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: chatHistory,
            systemInstruction: getSystemInstruction(),
            tools: [{ functionDeclarations: [
                {   name: 'create_calendar_event', description: 'Создает новое событие в Google Календаре.',
                    parameters: { type: Type.OBJECT, properties: { summary: { type: Type.STRING }, description: { type: Type.STRING }, location: { type: Type.STRING }, startDateTime: { type: Type.STRING }, endDateTime: { type: Type.STRING }, attendees: { type: Type.ARRAY, items: { type: Type.STRING } }, createConference: { type: Type.BOOLEAN } }, required: ['summary', 'startDateTime', 'endDateTime'] } },
                {   name: 'find_calendar_events', description: 'Ищет события в Google Календаре по запросу.',
                    parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING }, timeMin: { type: Type.STRING }, timeMax: { type: Type.STRING } } } },
                {   name: 'create_task', description: 'Создает новую задачу в Google Tasks.',
                    parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, notes: { type: Type.STRING }, due: { type: Type.STRING } }, required: ['title'] } },
                {   name: 'create_document_for_event', description: 'Создает Google Документ для повестки встречи и прикрепляет его к событию в календаре.',
                    parameters: { type: Type.OBJECT, properties: { eventId: { type: Type.STRING }, documentTitle: { type: Type.STRING } }, required: ['eventId', 'documentTitle'] } },
            ]}]
        });
        
        await handleApiResponse(result);

    } catch (error) {
        console.error('Error sending message to Gemini:', error);
        appendMessage('error', 'Произошла ошибка при обращении к AI. Проверьте ваш Gemini API Key и попробуйте снова.');
    } finally {
        showLoading(false);
    }
}

function appendMessage(sender, content, historyIndex) {
    const messageContainer = document.createElement('div');
    messageContainer.className = `message-container ${sender}`;
    messageContainer.dataset.historyIndex = historyIndex;

    const messageBubble = document.createElement('div');
    messageBubble.className = `message-bubble ${sender}`;

    if (sender === 'error' || sender === 'system') {
        messageBubble.textContent = content;
    } else {
        messageBubble.innerHTML = marked.parse(content);
    }
    
    const messageActions = document.createElement('div');
    messageActions.className = 'message-actions';

    if (sender === 'user') {
        const editButton = document.createElement('button');
        editButton.className = 'message-action-button';
        editButton.innerHTML = `<span class="material-symbols-outlined">edit</span>`;
        editButton.setAttribute('aria-label', 'Редактировать');
        editButton.onclick = () => enableMessageEditing(messageContainer, messageBubble, content, historyIndex);
        messageActions.appendChild(editButton);
    }
    
    messageContainer.appendChild(messageBubble);
    messageContainer.appendChild(messageActions);

    dom.messageList.appendChild(messageContainer);
    dom.messageList.scrollTop = dom.messageList.scrollHeight;
    return messageBubble;
}

async function handleApiResponse(response) {
    const functionCall = response.candidates[0]?.content?.parts?.find(p => p.functionCall)?.functionCall;

    if (functionCall) {
        const { name, args } = functionCall;
        appendMessage('system', `Выполняю действие: ${name}...`);
        chatHistory.push(response.candidates[0].content);

        const apiResponse = await processFunctionCall(name, args);
        
        chatHistory.push({ role: 'tool', parts: [{ functionResponse: { name, response: apiResponse } }] });

        const result2 = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: chatHistory, systemInstruction: getSystemInstruction() });
        await handleApiResponse(result2);

    } else if (response.text) {
        const text = response.text;
        appendMessage('ai', text);
        chatHistory.push({ role: 'model', parts: [{ text }] });
    } else {
         appendMessage('error', 'Получен пустой ответ от AI.');
    }
}

async function processFunctionCall(name, args) {
    try {
        if (!gapiInited) throw new Error("Google API не инициализирован. Пожалуйста, войдите в аккаунт.");
        let result = {};
        switch (name) {
            case 'create_calendar_event':
                const createResponse = await gapi.client.calendar.events.insert({
                    calendarId: selectedCalendarId,
                    resource: {
                        summary: args.summary, location: args.location, description: args.description,
                        start: { dateTime: args.startDateTime, timeZone: 'Europe/Moscow' },
                        end: { dateTime: args.endDateTime, timeZone: 'Europe/Moscow' },
                        attendees: args.attendees ? args.attendees.map(email => ({ email })) : [],
                        conferenceData: args.createConference ? { createRequest: { requestId: `meet-${Date.now()}` } } : null,
                    },
                    conferenceDataVersion: 1,
                });
                result = createResponse.result;
                appendMessage('system', `Событие "${result.summary}" успешно создано.`);
                dom.messageList.lastChild.appendChild(createEventElement(result, 'chat'));
                loadCalendarEvents(currentDisplayedDate.getFullYear(), currentDisplayedDate.getMonth());
                renderDailyEvents(new Date(result.start.dateTime));
                break;
            case 'find_calendar_events':
                const findResponse = await gapi.client.calendar.events.list({
                    calendarId: selectedCalendarId, q: args.query,
                    timeMin: args.timeMin || new Date().toISOString(), timeMax: args.timeMax,
                    showDeleted: false, singleEvents: true, orderBy: 'startTime', maxResults: 5,
                });
                result = findResponse.result.items;
                break;
            case 'create_task':
                const taskResponse = await gapi.client.tasks.tasks.insert({ tasklist: '@default', resource: { title: args.title, notes: args.notes, due: args.due } });
                result = taskResponse.result;
                break;
            case 'create_document_for_event':
                const docResponse = await gapi.client.docs.documents.create({ title: args.documentTitle });
                const docUrl = `https://docs.google.com/document/d/${docResponse.result.documentId}/edit`;

                const eventToUpdate = await gapi.client.calendar.events.get({ calendarId: selectedCalendarId, eventId: args.eventId });
                const updatedAttachments = eventToUpdate.result.attachments || [];
                updatedAttachments.push({ fileUrl: docUrl, title: args.documentTitle });

                const patchResponse = await gapi.client.calendar.events.patch({ calendarId: selectedCalendarId, eventId: args.eventId, resource: { attachments: updatedAttachments } });
                result = { documentUrl: docUrl, event: patchResponse.result };
                break;
        }
        return result;
    } catch (error) {
        console.error(`Error executing function ${name}:`, error);
        return { error: error.result?.error?.message || error.message };
    }
}


// --- UI Helpers ---

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

function enableMessageEditing(container, bubble, originalText, index) {
    bubble.style.display = 'none';
    const input = document.createElement('textarea');
    input.value = originalText;
    input.className = 'message-editing-textarea';
    input.rows = Math.min(10, originalText.split('\n').length);
    
    container.insertBefore(input, bubble);
    input.focus();

    const finishEditing = () => {
        const newText = input.value.trim();
        if (newText && newText !== originalText) {
            // Remove all subsequent messages from DOM
            let nextSibling = container.nextElementSibling;
            while(nextSibling) {
                let toRemove = nextSibling;
                nextSibling = nextSibling.nextElementSibling;
                toRemove.remove();
            }
            container.remove();

            // Rewind chat history
            chatHistory.splice(index);
            sendMessage(newText);
        } else {
            input.remove();
            bubble.style.display = 'block';
        }
    };

    input.addEventListener('blur', finishEditing);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            input.blur();
        }
        if (e.key === 'Escape') {
            input.value = originalText;
            input.blur();
        }
    });
}


// --- Event Listeners Setup ---

function setupEventListeners() {
    dom.chatTextInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(dom.chatTextInput.value);
        }
    });

    dom.chatTextInput.addEventListener('input', () => {
        dom.chatTextInput.style.height = 'auto';
        dom.chatTextInput.style.height = `${dom.chatTextInput.scrollHeight}px`;
    });

    if (recognition) {
        dom.micButtonChat.addEventListener('click', () => {
            if (isRecognizing) {
                recognition.stop();
                return;
            }
            recognition.start();
        });
        recognition.onstart = () => {
            isRecognizing = true;
            dom.micButtonChat.classList.add('active');
        };
        recognition.onend = () => {
            isRecognizing = false;
            dom.micButtonChat.classList.remove('active');
        };
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            dom.chatTextInput.value = transcript;
            sendMessage(transcript);
        };
        recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
        };
    } else {
        dom.micButtonChat.disabled = true;
    }

    dom.cameraButtonChat.addEventListener('click', () => {
        dom.cameraOptionsMenu.style.display = dom.cameraOptionsMenu.style.display === 'block' ? 'none' : 'block';
    });
    
    document.addEventListener('click', (e) => {
        if (!dom.cameraButtonChat.parentElement.contains(e.target)) {
            dom.cameraOptionsMenu.style.display = 'none';
        }
    });

    dom.uploadPhotoOption.addEventListener('click', () => dom.imageUploadInputChat.click());
    dom.takePhotoOption.addEventListener('click', async () => {
        showModal(dom.cameraModal);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            dom.cameraStreamElement.srcObject = stream;
        } catch (err) {
            appendMessage('error', 'Не удалось получить доступ к камере.');
            closeModal(dom.cameraModal);
        }
    });
    dom.cancelCameraButton.addEventListener('click', () => {
        const stream = dom.cameraStreamElement.srcObject;
        stream?.getTracks().forEach(track => track.stop());
        closeModal(dom.cameraModal);
    });
    dom.capturePhotoButton.addEventListener('click', () => {
        const canvas = document.createElement('canvas');
        canvas.width = dom.cameraStreamElement.videoWidth;
        canvas.height = dom.cameraStreamElement.videoHeight;
        canvas.getContext('2d').drawImage(dom.cameraStreamElement, 0, 0);
        canvas.toBlob(async (blob) => {
            sendMessage('', [{ type: 'image/jpeg', data: await base64Encode(blob) }]);
        }, 'image/jpeg');
        dom.cancelCameraButton.click();
    });

    dom.imageUploadInputChat.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) sendMessage('', [{ type: file.type, data: await base64Encode(file) }]);
    });

    dom.suggestionChipsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('suggestion-chip')) {
            dom.chatTextInput.value = e.target.textContent;
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
    
    dom.calendarSelect.addEventListener('change', () => {
        selectedCalendarId = dom.calendarSelect.value;
        renderCalendar(currentDisplayedDate);
        const selectedDate = dom.dailyEventsHeader.dataset.date ? new Date(dom.dailyEventsHeader.dataset.date) : currentDisplayedDate;
        renderDailyEvents(selectedDate);
    });

    // --- Modal Listeners ---
    dom.settingsButton.addEventListener('click', () => showModal(dom.settingsModal));
    document.getElementById('close-settings-button').addEventListener('click', () => closeModal(dom.settingsModal));
    document.getElementById('close-instructions-button').addEventListener('click', () => closeModal(dom.googleClientIdInstructionsModal));
    dom.closeEventEditModalButton.addEventListener('click', () => closeModal(dom.eventEditModal));

    document.querySelectorAll('.open-client-id-instructions').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            showModal(dom.googleClientIdInstructionsModal);
        });
    });

    document.querySelectorAll('.copy-uri-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const textToCopy = document.getElementById(e.currentTarget.dataset.target).textContent;
            navigator.clipboard.writeText(textToCopy).then(() => {
                const icon = e.currentTarget.querySelector('.material-symbols-outlined');
                const originalIcon = icon.textContent;
                icon.textContent = 'check';
                e.currentTarget.classList.add('copied');
                setTimeout(() => { icon.textContent = originalIcon; e.currentTarget.classList.remove('copied'); }, 2000);
            });
        });
    });

    document.getElementById('save-api-keys-button').addEventListener('click', async () => {
        const geminiKey = document.getElementById('settings-gemini-api-key').value.trim();
        const clientId = document.getElementById('settings-google-client-id').value.trim();
        if (!geminiKey || !clientId) {
            alert('Пожалуйста, введите оба ключа API.');
            return;
        }
        localStorage.setItem('geminiApiKey', geminiKey);
        localStorage.setItem('googleClientId', clientId);
        alert('Ключи сохранены. Страница будет перезагружена.');
        window.location.reload();
    });

    const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekdays.forEach(day => dom.calendarGridWeekdays.innerHTML += `<div class="weekday-header">${day}</div>`);

    dom.saveEventButton.addEventListener('click', saveEventChanges);
    dom.attachFromDriveButton.addEventListener('click', showPicker);
}

// --- Event Editing and Picker Logic ---

function showPicker() {
    if (!pickerApiLoaded) {
        alert("Google Picker API еще не загружен.");
        return;
    }
    const token = gapi.client.getToken();
    if (!token) {
        alert("Необходима авторизация для использования Google Drive.");
        return;
    }

    const view = new google.picker.View(google.picker.ViewId.DOCS);
    const picker = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setAppId(GOOGLE_CLIENT_ID.split('-')[0]) // Use numeric part of client ID
        .setOAuthToken(token.access_token)
        .addView(view)
        .setCallback(pickerCallback)
        .build();
    picker.setVisible(true);
}

function pickerCallback(data) {
    if (data[google.picker.Response.ACTION] == google.picker.Action.PICKED) {
        const doc = data[google.picker.Response.DOCUMENTS][0];
        const attachment = {
            fileUrl: doc[google.picker.Document.URL],
            title: doc[google.picker.Document.NAME],
            mimeType: doc[google.picker.Document.MIME_TYPE],
            iconUrl: doc[google.picker.Document.ICON_URL]
        };
        tempEventAttachments.push(attachment);
        renderAttachments();
    }
}

function renderAttachments() {
    const list = document.getElementById('event-edit-attachments-list');
    list.innerHTML = '';
    tempEventAttachments.forEach(att => {
        const li = document.createElement('li');
        li.innerHTML = `<img src="${att.iconUrl}" width="16" height="16" alt=""> <a href="${att.fileUrl}" target="_blank">${att.title}</a>`;
        list.appendChild(li);
    });
}

async function openEditEventModal(eventId) {
    try {
        const response = await gapi.client.calendar.events.get({ calendarId: selectedCalendarId, eventId: eventId });
        const event = response.result;
        
        document.getElementById('event-edit-id').value = event.id;
        document.getElementById('event-edit-summary').value = event.summary || '';
        document.getElementById('event-edit-location').value = event.location || '';
        document.getElementById('event-edit-description').value = event.description || '';
        
        const start = new Date(event.start.dateTime || event.start.date);
        const end = new Date(event.end.dateTime || event.end.date);
        
        document.getElementById('event-edit-start-date').value = start.toISOString().split('T')[0];
        document.getElementById('event-edit-start-time').value = event.start.dateTime ? start.toTimeString().substring(0,5) : '';
        document.getElementById('event-edit-end-date').value = end.toISOString().split('T')[0];
        document.getElementById('event-edit-end-time').value = event.end.dateTime ? end.toTimeString().substring(0,5) : '';

        tempEventAttachments = event.attachments || [];
        renderAttachments();
        
        showModal(dom.eventEditModal);
    } catch (error) {
        console.error("Error fetching event for edit:", error);
        appendMessage('error', 'Не удалось загрузить данные события для редактирования.');
    }
}

async function saveEventChanges() {
    const eventId = document.getElementById('event-edit-id').value;
    
    const startDate = document.getElementById('event-edit-start-date').value;
    const startTime = document.getElementById('event-edit-start-time').value;
    const endDate = document.getElementById('event-edit-end-date').value;
    const endTime = document.getElementById('event-edit-end-time').value;
    
    const resource = {
        summary: document.getElementById('event-edit-summary').value,
        location: document.getElementById('event-edit-location').value,
        description: document.getElementById('event-edit-description').value,
        start: {},
        end: {},
        attachments: tempEventAttachments
    };
    
    if (startTime) {
        resource.start.dateTime = new Date(`${startDate}T${startTime}`).toISOString();
    } else {
        resource.start.date = startDate;
    }
    
    if (endTime) {
        resource.end.dateTime = new Date(`${endDate}T${endTime}`).toISOString();
    } else {
        resource.end.date = endDate;
    }

    try {
        await gapi.client.calendar.events.patch({
            calendarId: selectedCalendarId,
            eventId: eventId,
            resource: resource
        });
        closeModal(dom.eventEditModal);
        const eventDate = new Date(resource.start.dateTime || resource.start.date);
        loadCalendarEvents(eventDate.getFullYear(), eventDate.getMonth());
        renderDailyEvents(eventDate);
        appendMessage('system', 'Событие успешно обновлено.');
    } catch (error) {
        console.error("Error updating event:", error);
        appendMessage('error', 'Не удалось обновить событие.');
    }
}


// --- Init ---
initializeApp();
