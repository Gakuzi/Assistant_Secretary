/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from '@google/genai';
import { marked } from 'marked';

// --- API Config ---
let ai = null; // Will be initialized after reading from localStorage
let GOOGLE_CLIENT_ID = null;

const DISCOVERY_DOCS = [
    "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
    "https://www.googleapis.com/discovery/v1/apis/people/v1/rest"
];
const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/drive.readonly";

let tokenClient;
let gapiInited = false;
let gisInited = false;
let pickerApiLoaded = false;

// --- DOM Elements ---
const messageList = document.getElementById('message-list');
const chatTextInput = document.getElementById('chat-text-input');
const micButtonChat = document.getElementById('mic-button-chat');
const cameraButtonChat = document.getElementById('camera-button-chat');
const cameraOptionsMenu = document.getElementById('camera-options-menu');
const takePhotoOption = document.getElementById('take-photo-option');
const uploadPhotoOption = document.getElementById('upload-photo-option');
const imageUploadInputChat = document.getElementById('image-upload-input-chat');
const loadingIndicator = document.getElementById('loading-indicator');
const cameraModal = document.getElementById('camera-modal');
const cameraStreamElement = document.getElementById('camera-stream');
const capturePhotoButton = document.getElementById('capture-photo-button');
const cancelCameraButton = document.getElementById('cancel-camera-button');
const welcomeScreen = document.getElementById('welcome-screen');
const suggestionChipsContainer = document.getElementById('suggestion-chips-container');
const chatReplyContext = document.getElementById('chat-reply-context');
const chatReplyContextText = document.getElementById('chat-reply-context-text');
const chatReplyContextClose = document.getElementById('chat-reply-context-close');

// Calendar Panel Elements
const calendarLoginPrompt = document.getElementById('calendar-login-prompt');
const calendarViewContainer = document.getElementById('calendar-view-container');
const prevMonthButton = document.getElementById('prev-month-button');
const nextMonthButton = document.getElementById('next-month-button');
const currentMonthYearEl = document.getElementById('current-month-year');
const calendarGridWeekdays = document.getElementById('calendar-grid-weekdays');
const calendarGridDays = document.getElementById('calendar-grid-days');
const dailyEventsHeader = document.getElementById('daily-events-header');
const dailyEventsList = document.getElementById('daily-events-list');

// User Profile & Auth
const userProfile = document.getElementById('user-profile');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');


// Settings Modal Elements
const settingsButton = document.getElementById('settings-button');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsButton = document.getElementById('close-settings-button');
const settingsUserProfile = document.getElementById('settings-user-profile');
const settingsUserAvatar = document.getElementById('settings-user-avatar');
const settingsUserName = document.getElementById('settings-user-name');
const settingsUserEmail = document.getElementById('settings-user-email');
const signOutButton = document.getElementById('sign-out-button');
const authContainerSettings = document.getElementById('auth-container-settings');
const settingsGoogleClientIdInput = document.getElementById('settings-google-client-id');
const settingsGeminiApiKeyInput = document.getElementById('settings-gemini-api-key');
const saveApiKeysButton = document.getElementById('save-api-keys-button');


// Onboarding Modal Elements
const onboardingModal = document.getElementById('onboarding-modal');
const onboardingSteps = document.querySelectorAll('.onboarding-step');
const nextButton1 = document.getElementById('onboarding-next-1');
const nextButton2 = document.getElementById('onboarding-next-2');
const backButton2 = document.getElementById('onboarding-back-2');
const backButton3 = document.getElementById('onboarding-back-3');
const googleClientIdInput = document.getElementById('google-client-id-input');
const geminiApiKeyInput = document.getElementById('gemini-api-key-input');
const authContainerOnboarding = document.getElementById('auth-container');

// Instructions Modal Elements
const instructionsModal = document.getElementById('google-client-id-instructions-modal');
const openInstructionsLinks = document.querySelectorAll('.open-client-id-instructions');
const closeInstructionsButton = document.getElementById('close-instructions-button');


// --- State Variables ---
let chatHistory = [];
let userCalendars = [];
let currentEventDraft = null;
let editModeEventId = null;
let isWaitingForConfirmation = false;
let isRecognizingSpeech = false;
let isCameraOptionsOpen = false;
let currentStream = null;
let imageBase64DataForNextSend = null;
let lastFocusedElement = null; // For modal accessibility
let lastUserPrompt = ''; // To re-issue prompts internally
let replyContext = '';
// Calendar View State
let currentCalendarDate = new Date();
let selectedDate = new Date();
let eventsByDay = {}; // Cache events for the current month


// --- Onboarding Flow ---
function showOnboardingStep(stepNumber) {
    onboardingSteps.forEach(step => step.style.display = 'none');
    const currentStep = document.getElementById(`onboarding-step-${stepNumber}`);
    if (currentStep) {
        currentStep.style.display = 'block';
    }
}

function setupOnboarding() {
    openModal(onboardingModal);
    showOnboardingStep(1);

    nextButton1.onclick = () => showOnboardingStep(2);
    backButton2.onclick = () => showOnboardingStep(1);

    nextButton2.onclick = () => {
        const googleId = googleClientIdInput.value.trim();
        const geminiKey = geminiApiKeyInput.value.trim();

        if (!googleId || !geminiKey) {
            alert('Пожалуйста, введите оба ключа: Google Client ID и Gemini API Key.');
            return;
        }

        localStorage.setItem('GOOGLE_CLIENT_ID', googleId);
        localStorage.setItem('GEMINI_API_KEY', geminiKey);
        
        initializeApiClients();
        showOnboardingStep(3);
    };

    backButton3.onclick = () => showOnboardingStep(2);
}


// --- Google API & Authentication ---
async function handleTokenResponse(resp) {
    if (resp.error !== undefined) {
        if (resp.error !== 'immediate_failed') {
             console.error('Google token client error:', resp);
        }
        updateSignInStatus(false);
        return;
    }
    
    gapi.client.setToken({ access_token: resp.access_token });

    let userInfo = null;
    try {
        const userInfoResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': `Bearer ${resp.access_token}` }
        });
        if (!userInfoResp.ok) throw new Error(`Failed to fetch user info: ${userInfoResp.statusText}`);
        userInfo = await userInfoResp.json();
    } catch (error) {
        console.error("Error fetching user info:", error);
        appendMessage('Не удалось загрузить информацию о вашем профиле Google.', 'system', 'error');
    }

    updateSignInStatus(true, userInfo);
    await listUserCalendars();
    
    if (localStorage.getItem('onboardingComplete') !== 'true') {
        localStorage.setItem('onboardingComplete', 'true');
        closeModal(onboardingModal);
    }
    closeSettingsModal();
}

function initializeApiClients() {
    GOOGLE_CLIENT_ID = localStorage.getItem('GOOGLE_CLIENT_ID');
    const GEMINI_API_KEY = localStorage.getItem('GEMINI_API_KEY');

    if (GEMINI_API_KEY && !ai) {
        try {
            ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        } catch (error) {
            console.error("Failed to initialize GoogleGenAI:", error);
            ai = null;
        }
    }
    
    if (typeof google !== 'undefined' && GOOGLE_CLIENT_ID && !gisInited) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: handleTokenResponse,
        });
        gisInited = true;
        
        tokenClient.requestAccessToken({ prompt: 'none' });
    }
    maybeEnableAuthUI();
}


async function initializeGapiClient() {
  await gapi.client.init({
    discoveryDocs: DISCOVERY_DOCS,
  });
  gapiInited = true;
  gapi.load('picker', () => { pickerApiLoaded = true; });
  maybeEnableAuthUI();
}

function maybeEnableAuthUI() {
  if (gapiInited && gisInited && GOOGLE_CLIENT_ID) {
    const signInButtonHtml = `<button class="action-button primary">Войти через Google</button>`;
    
    authContainerOnboarding.innerHTML = signInButtonHtml;
    authContainerSettings.innerHTML = signInButtonHtml;
    
    authContainerOnboarding.querySelector('button').onclick = handleAuthClick;
    authContainerSettings.querySelector('button').onclick = handleAuthClick;
    
    updateWelcomeScreenVisibility();
  }
}


function handleAuthClick() {
  if (!gisInited || !tokenClient) {
    console.error("Google Identity Services client not initialized.");
    appendMessage("Ошибка входа: сервис аутентификации еще не готов.", 'system', 'error');
    return;
  }
  
  if (gapi.client.getToken() === null) {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    tokenClient.requestAccessToken({ prompt: '' });
  }
}

function handleSignOutClick() {
  if (!gapiInited) return;
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token, () => {
      gapi.client.setToken(null);
      chatHistory = []; // Clear conversation context
      userCalendars = [];
      updateSignInStatus(false);
      closeSettingsModal();
    });
  }
}

function updateSignInStatus(isSignedIn, userInfo = null) {
  if (isSignedIn) {
    userProfile.style.display = 'flex';
    if (userInfo) {
        userAvatar.src = userInfo.picture || '';
        userName.innerText = userInfo.name || '';
    }
    
    authContainerSettings.style.display = 'none';
    signOutButton.style.display = 'block';
    settingsUserProfile.style.display = 'flex';
    if (userInfo) {
        settingsUserAvatar.src = userInfo.picture || '';
        settingsUserName.innerText = userInfo.name || '';
        settingsUserEmail.innerText = userInfo.email || '';
    }
    
    calendarLoginPrompt.style.display = 'none';
    calendarViewContainer.style.display = 'grid'; // Use grid instead of flex
    welcomeScreen.querySelector('.welcome-subheading').textContent = 'Чем я могу помочь вам сегодня?';
    
  } else {
    userProfile.style.display = 'none';
    
    authContainerSettings.style.display = 'block';
    signOutButton.style.display = 'none';
    settingsUserProfile.style.display = 'none';
    maybeEnableAuthUI();
    
    calendarLoginPrompt.style.display = 'block';
    calendarViewContainer.style.display = 'none';
    welcomeScreen.querySelector('.welcome-subheading').textContent = 'Войдите в свой аккаунт Google, чтобы начать управлять календарем.';
  }
  updateWelcomeScreenVisibility();
}


// --- Calendar Functionality ---
async function listUserCalendars() {
    if (!gapiInited || !gapi.client.getToken()) return;
    try {
        const response = await gapi.client.calendar.calendarList.list();
        userCalendars = response.result.items.map(cal => ({
            id: cal.id,
            summary: cal.summary,
            primary: cal.primary || false,
            backgroundColor: cal.backgroundColor
        }));
        console.log("User calendars loaded:", userCalendars);
        
        // After loading calendars, initialize the calendar view
        renderMonthCalendar();
    } catch (err) {
        console.error('Error fetching calendar list', err);
        appendMessage('Не удалось загрузить список ваших календарей.', 'system', 'error');
    }
}

async function fetchEventsForMonth(year, month) {
    if (!gapiInited || !gapi.client.getToken() || userCalendars.length === 0) {
        return;
    }
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0, 23, 59, 59);

    try {
        const requests = userCalendars.map(calendar => gapi.client.calendar.events.list({
            'calendarId': calendar.id,
            'timeMin': firstDay.toISOString(),
            'timeMax': lastDay.toISOString(),
            'showDeleted': false,
            'singleEvents': true,
        }));
        
        const responses = await Promise.all(requests);
        let allEvents = [];
        responses.forEach((response, index) => {
            const calendar = userCalendars[index];
            const events = response.result.items;
            if (events) {
                events.forEach(event => {
                    event.calendar = { ...calendar };
                    allEvents.push(event);
                });
            }
        });

        // Group events by day
        eventsByDay = {};
        allEvents.forEach(event => {
            const eventDate = new Date(event.start.dateTime || event.start.date).getDate();
            if (!eventsByDay[eventDate]) {
                eventsByDay[eventDate] = [];
            }
            eventsByDay[eventDate].push(event);
        });

    } catch (err) {
        console.error('Error fetching month events', err);
    }
}


function renderEventItem(event) {
    const start = event.start?.dateTime || event.start?.date;
    if (!start) return '';

    const startDate = new Date(start);
    const timeString = event.start?.dateTime ? startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Весь день';
    
    const calendarColor = event.calendar?.backgroundColor || '#039be5';
    const htmlLink = event.htmlLink;

    return `
      <li class="event-item" data-event-id="${event.id}" data-calendar-id="${event.calendar.id}" tabindex="0" aria-label="Событие: ${event.summary}">
        <div class="event-color-indicator" style="background-color: ${calendarColor};"></div>
        <div class="event-details">
          <h3 class="event-item-title">${event.summary || '(Без названия)'}</h3>
          <p class="event-item-time">
              <span class="material-symbols-outlined">schedule</span>
              ${timeString}
          </p>
        </div>
        <div class="event-item-actions">
           <button class="event-action-button edit-event-btn" aria-label="Редактировать событие">
               <span class="material-symbols-outlined">edit</span>
           </button>
           ${htmlLink ? `<a href="${htmlLink}" target="_blank" rel="noopener noreferrer" class="event-action-button" aria-label="Открыть в Google Календаре">
               <span class="material-symbols-outlined">open_in_new</span>
           </a>` : ''}
        </div>
      </li>
    `;
}

function displayEventsForDate(date) {
    selectedDate = date;
    
    dailyEventsHeader.textContent = `События, ${date.toLocaleDateString('ru-RU', { month: 'long', day: 'numeric' })}`;
    dailyEventsList.innerHTML = '';
    
    const day = date.getDate();
    if (eventsByDay[day] && eventsByDay[day].length > 0) {
        eventsByDay[day].sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date));
        dailyEventsList.innerHTML = eventsByDay[day].map(renderEventItem).join('');
    } else {
        dailyEventsList.innerHTML = '<li>Нет запланированных событий.</li>';
    }

    // Highlight selected day in calendar
    document.querySelectorAll('.day-cell.selected').forEach(el => el.classList.remove('selected'));
    const selectedCell = document.querySelector(`.day-cell[data-date="${date.toISOString().split('T')[0]}"]`);
    if (selectedCell) {
        selectedCell.classList.add('selected');
    }
}


async function renderMonthCalendar() {
    if (!gapiInited || !gapi.client.getToken()) return;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();

    await fetchEventsForMonth(year, month);
    
    currentMonthYearEl.textContent = currentCalendarDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    
    calendarGridWeekdays.innerHTML = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
        .map(day => `<div class="weekday-header">${day}</div>`).join('');
        
    calendarGridDays.innerHTML = '';
    
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const daysInMonth = lastDayOfMonth.getDate();
    
    let dayOfWeek = firstDayOfMonth.getDay();
    if (dayOfWeek === 0) dayOfWeek = 7; // Sunday is 0, make it 7
    
    // Previous month's days
    for (let i = 1; i < dayOfWeek; i++) {
        calendarGridDays.innerHTML += `<div class="day-cell other-month"></div>`;
    }
    
    // Current month's days
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateString = date.toISOString().split('T')[0];
        let classes = 'day-cell';
        if (date.getTime() === today.getTime()) classes += ' today';
        if (date.getTime() === selectedDate.getTime()) classes += ' selected';
        
        const hasEvent = eventsByDay[day] && eventsByDay[day].length > 0;

        calendarGridDays.innerHTML += `
            <div class="${classes}" data-date="${dateString}" role="button" tabindex="0" aria-label="${day} число">
                ${day}
                ${hasEvent ? '<div class="event-dot"></div>' : ''}
            </div>
        `;
    }

    displayEventsForDate(selectedDate);
}


async function createCalendarEvent(eventData) {
  if (!gapiInited || !gapi.client.getToken()) {
    appendMessage('Пожалуйста, войдите в Google, чтобы создать событие.', 'system', 'error');
    return null;
  }
  try {
    const calendarId = eventData.calendarId || 'primary';
    delete eventData.calendarId;

    const requestPayload = {
      'calendarId': calendarId,
      'resource': eventData,
      'sendUpdates': 'all'
    };
    if (eventData.conferenceData && eventData.conferenceData.createRequest) {
        requestPayload.conferenceDataVersion = 1;
    }

    const response = await gapi.client.calendar.events.insert(requestPayload);
    console.log('Event created: ', response.result);
    appendMessage(`Событие **"${response.result.summary}"** успешно создано!`, 'ai', 'event_card', response.result);
    renderMonthCalendar();
    return response.result;
  } catch (err) {
    console.error('Execute error', err);
    const errorMessage = err.result?.error?.message || err.message || 'Неизвестная ошибка';
    appendMessage(`Ошибка при создании события: ${errorMessage}`, 'system', 'error');
    return null;
  }
}

async function updateCalendarEvent(calendarId, eventId, eventData) {
    if (!gapiInited || !gapi.client.getToken()) {
      appendMessage('Пожалуйста, войдите в Google, чтобы обновить событие.', 'system', 'error');
      return null;
    }
    try {
      const requestPayload = {
        'calendarId': calendarId,
        'eventId': eventId,
        'resource': eventData,
        'sendUpdates': 'all'
      };
      if (eventData.conferenceData && eventData.conferenceData.createRequest) {
          requestPayload.conferenceDataVersion = 1;
      }

      const response = await gapi.client.calendar.events.patch(requestPayload);
      console.log('Event updated: ', response.result);
      appendMessage(`Событие **"${response.result.summary}"** успешно обновлено!`, 'ai', 'event_card', response.result);
      renderMonthCalendar();
      return response.result;
    } catch (err) {
      console.error('Execute error', err);
      const errorMessage = err.result?.error?.message || err.message || 'Неизвестная ошибка';
      appendMessage(`Ошибка при обновлении события: ${errorMessage}`, 'system', 'error');
      return null;
    }
  }

async function deleteCalendarEvent(calendarId, eventId) {
    if (!gapiInited || !gapi.client.getToken()) return;
    try {
        await gapi.client.calendar.events.delete({
            'calendarId': calendarId,
            'eventId': eventId,
            'sendUpdates': 'all'
        });
        appendMessage('Событие успешно удалено.', 'system');
        renderMonthCalendar();
    } catch (err) {
        console.error('Delete error', err);
        const errorMessage = err.result?.error?.message || err.message || 'Неизвестная ошибка';
        appendMessage(`Ошибка при удалении события: ${errorMessage}`, 'system', 'error');
    }
}

async function checkForConflicts(event, eventIdToIgnore) {
    if (!event.start?.dateTime || !event.end?.dateTime) {
        return []; // Cannot check without a date range
    }
    try {
        const calendarId = event.calendarId || 'primary';
        const response = await gapi.client.calendar.events.list({
            calendarId: calendarId,
            timeMin: event.start.dateTime,
            timeMax: event.end.dateTime,
            singleEvents: true
        });
        return response.result.items.filter(item => item.id !== eventIdToIgnore);
    } catch (err) {
        console.error("Error checking for conflicts:", err);
        return []; // Fail safe, don't block on error
    }
}

// --- Google Drive Picker ---
function createPicker() {
    if (!pickerApiLoaded || !gapi.client.getToken()) {
        appendMessage('Ошибка: API для выбора файлов еще не загружен или вы не авторизованы.', 'system', 'error');
        return;
    }

    const view = new google.picker.View(google.picker.ViewId.DOCS);
    view.setMimeTypes("application/vnd.google-apps.document,application/vnd.google-apps.spreadsheet,application/vnd.google-apps.presentation,application/pdf");

    const picker = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setAppId(GOOGLE_CLIENT_ID.split('-')[0]) // App ID is the project number
        .setOAuthToken(gapi.client.getToken().access_token)
        .addView(view)
        .addView(new google.picker.DocsUploadView())
        .setCallback(pickerCallback)
        .build();
    picker.setVisible(true);
}

function pickerCallback(data) {
    if (data.action === google.picker.Action.PICKED) {
        const file = data.docs[0];
        const fileName = file.name;
        const fileUrl = file.url;

        if (currentEventDraft) {
            currentEventDraft.description = (currentEventDraft.description || '') + `\n\nПрикрепленный файл: ${fileName}\n${fileUrl}`;
            appendMessage(`Файл "${fileName}" прикреплен.`, 'system');
            handleUserInput('Файл прикреплен, подтверди создание события');
        } else {
            appendMessage(`Вы выбрали файл: ${fileName}. Теперь создайте событие, к которому его нужно прикрепить.`, 'ai');
        }
    }
}

// --- Speech Recognition ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = 'ru-RU';
  recognition.interimResults = false;

  recognition.onstart = () => { isRecognizingSpeech = true; micButtonChat.classList.add('active'); };
  recognition.onresult = (event) => { handleUserInput(event.results[0][0].transcript); };
  recognition.onerror = (event) => { console.error('Ошибка распознавания речи:', event.error); };
  recognition.onend = () => { isRecognizingSpeech = false; micButtonChat.classList.remove('active'); setLoading(false); };
} else {
  console.warn('Распознавание речи не поддерживается этим браузером.');
  if (micButtonChat) micButtonChat.disabled = true;
}


// --- UI Helper Functions ---
function setLoading(isLoading) {
  loadingIndicator.style.display = isLoading ? 'flex' : 'none';
  chatTextInput.disabled = isLoading;
  micButtonChat.disabled = isLoading || isRecognizingSpeech;
  cameraButtonChat.disabled = isLoading;
}

function scrollToBottom() { messageList.scrollTop = messageList.scrollHeight; }

function updateWelcomeScreenVisibility() {
  const hasMessages = messageList.children.length > 0;
  welcomeScreen.style.display = hasMessages ? 'none' : 'flex';
}

function renderEventCard(eventData, isConfirmation = false) {
    if (!eventData) return '';

    const start = eventData.start?.dateTime ? new Date(eventData.start.dateTime) : null;
    const end = eventData.end?.dateTime ? new Date(eventData.end.dateTime) : null;
    
    const timeString = start ? start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    const dateString = start ? start.toLocaleDateString('ru-RU', { weekday: 'short', month: 'long', day: 'numeric' }) : '';

    const attendees = eventData.attendees || [];
    const attendeesHtml = attendees
        .filter(att => !att.resource)
        .map(att => `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(att.displayName || att.email)}&background=random&size=28&rounded=true" title="${att.displayName || att.email}" alt="Аватар ${att.displayName || att.email}" class="attendee-avatar">`)
        .join('');

    const calendar = userCalendars.find(c => c.id === eventData.calendarId) || { color: '#039be5' };
    const calendarColor = eventData.color?.background || calendar.backgroundColor || '#039be5';
    
    const cardClass = isConfirmation ? 'confirmation-card' : 'event-card-in-chat';
    const cardAttributes = `data-event-id="${eventData.id || ''}" data-calendar-id="${eventData.calendarId || eventData.calendar?.id ||'primary'}"`;
    return `
      <div class="${cardClass}" ${isConfirmation ? '' : cardAttributes}>
        <div class="event-color-indicator" style="background-color: ${calendarColor};"></div>
        <div class="event-details">
            <h3 class="event-item-title">${eventData.summary || '(Без названия)'}</h3>
            ${start ? `
            <p class="event-item-time">
                <span class="material-symbols-outlined">schedule</span>
                ${dateString}, ${timeString}
            </p>` : ''}
            ${end && start && end.getTime() !== start.getTime() ? `
            <p class="event-item-time">
                <span class="material-symbols-outlined">update</span>
                Окончание: ${end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </p>`: ''}
            ${eventData.location ? `
            <p class="event-item-location">
                <span class="material-symbols-outlined">location_on</span>
                ${eventData.location}
            </p>` : ''}
            ${eventData.conferenceData || eventData.hangoutLink ? `
            <p class="event-item-meet">
                <span class="material-symbols-outlined">videocam</span>
                ${eventData.hangoutLink ? `<a href="${eventData.hangoutLink}" target="_blank" rel="noopener noreferrer" class="meet-link">Присоединиться</a>` : 'Видеовстреча Google Meet'}
            </p>` : ''}
            ${eventData.description ? `
            <p class="event-item-description">
                <span class="material-symbols-outlined">notes</span>
                ${marked.parse(eventData.description)}
            </p>` : ''}
            ${attendees.length > 0 ? `<div class="event-item-attendees">${attendeesHtml}</div>` : ''}
        </div>
      </div>
    `;
}

function appendMessage(
  content,
  sender,
  type = 'text',
  data = null
) {
  const messageContainer = document.createElement('div');
  messageContainer.className = 'message-container';

  const messageBubble = document.createElement('div');
  messageBubble.classList.add('message-bubble', sender);
  messageBubble.dataset.rawText = content || '';
  if (type === 'error') messageBubble.classList.add('error-message');

  let mainContentHtml = content ? marked.parse(content) : '';
  let interactiveHtml = '';

  switch (type) {
    case 'confirmation_request':
      isWaitingForConfirmation = true;
      currentEventDraft = data;
      const confirmationTitle = editModeEventId ? 'Подтвердите изменения:' : 'Создать это событие?';
      
      interactiveHtml = `<h3>${confirmationTitle}</h3>` + renderEventCard(data, true);
      interactiveHtml += `<div class="confirmation-buttons">
         <button class="confirm-event-action action-button primary">${editModeEventId ? 'Да, обновить' : 'Да, создать'}</button>
         <button class="cancel-event-action action-button">Отмена</button>
       </div>`;
      break;

    case 'event_card':
        interactiveHtml = renderEventCard(data);
        messageBubble.dataset.rawText = `Событие: ${data.summary}`;
        break;

    case 'contact_selection_request':
        currentEventDraft = data.eventDetails;
        interactiveHtml = `<div class="contact-picker" id="contact-picker-${Date.now()}">`;
        data.contactsToResolve.forEach(person => {
            interactiveHtml += `<fieldset class="contact-fieldset">
                <legend>Выберите контакт для "${person.name}":</legend>`;
            if (person.matches.length > 0) {
                person.matches.forEach((match, index) => {
                    interactiveHtml += `<div class="radio-option">
                        <input type="radio" name="contact-${person.name}" id="contact-${person.name}-${index}" value="${match.email}" data-display-name="${match.name}">
                        <label for="contact-${person.name}-${index}">${match.name} <span>(${match.email})</span></label>
                    </div>`;
                });
            }
            interactiveHtml += `<div class="radio-option">
                <input type="radio" name="contact-${person.name}" id="contact-${person.name}-manual" value="manual">
                <label for="contact-${person.name}-manual">Ввести email вручную</label>
            </div>
            <input type="email" class="manual-email-input" placeholder="Введите email" style="display:none;" id="manual-email-${person.name}">
            </fieldset>`;
        });
        interactiveHtml += `<div class="confirmation-buttons">
            <button class="confirm-contacts-action action-button primary">Подтвердить</button>
            <button class="cancel-event-action action-button">Отмена</button>
        </div></div>`;
        break;
      
    case 'suggestion':
        if(data?.suggestion === 'ADD_DRIVE_FILE') {
            interactiveHtml += `<button class="drive-attach-button">
                <img src="https://www.google.com/images/branding/product/2x/drive_32dp.png" alt="Google Drive icon" />
                Прикрепить с Google Диска
            </button>`;
        }
        break;
  }
  
  const replyButton = document.createElement('button');
  replyButton.className = 'message-reply-button';
  replyButton.setAttribute('aria-label', 'Ответить на сообщение');
  replyButton.innerHTML = `<span class="material-symbols-outlined">reply</span>`;
  
  messageBubble.innerHTML = mainContentHtml + interactiveHtml;
  messageContainer.appendChild(messageBubble);
  messageContainer.appendChild(replyButton);
  
  messageList.appendChild(messageContainer);

  // Add event listeners for interactive elements
  if (type === 'confirmation_request') {
    messageBubble.querySelector('.confirm-event-action')?.addEventListener('click', handleConfirmEvent);
    messageBubble.querySelector('.cancel-event-action')?.addEventListener('click', handleCancelEvent);
  } else if (type === 'contact_selection_request') {
      messageBubble.querySelectorAll('input[type="radio"]').forEach(radio => {
          radio.addEventListener('change', (e) => {
              const fieldset = e.target.closest('.contact-fieldset');
              const manualInput = fieldset.querySelector('.manual-email-input');
              manualInput.style.display = (e.target.value === 'manual') ? 'block' : 'none';
          });
      });
      messageBubble.querySelector('.confirm-contacts-action').addEventListener('click', (e) => {
          handleContactSelection(e.target.closest('.contact-picker'));
      });
      messageBubble.querySelector('.cancel-event-action').addEventListener('click', handleCancelEvent);
  } else if (type === 'event_card') {
      messageBubble.querySelector('.event-card-in-chat')?.addEventListener('click', (e) => {
        const card = e.currentTarget;
        handleEditEventStart(card.dataset.calendarId, card.dataset.eventId);
      });
  } else if (type === 'suggestion' && data?.suggestion === 'ADD_DRIVE_FILE') {
      messageBubble.querySelector('.drive-attach-button')?.addEventListener('click', createPicker);
  }

  scrollToBottom();
  updateWelcomeScreenVisibility();
}

async function processAiResponse(parsedData) {
  switch (parsedData.action) {
    case 'LIST_EVENTS':
      if (parsedData.generalResponse) {
        appendMessage(parsedData.generalResponse, 'ai');
      }
      // This is now handled by the calendar view, but we can still show a summary
      // await handleListEventsAction(parsedData.listParameters);
      break;
    
    case 'REQUEST_CONTACTS':
        await handleContactRequest(parsedData.contactNames, parsedData.eventDetails, parsedData.followUpQuestion);
        break;

    case 'CREATE_EVENT':
    case 'EDIT_EVENT':
      currentEventDraft = { ...currentEventDraft, ...parsedData.eventDetails };
      
      if (currentEventDraft.start?.dateTime && !currentEventDraft.end?.dateTime) {
          const startDate = new Date(currentEventDraft.start.dateTime);
          startDate.setHours(startDate.getHours() + 1);
          currentEventDraft.end = {
              ...(currentEventDraft.end || {}),
              dateTime: startDate.toISOString()
          };
      }

      if (parsedData.followUpQuestion) {
        appendMessage(parsedData.followUpQuestion, 'ai');
        if(parsedData.suggestion){
            appendMessage(null, 'ai', 'suggestion', { suggestion: parsedData.suggestion });
        }
      } else {
        const conflicts = await checkForConflicts(currentEventDraft, editModeEventId);
        if (conflicts.length > 0) {
            console.log("Conflicts found:", conflicts);
            await handleUserInput(lastUserPrompt, conflicts);
        } else {
            const confirmationMessage = parsedData.generalResponse || null;
            appendMessage(confirmationMessage, 'ai', 'confirmation_request', currentEventDraft);
        }
      }
      break;

    case 'GENERAL_QUERY':
      if (parsedData.generalResponse) {
        appendMessage(parsedData.generalResponse, 'ai');
      } else if (!parsedData.suggestion) {
        appendMessage('Не удалось получить осмысленный ответ. Попробуйте переформулировать.', 'ai', 'error');
      }

      if (parsedData.suggestion) {
        appendMessage(null, 'ai', 'suggestion', { suggestion: parsedData.suggestion });
      }

      if (!parsedData.isCalendarRelated) {
          currentEventDraft = null;
          editModeEventId = null;
      }
      break;

    default:
      appendMessage('Получен неизвестный тип ответа от ИИ. Попробуйте еще раз.', 'ai', 'error');
      console.error("Unknown AI action:", parsedData.action);
  }
}

// --- Event Handlers ---
async function handleConfirmEvent() {
  if (currentEventDraft) {
    setLoading(true);
    try {
      if (editModeEventId) {
          const calendarId = currentEventDraft.calendarId || 'primary';
          await updateCalendarEvent(calendarId, editModeEventId, currentEventDraft);
      } else {
          await createCalendarEvent(currentEventDraft);
      }
    } finally {
        setLoading(false);
    }
  }
  currentEventDraft = null;
  editModeEventId = null;
  isWaitingForConfirmation = false;
}

function handleCancelEvent() {
  const action = editModeEventId ? 'Редактирование' : 'Создание';
  appendMessage(`${action} события отменено.`, 'system');
  currentEventDraft = null;
  editModeEventId = null;
  isWaitingForConfirmation = false;
  appendMessage('Чем могу помочь?', 'ai');
}

async function handleEditEventStart(calendarId, eventId) {
    if (!gapiInited || !gapi.client.getToken() || !calendarId || !eventId) {
        appendMessage('Пожалуйста, войдите, чтобы редактировать события.', 'system', 'error');
        return;
    }
    setLoading(true);
    try {
        const response = await gapi.client.calendar.events.get({
            calendarId: calendarId,
            eventId: eventId,
        });
        const event = response.result;
        
        currentEventDraft = {
            summary: event.summary,
            start: event.start,
            end: event.end,
            location: event.location,
            description: event.description,
            attendees: event.attendees,
            conferenceData: event.conferenceData,
            hangoutLink: event.hangoutLink,
            calendarId: calendarId,
        };
        editModeEventId = eventId;
        isWaitingForConfirmation = false;

        appendMessage(`Редактируем событие: **"${event.summary}"**. Что вы хотите изменить?`, 'ai');
        chatTextInput.focus();
    } catch (err) {
        console.error('Error fetching event for edit:', err);
        const errorMessage = err.result?.error?.message || err.message || 'Неизвестная ошибка';
        appendMessage(`Не удалось загрузить событие для редактирования: ${errorMessage}`, 'system', 'error');
        currentEventDraft = null;
        editModeEventId = null;
    } finally {
        setLoading(false);
    }
}

async function handleContactRequest(names, eventDetails, followUpQuestion) {
    setLoading(true);
    const contactsToResolve = [];
    try {
        for (const name of names) {
            const response = await gapi.client.people.people.connections.list({
                resourceName: 'people/me',
                personFields: 'names,emailAddresses',
                query: name,
                pageSize: 5
            });
            const matches = (response.result.connections || [])
                .filter(p => p.emailAddresses && p.emailAddresses.length > 0)
                .map(p => ({
                    name: p.names && p.names.length > 0 ? p.names[0].displayName : p.emailAddresses[0].value,
                    email: p.emailAddresses[0].value
                }));
            contactsToResolve.push({ name, matches });
        }
        appendMessage(followUpQuestion, 'ai', 'contact_selection_request', { contactsToResolve, eventDetails });
    } catch (err) {
        console.error("Error fetching contacts:", err);
        appendMessage('Не удалось получить доступ к вашим контактам. Вы можете ввести email вручную.', 'system', 'error');
    } finally {
        setLoading(false);
    }
}

function handleContactSelection(pickerElement) {
    const fieldsets = pickerElement.querySelectorAll('.contact-fieldset');
    let allSelectionsValid = true;
    const selectedAttendees = [...(currentEventDraft.attendees || [])];

    fieldsets.forEach(fieldset => {
        const selectedRadio = fieldset.querySelector('input[type="radio"]:checked');
        if (!selectedRadio) {
            allSelectionsValid = false;
            return;
        }

        let email, displayName;
        if (selectedRadio.value === 'manual') {
            const manualInput = fieldset.querySelector('.manual-email-input');
            email = manualInput.value.trim();
            displayName = '';
            if (!email || !manualInput.checkValidity()) {
                allSelectionsValid = false;
                manualInput.style.border = '1px solid red';
                return;
            }
        } else {
            email = selectedRadio.value;
            displayName = selectedRadio.dataset.displayName;
        }
        selectedAttendees.push({ email, displayName });
    });

    if (!allSelectionsValid) {
        alert('Пожалуйста, выберите контакт или введите корректный email для каждого участника.');
        return;
    }
    
    currentEventDraft.attendees = selectedAttendees;
    pickerElement.closest('.message-bubble').remove(); // Clean up picker UI
    
    const confirmationPrompt = `Отлично, я добавил участников. Теперь давайте подтвердим событие.`;
    handleUserInput(confirmationPrompt);
}

async function handleUserInput(text, conflicts = []) {
  const userInput = text.trim();
  if (userInput === '') return;
  lastUserPrompt = userInput;

  if (conflicts.length === 0) {
    appendMessage(userInput, 'user');
  }
  
  chatTextInput.value = '';
  setLoading(true);
  
  const finalPrompt = replyContext ? `Контекст: "${replyContext}"\n\nЗапрос: "${userInput}"` : userInput;
  
  // Clear reply context after using it
  replyContext = '';
  chatReplyContext.style.display = 'none';

  if (!ai) {
    appendMessage('Ошибка: Gemini API Key не настроен. Пожалуйста, введите его в настройках.', 'system', 'error');
    setLoading(false);
    return;
  }

  const currentDate = new Date().toISOString();
  
  const systemInstruction = `Вы — ИИ-ассистент-секретарь для управления Google Календарем. Ваша задача — проактивно помогать пользователю, анализируя контекст и управляя событиями.

- Текущая дата и время: ${currentDate}.
- Всегда отвечайте в формате JSON.

**Основная Логика и Приоритеты:**

1.  **Приоритет 1: Участники (Attendees):**
    - Если в запросе есть имена людей ('с Анной'), но нет их email, **всегда используйте \`"action": "REQUEST_CONTACTS"\` в первую очередь.**
    - В поле \`contactNames\` передайте массив имен для поиска (например, \`["Анна"]\`).
    - В \`followUpQuestion\` напишите сообщение для пользователя (например, "Уточните, кого пригласить").
    - **Не добавляйте имена в \`attendees\` без email!**

2.  **Приоритет 2: Документы и Файлы:**
    - **После** того как все участники определены, проверьте запрос на слова 'отчет', 'документ', 'презентация'.
    - Если такие слова есть и в \`description\` текущего черновика события еще нет ссылки на файл, предложите его добавить.
    - Используйте \`"action": "GENERAL_QUERY"\`, задайте \`followUpQuestion\` (например, "Хотите прикрепить отчет с Google Диска?") и добавьте \`"suggestion": "ADD_DRIVE_FILE"\`.

3.  **Приоритет 3: Конфликты:**
    - В запросе от пользователя может быть поле \`conflictingEvents\`. Если оно не пустое, сообщите о конфликте и предложите варианты в \`followUpQuestion\`.

4.  **Приоритет 4: Финальное Подтверждение:**
    - **Только когда** все участники определены, вопрос о документах решен и конфликтов нет, используйте \`action\`: \`CREATE_EVENT\` или \`EDIT_EVENT\`.
    - Предоставьте полный и готовый объект события для финального подтверждения пользователя.

**Прочие правила:**
- **Контекст:** Если запрос начинается с "Контекст: ...", используйте его для уточнения действия (например, редактирования существующего события).
- **Видеовстречи:** Если упоминается 'звонок', 'созвон', 'онлайн', автоматически добавляйте видеовстречу: \`"conferenceData": { "createRequest": { "requestId": "..." } }\`.
- **Время:** Если \`end.dateTime\` отсутствует, событие должно длиться 1 час.
- **Календарь:** Анализируйте запрос и выбирайте наиболее подходящий \`calendarId\` из списка. По умолчанию 'primary'.

**Actions:** \`CREATE_EVENT\`, \`EDIT_EVENT\`, \`LIST_EVENTS\`, \`GENERAL_QUERY\`, \`REQUEST_CONTACTS\`.`;

  const userPrompt = `
    Доступные календари: ${JSON.stringify(userCalendars.map(c => ({id: c.id, summary: c.summary})))}
    Текущий контекст (редактируемое событие): ${editModeEventId ? JSON.stringify(currentEventDraft) : 'Нет'}
    Найденные конфликты (события в то же время): ${conflicts.length > 0 ? JSON.stringify(conflicts.map(c => ({summary: c.summary, start: c.start, end: c.end}))) : 'Нет'}
    Запрос пользователя: "${finalPrompt}"
  `;
  
  const userTurn = { role: 'user', parts: [{ text: userPrompt }] };
  const currentConversation = [...chatHistory, userTurn];

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: currentConversation,
        config: {
            systemInstruction: systemInstruction,
            responseMimeType: "application/json",
        }
    });

    const jsonString = response.text;
    const parsedData = JSON.parse(jsonString);
    console.log("AI Response:", parsedData);

    chatHistory.push(userTurn);
    chatHistory.push({ role: 'model', parts: [{ text: jsonString }] });

    await processAiResponse(parsedData);

  } catch (error) {
    console.error("Ошибка Gemini API:", error);
    let errorMessage = "К сожалению, произошла ошибка при обработке вашего запроса. ";
    if (error.message) {
      if (error.message.includes('Unexpected token')) {
        errorMessage += "Ассистент дал некорректный ответ. Попробуйте переформулировать запрос.";
      } else if (error.toString().includes('API key not valid')) {
        errorMessage += "Ваш Gemini API Key недействителен. Проверьте его в настройках.";
      } else {
        errorMessage += `Детали: ${error.message}`;
      }
    }
    appendMessage(errorMessage, 'ai', 'error');
    currentEventDraft = null;
    editModeEventId = null;
  } finally {
    setLoading(false);
  }
}

// --- Modals ---
function openModal(modalElement, focusElement) {
    lastFocusedElement = document.activeElement;
    modalElement.style.display = 'flex';
    modalElement.setAttribute('aria-hidden', 'false');
    setTimeout(() => modalElement.classList.add('visible'), 10);
    if (focusElement) {
        focusElement.focus();
    }
}

function closeModal(modalElement) {
    modalElement.classList.remove('visible');
    setTimeout(() => {
        modalElement.style.display = 'none';
        modalElement.setAttribute('aria-hidden', 'true');
        if (lastFocusedElement) {
            lastFocusedElement.focus();
            lastFocusedElement = null;
        }
    }, 300);
}

function openSettingsModal() {
    settingsGoogleClientIdInput.value = localStorage.getItem('GOOGLE_CLIENT_ID') || '';
    settingsGeminiApiKeyInput.value = localStorage.getItem('GEMINI_API_KEY') || '';
    openModal(settingsModal, settingsGeminiApiKeyInput);
}

function closeSettingsModal() {
    closeModal(settingsModal);
}

function openInstructionsModal(event) {
    event.preventDefault();
    const origin = window.location.origin;
    const jsOriginEl = document.getElementById('instructions-js-origin');
    const redirectUriEl = document.getElementById('instructions-redirect-uri');

    if (jsOriginEl) jsOriginEl.textContent = origin;
    if (redirectUriEl) redirectUriEl.textContent = origin;
    
    openModal(instructionsModal, closeInstructionsButton);
}

function closeInstructionsModal() {
    closeModal(instructionsModal);
}

function openCameraModal() {
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            currentStream = stream;
            cameraStreamElement.srcObject = stream;
            openModal(cameraModal, capturePhotoButton);
        })
        .catch(err => {
            console.error("Error accessing camera: ", err);
            appendMessage('Не удалось получить доступ к камере. Проверьте разрешения в браузере.', 'system', 'error');
        });
}

function closeCameraModal() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }
    closeModal(cameraModal);
    currentStream = null;
}

// --- App Initialization & Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    
    // Listen for the Google API scripts to load before trying to use them.
    document.addEventListener('gapiLoaded', () => gapi.load('client', initializeGapiClient));
    document.addEventListener('gisInitalised', initializeApiClients);

    // Check if API keys are present. If not, start the onboarding flow.
    // The actual API client initialization will be triggered by the event listeners above
    // once the necessary Google scripts are loaded, preventing a race condition.
    if (!localStorage.getItem('GOOGLE_CLIENT_ID') || !localStorage.getItem('GEMINI_API_KEY')) {
        setupOnboarding();
    }
    
    selectedDate.setHours(0, 0, 0, 0);

    settingsButton.addEventListener('click', (e) => {
        lastFocusedElement = e.currentTarget;
        openSettingsModal();
    });
    closeSettingsButton.addEventListener('click', closeSettingsModal);

    chatTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleUserInput(chatTextInput.value);
        }
    });

    micButtonChat.addEventListener('click', () => {
        if (isRecognizingSpeech) {
            recognition.stop();
        } else {
            setLoading(true);
            recognition.start();
        }
    });
    
    signOutButton.addEventListener('click', handleSignOutClick);

    saveApiKeysButton.addEventListener('click', () => {
        const googleId = settingsGoogleClientIdInput.value.trim();
        const geminiKey = settingsGeminiApiKeyInput.value.trim();

        if (!googleId || !geminiKey) {
            alert('Пожалуйста, введите оба ключа: Google Client ID и Gemini API Key.');
            return;
        }

        localStorage.setItem('GOOGLE_CLIENT_ID', googleId);
        localStorage.setItem('GEMINI_API_KEY', geminiKey);
        initializeApiClients();
        appendMessage('Ключи API сохранены.', 'system');
        closeSettingsModal();
    });
    
    cameraButtonChat.addEventListener('click', () => {
        isCameraOptionsOpen = !isCameraOptionsOpen;
        cameraOptionsMenu.style.display = isCameraOptionsOpen ? 'block' : 'none';
    });

    takePhotoOption.addEventListener('click', () => {
        isCameraOptionsOpen = false;
        cameraOptionsMenu.style.display = 'none';
        openCameraModal();
    });

    uploadPhotoOption.addEventListener('click', () => {
        isCameraOptionsOpen = false;
        cameraOptionsMenu.style.display = 'none';
        imageUploadInputChat.click();
    });

    capturePhotoButton.addEventListener('click', () => {
        const canvas = document.createElement('canvas');
        canvas.width = cameraStreamElement.videoWidth;
        canvas.height = cameraStreamElement.videoHeight;
        canvas.getContext('2d')?.drawImage(cameraStreamElement, 0, 0);
        imageBase64DataForNextSend = canvas.toDataURL('image/jpeg').split(',')[1];
        appendMessage('Фотография сделана. Теперь опишите, что вы хотите сделать.', 'system');
        closeCameraModal();
    });

    cancelCameraButton.addEventListener('click', closeCameraModal);
    
    imageUploadInputChat.addEventListener('change', (event) => {
        const target = event.target;
        const file = target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = (reader.result).split(',')[1];
                imageBase64DataForNextSend = base64String;
                appendMessage('Изображение загружено. Теперь опишите, что вы хотите сделать.', 'system');
            };
            reader.readAsDataURL(file);
        }
    });
    
    openInstructionsLinks.forEach(link => link.addEventListener('click', (e) => {
        lastFocusedElement = e.currentTarget;
        openInstructionsModal(e);
    }));
    closeInstructionsButton.addEventListener('click', closeInstructionsModal);
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal);
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.visible').forEach(closeModal);
        }
    });

    // New Calendar Panel Listeners
    prevMonthButton.addEventListener('click', () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
        renderMonthCalendar();
    });
    nextMonthButton.addEventListener('click', () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
        renderMonthCalendar();
    });
    calendarGridDays.addEventListener('click', (e) => {
        const target = e.target.closest('.day-cell');
        if (target && !target.classList.contains('other-month')) {
            displayEventsForDate(new Date(target.dataset.date + 'T00:00:00'));
        }
    });
    dailyEventsList.addEventListener('click', (e) => {
        const eventItem = e.target.closest('.event-item');
        if (!eventItem) return;

        // If an action link was clicked, let the browser handle it
        if (e.target.closest('a.event-action-button')) {
            return;
        }

        // If the edit button or any other part of the item is clicked, trigger edit
        handleEditEventStart(eventItem.dataset.calendarId, eventItem.dataset.eventId);
    });

    // Reply listeners
    messageList.addEventListener('click', (e) => {
        const replyButton = e.target.closest('.message-reply-button');
        if (replyButton) {
            const messageBubble = replyButton.parentElement.querySelector('.message-bubble');
            replyContext = messageBubble.dataset.rawText;
            chatReplyContextText.textContent = replyContext;
            chatReplyContext.style.display = 'flex';
            chatTextInput.focus();
        }
    });
    chatReplyContextClose.addEventListener('click', () => {
        replyContext = '';
        chatReplyContext.style.display = 'none';
    });

    suggestionChipsContainer.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('suggestion-chip') && target.textContent) {
            handleUserInput(target.textContent);
        }
    });

    instructionsModal.querySelectorAll('.copy-uri-button').forEach(button => {
        button.addEventListener('click', async (e) => {
            const currentButton = e.currentTarget;
            const targetId = currentButton.dataset.target;
            if (!targetId) return;

            const targetElement = document.getElementById(targetId);
            if (!targetElement?.textContent) return;

            try {
                await navigator.clipboard.writeText(targetElement.textContent);
                
                const icon = currentButton.querySelector('.material-symbols-outlined');
                if (icon) {
                    const originalIcon = icon.textContent;
                    currentButton.classList.add('copied');
                    icon.textContent = 'check';

                    setTimeout(() => {
                        currentButton.classList.remove('copied');
                        icon.textContent = originalIcon;
                    }, 2000);
                }
            } catch (err) {
                console.error('Failed to copy text: ', err);
                alert('Не удалось скопировать URI.');
            }
        });
    });
});
