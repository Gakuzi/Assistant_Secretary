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
    currentMonthYear: document.getElementById('current-month-year'),
    calendarGridWeekdays: document.getElementById('calendar-grid-weekdays'),
    calendarGridDays: document.getElementById('calendar-grid-days'),
    dailyEventsContainer: document.getElementById('daily-events-container'),
    dailyEventsHeader: document.getElementById('daily-events-header'),
    dailyEventsList: document.getElementById('daily-events-list'),
    onboardingModal: document.getElementById('onboarding-modal'),
    settingsModal: document.getElementById('settings-modal'),
    googleClientIdInstructionsModal: document.getElementById('google-client-id-instructions-modal'),
};

let currentDisplayedDate = new Date();
let recognition;


// --- Core Application Logic ---

/**
 * Initializes the GAPI client, loading necessary APIs and setting up the token client.
 */
async function initializeGapiClient() {
    try {
        await gapiReady;
        await gisReady;

        await new Promise((resolve, reject) => {
            gapi.load('client:picker', { callback: resolve, onerror: reject });
        });
        pickerApiLoaded = true;

        await gapi.client.init({
            clientId: GOOGLE_CLIENT_ID,
            discoveryDocs: DISCOVERY_DOCS,
            scope: SCOPES,
        });
        gapiInited = true;

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: handleTokenResponse,
        });
        gisInited = true; // CRITICAL FIX: This flag was never being set.

        const token = gapi.client.getToken();
        updateUiForAuthState(token !== null && token.access_token);

    } catch (error) {
        console.error('Error initializing Google API client:', error);
        let errorMessage = 'Не удалось инициализировать сервисы Google. ';
        if (error.details) {
            errorMessage += `Details: ${error.details}. Убедитесь, что ваш Client ID настроен правильно.`;
        } else {
            errorMessage += 'Проверьте подключение к интернету и обновите страницу.';
        }
        appendMessage('error', errorMessage);
    }
}

/**
 * Reads API keys from localStorage and re-initializes the AI and Google clients.
 */
async function reconfigureClientsFromStorage() {
    const geminiApiKey = localStorage.getItem('geminiApiKey');
    GOOGLE_CLIENT_ID = localStorage.getItem('googleClientId');

    if (geminiApiKey) {
        try {
            ai = new GoogleGenAI({ apiKey: geminiApiKey });
        } catch (error) {
            console.error("Invalid Gemini API Key:", error);
            alert("Неверный формат Gemini API Key. Пожалуйста, проверьте его в настройках.");
        }
    }

    if (geminiApiKey && GOOGLE_CLIENT_ID) {
        // CRITICAL FIX: Await the initialization to prevent race conditions.
        await initializeGapiClient();
    }
}

/**
 * Main entry point for the application.
 */
async function initializeApp() {
    document.getElementById('instructions-js-origin').textContent = window.location.origin;
    document.getElementById('instructions-redirect-uri').textContent = window.location.origin;

    const keysExist = localStorage.getItem('geminiApiKey') && localStorage.getItem('googleClientId');

    if (keysExist) {
        // CRITICAL FIX: Await reconfiguration to ensure everything is loaded before proceeding.
        await reconfigureClientsFromStorage();
    } else {
        showOnboardingModal();
    }

    setupEventListeners();
}


// --- Authentication & UI Updates ---

/**
 * Handles the click event for the authorization button.
 */
function handleAuthClick() {
    if (!gapiInited || !gisInited) {
        console.error("Auth button clicked before GAPI/GIS initialization.");
        alert("Сервисы Google еще не загружены. Пожалуйста, подождите.");
        return;
    }
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

/**
 * Handles the click event for the sign-out button.
 */
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

/**
 * Callback function for the token client. Handles the response from the OAuth2 flow.
 * @param {object} response - The token response from Google.
 */
async function handleTokenResponse(response) {
    if (response.error) {
        console.error('Google token error:', response.error);
        appendMessage('error', `Ошибка авторизации: ${response.error}. Попробуйте еще раз.`);
        return;
    }
    gapi.client.setToken(response);
    await updateUiForAuthState(true);
    // Hide modals if they are open after successful login
    if (dom.onboardingModal.classList.contains('visible')) {
        dom.onboardingModal.style.display = 'none';
        dom.onboardingModal.classList.remove('visible');
    }
    if (dom.settingsModal.classList.contains('visible')) {
        dom.settingsModal.style.display = 'none';
        dom.settingsModal.classList.remove('visible');
    }
}


/**
 * Updates the UI based on the user's authentication state.
 * @param {boolean} isSignedIn - Whether the user is signed in.
 */
async function updateUiForAuthState(isSignedIn) {
    if (isSignedIn) {
        dom.welcomeScreen.style.display = 'none';
        dom.calendarLoginPrompt.style.display = 'none';
        dom.calendarViewContainer.style.display = 'grid';

        // Fetch and display user profile
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

            const settingsAvatar = document.getElementById('settings-user-avatar');
            const settingsName = document.getElementById('settings-user-name');
            const settingsEmail = document.getElementById('settings-user-email');
            settingsAvatar.src = avatarUrl;
            settingsName.textContent = name;
            settingsEmail.textContent = email;
            document.getElementById('settings-user-profile').style.display = 'flex';

        } catch (err) {
            console.error('Error fetching user profile:', err);
        }

        // Setup calendar
        renderCalendar(currentDisplayedDate);
        loadCalendarEvents(currentDisplayedDate.getFullYear(), currentDisplayedDate.getMonth());

        // Update auth buttons in settings
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
        displayAuthButtons();
    }
}


/**
 * Creates and displays the "Sign in with Google" button.
 */
function displayAuthButtons() {
    const authContainerOnboarding = document.getElementById('auth-container');
    const authContainerSettings = document.getElementById('auth-container-settings');

    const createAuthButton = () => {
        const button = document.createElement('button');
        button.className = 'action-button primary';
        button.onclick = handleAuthClick;
        button.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" style="margin-right: 8px;" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.6 10.2045C19.6 9.50907 19.5409 8.8318 19.4273 8.1818H10V11.8727H15.5545C15.3364 13.0182 14.7364 14.0182 13.8455 14.6591V17.1364H16.7136C18.5273 15.4636 19.6 13.0318 19.6 10.2045Z" fill="#4285F4"/><path d="M10 20C12.7 20 15.0136 19.0455 16.7136 17.1364L13.8455 14.6591C12.9227 15.2545 11.5864 15.6818 10 15.6818C7.38182 15.6818 5.15 13.9818 4.31818 11.6409H1.35909V14.2C3.05909 17.65 6.27727 20 10 20Z" fill="#34A853"/><path d="M4.31818 11.6409C4.12727 11.0864 4.01364 10.4955 4.01364 9.88636C4.01364 9.27727 4.12727 8.68636 4.31818 8.13182V5.57273H1.35909C0.5 7.15909 0 8.46364 0 9.88636C0 11.3091 0.5 12.6136 1.35909 14.2L4.31818 11.6409Z" fill="#FBBC05"/><path d="M10 4.09091C11.4318 4.09091 12.7727 4.58636 13.8 5.53182L16.7818 2.58636C15.0091 0.981818 12.6955 0 10 0C6.27727 0 3.05909 2.35 1.35909 5.57273L4.31818 8.13182C5.15 5.79091 7.38182 4.09091 10 4.09091Z" fill="#EA4335"/></svg> Войти через Google`;
        return button;
    };

    if (authContainerOnboarding) {
        authContainerOnboarding.innerHTML = '';
        authContainerOnboarding.appendChild(createAuthButton());
    }
    if (authContainerSettings) {
        authContainerSettings.innerHTML = '';
        authContainerSettings.appendChild(createAuthButton());
    }
}


// --- Modals (Onboarding & Settings) ---

function saveApiKeys(geminiKey, clientId) {
    localStorage.setItem('geminiApiKey', geminiKey);
    localStorage.setItem('googleClientId', clientId);
}

function showOnboardingModal() {
    dom.onboardingModal.style.display = 'flex';
    setTimeout(() => dom.onboardingModal.classList.add('visible'), 10);

    const steps = [
        document.getElementById('onboarding-step-1'),
        document.getElementById('onboarding-step-2'),
        document.getElementById('onboarding-step-3')
    ];

    const showOnboardingStep = (index) => {
        steps.forEach((step, i) => {
            step.style.display = i === index - 1 ? 'block' : 'none';
        });
    };

    document.getElementById('onboarding-next-1').addEventListener('click', () => showOnboardingStep(2));
    document.getElementById('onboarding-back-2').addEventListener('click', () => showOnboardingStep(1));
    document.getElementById('onboarding-next-2').addEventListener('click', async () => {
        const geminiKey = document.getElementById('gemini-api-key-input').value.trim();
        const clientId = document.getElementById('google-client-id-input').value.trim();

        if (!geminiKey || !clientId) {
            alert('Пожалуйста, введите оба ключа API.');
            return;
        }

        const button = document.getElementById('onboarding-next-2');
        button.disabled = true;
        button.textContent = 'Проверка...';
        
        saveApiKeys(geminiKey, clientId);
        // CRITICAL FIX: Await for initialization to complete before showing the next step.
        await reconfigureClientsFromStorage(); 

        button.disabled = false;
        button.textContent = 'Сохранить и продолжить';
        
        showOnboardingStep(3);
    });
    document.getElementById('onboarding-back-3').addEventListener('click', () => showOnboardingStep(2));
    
    showOnboardingStep(1);
}

function showSettingsModal() {
    dom.settingsModal.style.display = 'flex';
    setTimeout(() => dom.settingsModal.classList.add('visible'), 10);
    
    document.getElementById('settings-gemini-api-key').value = localStorage.getItem('geminiApiKey') || '';
    document.getElementById('settings-google-client-id').value = localStorage.getItem('googleClientId') || '';
    
    // Ensure auth buttons are up-to-date
    if (gapi?.client?.getToken()) {
        updateUiForAuthState(true);
    } else {
        updateUiForAuthState(false);
    }
}

function closeModal(modalElement) {
    modalElement.classList.remove('visible');
    setTimeout(() => modalElement.style.display = 'none', 300);
}

// --- Calendar Logic ---

/**
 * Loads calendar events for a specific month and updates the UI.
 * @param {number} year - The full year.
 * @param {number} month - The month (0-11).
 */
async function loadCalendarEvents(year, month) {
    if (!gapi.client.calendar) return;

    const timeMin = new Date(year, month, 1).toISOString();
    const timeMax = new Date(year, month + 1, 1).toISOString();

    try {
        const response = await gapi.client.calendar.events.list({
            'calendarId': 'primary',
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

/**
 * Renders the calendar grid for a given date.
 * @param {Date} date - The date to display.
 */
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
        
        const selectedDate = new Date(dom.dailyEventsHeader.dataset.date);
        if (day === selectedDate.getDate() && month === selectedDate.getMonth() && year === selectedDate.getFullYear()) {
            cell.classList.add('selected');
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
        } else if (dom.calendarGridDays.querySelector('[data-day="1"]')) {
             dom.calendarGridDays.querySelector('[data-day="1"]').classList.add('selected');
             renderDailyEvents(new Date(year, month, 1));
        }
    }
}


/**
 * Renders the list of events for a specific day.
 * @param {Date} date - The selected date.
 */
async function renderDailyEvents(date) {
    dom.dailyEventsHeader.textContent = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    dom.dailyEventsHeader.dataset.date = date.toISOString();
    dom.dailyEventsList.innerHTML = '<li>Загрузка...</li>';

    if (!gapi.client.calendar) {
        dom.dailyEventsList.innerHTML = '<li>Войдите, чтобы увидеть события.</li>';
        return;
    };

    const timeMin = new Date(date.setHours(0, 0, 0, 0)).toISOString();
    const timeMax = new Date(date.setHours(23, 59, 59, 999)).toISOString();

    try {
        const response = await gapi.client.calendar.events.list({
            'calendarId': 'primary',
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
    if (start.date) { // All-day event
        return 'Весь день';
    }
    const startTime = startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (!end || !end.dateTime) {
        return startTime;
    }
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
            ${event.location ? `
            <div class="event-item-location">
                <span class="material-symbols-outlined">location_on</span>
                <span>${event.location}</span>
            </div>` : ''}
            ${event.hangoutLink ? `
            <div class="event-item-meet">
                 <span class="material-symbols-outlined">videocam</span>
                 <a href="${event.hangoutLink}" target="_blank" rel="noopener noreferrer" class="meet-link">Присоединиться к встрече</a>
            </div>
            ` : ''}
            ${event.description ? `
            <div class="event-item-description" style="white-space: pre-wrap; max-height: 60px; overflow: hidden; text-overflow: ellipsis;">
                 <span class="material-symbols-outlined">notes</span>
                 <span>${event.description}</span>
            </div>
            ` : ''}
            ${attendeesHtml}
        </div>
        ${context === 'list-item' ? `
        <div class="event-item-actions">
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
        const deleteButton = li.querySelector('.delete');
        if (deleteButton) {
            deleteButton.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Вы уверены, что хотите удалить событие "${event.summary}"?`)) {
                    try {
                        await gapi.client.calendar.events.delete({
                            calendarId: 'primary',
                            eventId: event.id
                        });
                        li.remove();
                        loadCalendarEvents(currentDisplayedDate.getFullYear(), currentDisplayedDate.getMonth());
                        appendMessage('system', `Событие "${event.summary}" удалено.`);
                    } catch (error) {
                        console.error('Error deleting event:', error);
                        appendMessage('error', 'Не удалось удалить событие.');
                    }
                }
            });
        }
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
        '1': { background: '#a4bdfc', foreground: '#1d1d1d' },
        '2': { background: '#7ae7bf', foreground: '#1d1d1d' },
        '3': { background: '#dbadff', foreground: '#1d1d1d' },
        '4': { background: '#ff887c', foreground: '#1d1d1d' },
        '5': { background: '#fbd75b', foreground: '#1d1d1d' },
        '6': { background: '#ffb878', foreground: '#1d1d1d' },
        '7': { background: '#46d6db', foreground: '#1d1d1d' },
        '8': { background: '#e1e1e1', foreground: '#1d1d1d' },
        '9': { background: '#5484ed', foreground: '#ffffff' },
        '10': { background: '#51b749', foreground: '#ffffff' },
        '11': { background: '#dc2127', foreground: '#ffffff' },
        'default': { background: '#039be5', foreground: '#ffffff' },
    };
    return colors[colorId] || colors['default'];
}


// --- Chat & Gemini ---

async function sendMessage(text, images = []) {
    if (!text && images.length === 0) return;

    showLoading(true);
    dom.welcomeScreen.style.opacity = '0';
    setTimeout(() => { dom.welcomeScreen.style.display = 'none'; }, 300);

    const userMessage = { role: 'user', parts: [] };
    if (text) {
        userMessage.parts.push({ text: text });
        appendMessage('user', text);
    }
    if (images.length > 0) {
        images.forEach(img => {
            userMessage.parts.push({ inlineData: { mimeType: img.type, data: img.data } });
        });
        // You might want to display the image in the chat as well
    }

    chatHistory.push(userMessage);
    if (currentReplyContext) {
        chatHistory.push(currentReplyContext.aiResponse);
        clearReplyContext();
    }
    dom.chatTextInput.value = '';
    dom.chatTextInput.style.height = 'auto';


    try {
        if (!ai) {
             throw new Error("Gemini AI client is not initialized. Please check your API key.");
        }
        
        const systemInstruction = `Вы — высокоинтеллектуальный ассистент, интегрированный с Google Календарем, задачами и документами.
        Ваша цель — помогать пользователю управлять своим расписанием, задачами и заметками.
        Всегда отвечайте на русском языке.
        
        Текущая дата и время: ${new Date().toISOString()}.
        
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

        const model = ai.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: systemInstruction,
            tools: {
                functionDeclarations: [
                    {
                        name: 'create_calendar_event',
                        description: 'Создает новое событие в Google Календаре.',
                        parameters: {
                            type: 'OBJECT',
                            properties: {
                                summary: { type: 'STRING', description: 'Название или заголовок события.' },
                                description: { type: 'STRING', description: 'Подробное описание события.' },
                                location: { type: 'STRING', description: 'Место проведения события.' },
                                startDateTime: { type: 'STRING', description: 'Дата и время начала в формате ISO 8601.' },
                                endDateTime: { type: 'STRING', description: 'Дата и время окончания в формате ISO 8601.' },
                                attendees: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Список email-адресов участников.' },
                                createConference: { type: 'BOOLEAN', description: 'Создать ли видеовстречу Google Meet.' },
                            },
                            required: ['summary', 'startDateTime', 'endDateTime'],
                        },
                    },
                    {
                        name: 'find_calendar_events',
                        description: 'Ищет события в Google Календаре по запросу.',
                        parameters: {
                            type: 'OBJECT',
                            properties: {
                                query: { type: 'STRING', description: 'Поисковый запрос (например, "встреча с командой").' },
                                timeMin: { type: 'STRING', description: 'Начальная дата для поиска в формате ISO 8601.' },
                                timeMax: { type: 'STRING', description: 'Конечная дата для поиска в формате ISO 8601.' },
                            },
                        },
                    },
                    {
                        name: 'create_task',
                        description: 'Создает новую задачу в Google Tasks.',
                        parameters: {
                            type: 'OBJECT',
                            properties: {
                                title: { type: 'STRING', description: 'Название задачи.' },
                                notes: { type: 'STRING', description: 'Дополнительные детали задачи.' },
                                due: { type: 'STRING', description: 'Срок выполнения в формате ISO 8601.' },
                            },
                            required: ['title'],
                        },
                    },
                    {
                        name: 'create_document_for_event',
                        description: 'Создает Google Документ для повестки встречи и прикрепляет его к событию в календаре.',
                        parameters: {
                            type: 'OBJECT',
                            properties: {
                                eventId: { type: 'STRING', description: 'ID события в календаре, к которому нужно прикрепить документ.' },
                                documentTitle: { type: 'STRING', description: 'Заголовок нового Google Документа.' },
                            },
                            required: ['eventId', 'documentTitle'],
                        },
                    },
                ],
            },
        });
        
        const chat = model.startChat({ history: chatHistory.slice(0, -1) });
        const result = await chat.sendMessage(userMessage.parts);
        
        await streamAndRenderResponse(result);

    } catch (error) {
        console.error('Error sending message to Gemini:', error);
        appendMessage('error', 'Произошла ошибка при обращении к AI. Проверьте ваш Gemini API Key и попробуйте снова.');
    } finally {
        showLoading(false);
    }
}

function appendMessage(sender, content) {
    const messageContainer = document.createElement('div');
    messageContainer.className = 'message-container';

    const messageBubble = document.createElement('div');
    messageBubble.className = `message-bubble ${sender}`;

    if (sender === 'error' || sender === 'system') {
        messageBubble.textContent = content;
    } else {
        const parsedContent = marked.parse(content);
        messageBubble.innerHTML = parsedContent;
    }
    
    messageContainer.appendChild(messageBubble);

    if (sender === 'ai' || sender === 'user') {
        const replyButton = document.createElement('button');
        replyButton.className = 'message-reply-button';
        replyButton.innerHTML = `<span class="material-symbols-outlined">reply</span>`;
        replyButton.setAttribute('aria-label', 'Ответить на это сообщение');
        replyButton.onclick = () => {
            currentReplyContext = {
                userQuery: sender === 'user' ? { role: 'user', parts: [{ text: content }] } : chatHistory[chatHistory.length - 2],
                aiResponse: sender === 'ai' ? { role: 'model', parts: [{ text: content }] } : chatHistory[chatHistory.length - 1],
            };
            dom.chatReplyContextText.textContent = `Ответ на: "${content.substring(0, 50)}..."`;
            dom.chatReplyContext.style.display = 'flex';
            dom.chatTextInput.focus();
        };
        messageContainer.appendChild(replyButton);
    }

    dom.messageList.appendChild(messageContainer);
    dom.messageList.scrollTop = dom.messageList.scrollHeight;
    return messageBubble;
}

async function streamAndRenderResponse(result) {
    let finalResponse = '';
    const response = result.response;
    const functionCalls = response.functionCalls();

    if (functionCalls && functionCalls.length > 0) {
        appendMessage('system', `Выполняю действие: ${functionCalls[0].name}...`);
        const call = functionCalls[0];
        const apiResponse = await processFunctionCall(call.name, call.args);

        const model = ai.getGenerativeModel({ model: "gemini-1.5-flash"});
        const chat = model.startChat({ history: chatHistory });
        const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: apiResponse } }]);
        
        await streamAndRenderResponse(result2);

    } else {
        const text = response.text();
        finalResponse += text;
        const aiMessageBubble = appendMessage('ai', text);
        chatHistory.push({ role: 'model', parts: [{ text: finalResponse }] });
    }
}

async function processFunctionCall(name, args) {
    let result = {};
    try {
        if (!gapiInited) throw new Error("Google API не инициализирован. Пожалуйста, войдите в аккаунт.");
        switch (name) {
            case 'create_calendar_event':
                const event = {
                    summary: args.summary,
                    location: args.location,
                    description: args.description,
                    start: { dateTime: args.startDateTime, timeZone: 'Europe/Moscow' },
                    end: { dateTime: args.endDateTime, timeZone: 'Europe/Moscow' },
                    attendees: args.attendees ? args.attendees.map(email => ({ email })) : [],
                    conferenceData: args.createConference ? { createRequest: { requestId: `meet-${Date.now()}` } } : null,
                };
                const createResponse = await gapi.client.calendar.events.insert({
                    calendarId: 'primary',
                    resource: event,
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
                    calendarId: 'primary',
                    q: args.query,
                    timeMin: args.timeMin || new Date().toISOString(),
                    timeMax: args.timeMax,
                    showDeleted: false,
                    singleEvents: true,
                    orderBy: 'startTime',
                    maxResults: 5,
                });
                result = findResponse.result.items;
                break;
            case 'create_task':
                 const task = {
                    title: args.title,
                    notes: args.notes,
                    due: args.due
                };
                const taskResponse = await gapi.client.tasks.tasks.insert({
                    tasklist: '@default',
                    resource: task
                });
                result = taskResponse.result;
                break;
            case 'create_document_for_event':
                const docResponse = await gapi.client.docs.documents.create({
                    title: args.documentTitle
                });
                const docId = docResponse.result.documentId;
                const docUrl = `https://docs.google.com/document/d/${docId}/edit`;

                const eventToUpdate = await gapi.client.calendar.events.get({
                    calendarId: 'primary',
                    eventId: args.eventId
                });

                const updatedEvent = eventToUpdate.result;
                updatedEvent.attachments = updatedEvent.attachments || [];
                updatedEvent.attachments.push({
                    fileUrl: docUrl,
                    title: args.documentTitle
                });

                const patchResponse = await gapi.client.calendar.events.patch({
                    calendarId: 'primary',
                    eventId: args.eventId,
                    resource: {
                       attachments: updatedEvent.attachments
                    }
                });
                result = { documentUrl: docUrl, event: patchResponse.result };
                break;
        }
        return { success: true, data: result };
    } catch (error) {
        console.error(`Error executing function ${name}:`, error);
        return { success: false, error: error.result?.error?.message || error.message };
    }
}


// --- UI Helpers ---

function showLoading(isLoading) {
    dom.loadingIndicator.style.display = isLoading ? 'flex' : 'none';
    dom.chatTextInput.disabled = isLoading;
    dom.micButtonChat.disabled = isLoading;
    dom.cameraButtonChat.disabled = isLoading;
}

function clearReplyContext() {
    currentReplyContext = null;
    dom.chatReplyContext.style.display = 'none';
}

async function handleCamera(source) {
    if (source === 'upload') {
        dom.imageUploadInputChat.click();
    } else if (source === 'take') {
        dom.cameraModal.style.display = 'block';
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            dom.cameraStreamElement.srcObject = stream;
        } catch (err) {
            console.error("Error accessing camera: ", err);
            appendMessage('error', 'Не удалось получить доступ к камере.');
            dom.cameraModal.style.display = 'none';
        }
    }
}

async function base64Encode(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
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
        dom.chatTextInput.style.height = (dom.chatTextInput.scrollHeight) + 'px';
    });

    dom.cameraButtonChat.addEventListener('click', () => {
        const isVisible = dom.cameraOptionsMenu.style.display === 'block';
        dom.cameraOptionsMenu.style.display = isVisible ? 'none' : 'block';
    });
    
    document.addEventListener('click', (e) => {
        if (!dom.cameraButtonChat.parentElement.contains(e.target)) {
            dom.cameraOptionsMenu.style.display = 'none';
        }
    });

    dom.uploadPhotoOption.addEventListener('click', () => handleCamera('upload'));
    dom.takePhotoOption.addEventListener('click', () => handleCamera('take'));
    dom.cancelCameraButton.addEventListener('click', () => {
        const stream = dom.cameraStreamElement.srcObject;
        stream.getTracks().forEach(track => track.stop());
        dom.cameraModal.style.display = 'none';
    });
    dom.capturePhotoButton.addEventListener('click', () => {
        const canvas = document.createElement('canvas');
        canvas.width = dom.cameraStreamElement.videoWidth;
        canvas.height = dom.cameraStreamElement.videoHeight;
        canvas.getContext('2d').drawImage(dom.cameraStreamElement, 0, 0);
        canvas.toBlob(async (blob) => {
            const data = await base64Encode(blob);
            sendMessage('', [{ type: 'image/jpeg', data: data }]);
        }, 'image/jpeg');
        dom.cancelCameraButton.click();
    });

    dom.imageUploadInputChat.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const data = await base64Encode(file);
            sendMessage('', [{ type: file.type, data: data }]);
        }
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
    
    dom.chatReplyContextClose.addEventListener('click', clearReplyContext);

    // --- Modal Listeners ---
    dom.settingsButton.addEventListener('click', showSettingsModal);
    document.getElementById('close-settings-button').addEventListener('click', () => closeModal(dom.settingsModal));
    document.getElementById('close-instructions-button').addEventListener('click', () => closeModal(dom.googleClientIdInstructionsModal));
    
    document.querySelectorAll('.open-client-id-instructions').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            dom.googleClientIdInstructionsModal.style.display = 'flex';
             setTimeout(() => dom.googleClientIdInstructionsModal.classList.add('visible'), 10);
        });
    });

    document.querySelectorAll('.copy-uri-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const targetId = e.currentTarget.dataset.target;
            const textToCopy = document.getElementById(targetId).textContent;
            navigator.clipboard.writeText(textToCopy).then(() => {
                const icon = e.currentTarget.querySelector('.material-symbols-outlined');
                const originalIcon = icon.textContent;
                icon.textContent = 'check';
                e.currentTarget.classList.add('copied');
                setTimeout(() => {
                    icon.textContent = originalIcon;
                    e.currentTarget.classList.remove('copied');
                }, 2000);
            });
        });
    });

    const saveApiKeysButton = document.getElementById('save-api-keys-button');
    saveApiKeysButton.addEventListener('click', async () => {
        const originalText = saveApiKeysButton.textContent;
        saveApiKeysButton.disabled = true;
        saveApiKeysButton.textContent = 'Сохранение...';

        const geminiKey = document.getElementById('settings-gemini-api-key').value.trim();
        const clientId = document.getElementById('settings-google-client-id').value.trim();

        if (!geminiKey || !clientId) {
            alert('Пожалуйста, введите оба ключа API.');
            saveApiKeysButton.disabled = false;
            saveApiKeysButton.textContent = originalText;
            return;
        }

        saveApiKeys(geminiKey, clientId);
        // CRITICAL FIX: Await reconfiguration to apply new keys and re-initialize.
        await reconfigureClientsFromStorage(); 

        saveApiKeysButton.disabled = false;
        saveApiKeysButton.textContent = originalText;
        alert('Ключи успешно сохранены!');
    });

    const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekdays.forEach(day => {
        dom.calendarGridWeekdays.innerHTML += `<div class="weekday-header">${day}</div>`;
    });
}

// --- Init ---
initializeApp();
```