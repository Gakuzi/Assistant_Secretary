

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

const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";

let tokenClient;
let gapiInited = false;
let gisInited = false;

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
const quickActionsBar = document.getElementById('quick-actions-bar');

// Calendar Integration Elements
const userProfile = document.getElementById('user-profile');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const calendarPanel = document.querySelector('.calendar-panel');
const calendarLoginPrompt = document.getElementById('calendar-login-prompt');
const upcomingEventsList = document.getElementById('upcoming-events-list');
const refreshCalendarButton = document.getElementById('refresh-calendar-button');

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


// --- Onboarding Flow ---
function showOnboardingStep(stepNumber) {
    onboardingSteps.forEach(step => step.style.display = 'none');
    const currentStep = document.getElementById(`onboarding-step-${stepNumber}`);
    if (currentStep) {
        currentStep.style.display = 'block';
    }
}

function setupOnboarding() {
    onboardingModal.style.display = 'flex';
    onboardingModal.setAttribute('aria-hidden', 'false');
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
function initializeApiClients() {
    GOOGLE_CLIENT_ID = localStorage.getItem('GOOGLE_CLIENT_ID');
    const GEMINI_API_KEY = localStorage.getItem('GEMINI_API_KEY');

    if (GEMINI_API_KEY) {
        try {
            ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        } catch (error) {
            console.error("Failed to initialize GoogleGenAI:", error);
            ai = null;
        }
    } else {
        ai = null;
    }
    
    gapiInited = false;
    gisInited = false;

    if (typeof gapi !== 'undefined') gapi.load('client', initializeGapiClient);
    if (typeof google !== 'undefined' && GOOGLE_CLIENT_ID) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: '', // defined later
        });
        gisInited = true;
    }
    maybeEnableAuthUI();
}


async function initializeGapiClient() {
  await gapi.client.init({
    discoveryDocs: DISCOVERY_DOCS,
  });
  gapiInited = true;
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
  tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) {
      console.error('Google token client error:', resp);
      appendMessage('Не удалось войти в Google. Пожалуйста, попробуйте еще раз.', 'system', 'error');
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
    await listUpcomingEvents();
    
    if (localStorage.getItem('onboardingComplete') !== 'true') {
        localStorage.setItem('onboardingComplete', 'true');
        onboardingModal.style.display = 'none';
        onboardingModal.setAttribute('aria-hidden', 'true');
    }
    closeSettingsModal();
  };

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
    upcomingEventsList.style.display = 'block';
    welcomeScreen.querySelector('.welcome-subheading').textContent = 'Чем я могу помочь вам сегодня?';
    
  } else {
    userProfile.style.display = 'none';
    
    authContainerSettings.style.display = 'block';
    signOutButton.style.display = 'none';
    settingsUserProfile.style.display = 'none';
    maybeEnableAuthUI();
    
    calendarLoginPrompt.style.display = 'block';
    upcomingEventsList.style.display = 'none';
    quickActionsBar.style.display = 'none';
    upcomingEventsList.innerHTML = '';
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
    } catch (err) {
        console.error('Error fetching calendar list', err);
        appendMessage('Не удалось загрузить список ваших календарей.', 'system', 'error');
    }
}


async function listUpcomingEvents() {
  if (!gapiInited || !gapi.client.getToken()) {
    console.log("Not signed in or GAPI not ready, can't fetch events.");
    return;
  }
  try {
    if (userCalendars.length === 0) await listUserCalendars();

    const timeMin = (new Date()).toISOString();
    
    // Create a request for each calendar
    const requests = userCalendars.map(calendar => gapi.client.calendar.events.list({
        'calendarId': calendar.id,
        'timeMin': timeMin,
        'showDeleted': false,
        'singleEvents': true,
        'maxResults': 10, // Per calendar
        'orderBy': 'startTime'
    }));
    
    const responses = await Promise.all(requests);
    
    let allEvents = [];
    responses.forEach((response, index) => {
        const calendar = userCalendars[index];
        const events = response.result.items;
        if (events) {
            events.forEach(event => {
                event.calendar = {
                    id: calendar.id,
                    summary: calendar.summary,
                    color: calendar.backgroundColor
                };
                allEvents.push(event);
            });
        }
    });

    allEvents.sort((a, b) => {
        const timeA = new Date(a.start.dateTime || a.start.date).getTime();
        const timeB = new Date(b.start.dateTime || b.start.date).getTime();
        return timeA - timeB;
    });

    const eventsToDisplay = allEvents.slice(0, 15);
    upcomingEventsList.innerHTML = ''; 

    if (eventsToDisplay.length === 0) {
      upcomingEventsList.innerHTML = '<li>Нет предстоящих событий.</li>';
      return;
    }

    eventsToDisplay.forEach((event) => {
      const start = event.start?.dateTime || event.start?.date;
      if (!start) return;

      const eventElement = document.createElement('li');
      eventElement.className = 'event-item';
      eventElement.dataset.eventId = event.id;
      eventElement.dataset.calendarId = event.calendar.id;
      eventElement.setAttribute('role', 'button');
      eventElement.setAttribute('tabindex', '0');
      eventElement.setAttribute('aria-label', `Событие: ${event.summary} в календаре ${event.calendar.summary}. Нажмите, чтобы редактировать.`);

      const startDate = new Date(start);
      const timeString = startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const dateString = startDate.toLocaleDateString('ru-RU', { weekday: 'short', month: 'long', day: 'numeric' });
      
      const attendeesHtml = (event.attendees || [])
        .filter(att => !att.resource)
        .map(att => `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(att.email)}&background=random&size=24&rounded=true" title="${att.email}" alt="Аватар ${att.email}" class="attendee-avatar">`)
        .join('');
      
      const calendarColor = event.calendar.color || '#039be5';

      eventElement.innerHTML = `
        <div class="event-color-indicator" style="background-color: ${calendarColor};"></div>
        <div class="event-details">
          <h3 class="event-item-title">${event.summary || '(Без названия)'}</h3>
          <p class="event-item-time">
              <span class="material-symbols-outlined">schedule</span>
              ${dateString}, ${timeString}
          </p>
          ${event.location ? `
          <p class="event-item-location">
              <span class="material-symbols-outlined">location_on</span>
              ${event.location}
          </p>` : ''}
          ${event.hangoutLink ? `
          <p class="event-item-meet">
              <span class="material-symbols-outlined">videocam</span>
              <a href="${event.hangoutLink}" target="_blank" rel="noopener noreferrer" class="meet-link" aria-label="Присоединиться к видеовстрече">Присоединиться</a>
          </p>` : ''}
          ${attendeesHtml ? `<div class="event-item-attendees">${attendeesHtml}</div>` : ''}
        </div>
        <div class="event-item-actions">
          <a href="${event.htmlLink}" target="_blank" rel="noopener noreferrer" class="event-action-button open-gcal" title="Открыть в Google Календаре" aria-label="Открыть в Google Календаре">
              <span class="material-symbols-outlined">open_in_new</span>
          </a>
          <button class="event-action-button delete" title="Удалить событие" aria-label="Удалить событие ${event.summary}">
              <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      `;
      upcomingEventsList.appendChild(eventElement);
    });
  } catch (err) {
    console.error('Execute error', err);
    const errorMessage = err.result?.error?.message || err.message || 'Неизвестная ошибка';
    appendMessage(`Ошибка при загрузке событий: ${errorMessage}`, 'system', 'error');
  }
}

async function createCalendarEvent(eventData) {
  if (!gapiInited || !gapi.client.getToken()) {
    appendMessage('Пожалуйста, войдите в Google, чтобы создать событие.', 'system', 'error');
    return null;
  }
  try {
    const calendarId = eventData.calendarId || 'primary';
    delete eventData.calendarId; // Don't send this property in the resource

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
    let successMessage = `Событие **"${response.result.summary}"** успешно создано!`;
    if (response.result.hangoutLink) {
        successMessage += `\n[Присоединиться к видеовстрече](${response.result.hangoutLink})`;
    }
    appendMessage(successMessage, 'system');
    await listUpcomingEvents();
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
      appendMessage(`Событие **"${response.result.summary}"** успешно обновлено!`, 'system');
      await listUpcomingEvents();
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
        await listUpcomingEvents();
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
  const isSignedIn = gapiInited && gapi.client.getToken() !== null;
  quickActionsBar.style.display = hasMessages && isSignedIn ? 'flex' : 'none';
}

function appendMessage(
  content,
  sender,
  type = 'text',
  eventData = null
) {
  const messageBubble = document.createElement('div');
  messageBubble.classList.add('message-bubble', sender);
  if (type === 'error') messageBubble.classList.add('error-message');

  let mainContentHtml = marked.parse(content);
  let eventHtml = '';

  if (type === 'confirmation_request' && eventData) {
    isWaitingForConfirmation = true;
    currentEventDraft = eventData;

    const confirmationTitle = editModeEventId 
        ? 'Подтвердите изменения в событии:' 
        : 'Подтвердите создание события:';
    const confirmButtonText = editModeEventId ? 'Да, обновить' : 'Да, создать';

    let eventDetailsHtml = `<h3>${confirmationTitle}</h3><ul>`;
    if (eventData.summary) eventDetailsHtml += `<li><strong>Название:</strong> ${eventData.summary}</li>`;
    if (eventData.start?.dateTime) eventDetailsHtml += `<li><strong>Начало:</strong> ${new Date(eventData.start.dateTime).toLocaleString('ru-RU')}</li>`;
    if (eventData.end?.dateTime) eventDetailsHtml += `<li><strong>Окончание:</strong> ${new Date(eventData.end.dateTime).toLocaleString('ru-RU')}</li>`;
    if (eventData.location) eventDetailsHtml += `<li><strong>Место:</strong> ${eventData.location}</li>`;
    if (eventData.description) eventDetailsHtml += `<li><strong>Описание:</strong> ${eventData.description.replace(/\n/g, '<br>')}</li>`;
    if (eventData.attendees && eventData.attendees.length > 0) {
        const attendeeEmails = eventData.attendees.map(att => att.email).join(', ');
        eventDetailsHtml += `<li><strong>Участники:</strong> ${attendeeEmails}</li>`;
    }
    if (eventData.conferenceData) {
        eventDetailsHtml += `<li><strong>Видеовстреча:</strong> Да (будет создана)</li>`;
    }
    eventDetailsHtml += '</ul>';

    eventDetailsHtml += `<div class="confirmation-buttons">
           <button class="confirm-event-action action-button primary">${confirmButtonText}</button>
           <button class="cancel-event-action action-button">Отмена</button>
         </div>`;
    eventHtml = eventDetailsHtml;
  }

  messageBubble.innerHTML = mainContentHtml + eventHtml;
  messageList.appendChild(messageBubble);

  if (type === 'confirmation_request') {
    messageBubble.querySelector('.confirm-event-action')?.addEventListener('click', handleConfirmEvent);
    messageBubble.querySelector('.cancel-event-action')?.addEventListener('click', handleCancelEvent);
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
      await handleListEventsAction(parsedData.listParameters);
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
      } else {
        const conflicts = await checkForConflicts(currentEventDraft, editModeEventId);
        if (conflicts.length > 0) {
            console.log("Conflicts found:", conflicts);
            await handleUserInput(lastUserPrompt, conflicts);
        } else {
            const confirmationMessage = parsedData.generalResponse || 'Вот детали события. Все верно?';
            appendMessage(confirmationMessage, 'ai', 'confirmation_request', currentEventDraft);
        }
      }
      break;

    case 'GENERAL_QUERY':
      if (parsedData.generalResponse) {
        appendMessage(parsedData.generalResponse, 'ai');
      } else {
        appendMessage('Не удалось получить осмысленный ответ. Попробуйте переформулировать.', 'ai', 'error');
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
    if (!gapiInited || !gapi.client.getToken()) {
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

async function handleListEventsAction(params = {}) {
  if (!gapiInited || !gapi.client.getToken()) {
    appendMessage('Пожалуйста, войдите в Google, чтобы просмотреть события.', 'system', 'error');
    return;
  }
  setLoading(true);
  try {
    const defaultParams = {
      'calendarId': 'primary',
      'showDeleted': false,
      'singleEvents': true,
      'maxResults': 10,
      'orderBy': 'startTime'
    };
    
    if (!params.timeMin && !params.timeMax) {
        defaultParams['timeMin'] = (new Date()).toISOString();
    }
    
    const request = { ...defaultParams, ...params };
    console.log("Listing events with params:", request);

    const response = await gapi.client.calendar.events.list(request);
    const events = response.result.items;
    
    if (!events || events.length === 0) {
        appendMessage('В указанный период событий не найдено.', 'ai');
        return;
    }

    let responseText = "Вот ваши предстоящие события:\n\n";
    events.forEach((event) => {
      const start = new Date(event.start.dateTime || event.start.date);
      responseText += `*   **${event.summary}** - ${start.toLocaleString('ru-RU')}\n`;
    });
    appendMessage(responseText, 'ai');

  } catch (err) {
    console.error('List events error', err);
    const errorMessage = err.result?.error?.message || err.message || 'Неизвестная ошибка';
    appendMessage(`Ошибка при загрузке событий: ${errorMessage}`, 'system', 'error');
  } finally {
    setLoading(false);
  }
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

  if (!ai) {
    appendMessage('Ошибка: Gemini API Key не настроен. Пожалуйста, введите его в настройках.', 'system', 'error');
    setLoading(false);
    return;
  }

  const currentDate = new Date().toISOString();
  
  const systemInstruction = `Вы — ИИ-ассистент-секретарь для управления Google Календарем. Ваша задача — проактивно помогать пользователю, анализируя контекст, предвосхищая его потребности и управляя событиями в нескольких календарях.

- Текущая дата и время: ${currentDate}.
- Всегда отвечайте в формате JSON.

**Основная Логика:**

1.  **Определение Календаря:**
    - Проанализируйте запрос ('созвон с командой', 'день рождения мамы') и выберите наиболее подходящий \`calendarId\` из списка доступных календарей, передаваемых в запросе.
    - Если контекст неоднозначен ("добавь встречу"), задайте уточняющий вопрос в \`followUpQuestion\` ("Это рабочее или личное событие?").
    - По умолчанию используйте 'primary'. Укажите выбранный \`calendarId\` в \`eventDetails\`.

2.  **Проверка Конфликтов (Важно!):**
    - В запросе пользователя может быть поле 'conflictingEvents'. Если оно не пустое, значит, предлагаемое время занято.
    - Ваша задача: Сообщить пользователю о конфликте и предложить варианты решения в \`followUpQuestion\`. Например: "В это время у вас уже запланирована встреча 'Обед с клиентом'. Все равно создать событие?".
    - **Не подтверждайте событие, пока конфликт не будет разрешен пользователем.**

3.  **Создание и Редактирование Событий:**
    - **Сбор Информации:** Соберите: \`summary\`, \`start.dateTime\`, \`end.dateTime\`, \`location\`, \`description\`. Если \`end.dateTime\` отсутствует, событие должно длиться 1 час.
    - **Видеовстречи (Google Meet):** Если упоминается 'звонок', 'созвон', 'онлайн', **автоматически** добавляйте видеовстречу: \`"conferenceData": { "createRequest": { "requestId": "..." } }\`.
    - **Участники (Attendees):** Если упоминаются люди ('с Анной'), соберите их email. Если email не указан, вежливо попросите его в \`followUpQuestion\`. Формат: \`"attendees": [{ "email": "user@example.com" }]\`.
    - **Документы (Google Drive):** Если упоминаются 'отчет', 'презентация', предложите пользователю вставить ссылку на файл в \`followUpQuestion\`, чтобы вы добавили её в \`description\`.

4.  **Подтверждение:**
    - Когда вся информация собрана и конфликтов нет, НЕ задавайте \`followUpQuestion\`.
    - Предоставьте полный объект события для финального подтверждения. В \`generalResponse\` дайте краткое резюме ("Создаю рабочую встречу с видеозвонком и Анной. Верно?").

**Actions:** \`CREATE_EVENT\`, \`EDIT_EVENT\`, \`LIST_EVENTS\`, \`GENERAL_QUERY\`.`;

  const userPrompt = `
    Доступные календари: ${JSON.stringify(userCalendars.map(c => ({id: c.id, summary: c.summary})))}
    Текущий контекст (редактируемое событие): ${editModeEventId ? JSON.stringify(currentEventDraft) : 'Нет'}
    Найденные конфликты (события в то же время): ${conflicts.length > 0 ? JSON.stringify(conflicts.map(c => ({summary: c.summary, start: c.start, end: c.end}))) : 'Нет'}
    Запрос пользователя: "${userInput}"
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
    if (focusElement) {
        focusElement.focus();
    }
    modalElement.classList.add('visible');
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
    
    document.addEventListener('gapiLoaded', () => gapi.load('client', initializeGapiClient));
    document.addEventListener('gisInitalised', initializeApiClients);

    initializeApiClients();

    if (localStorage.getItem('onboardingComplete') !== 'true') {
        if (!localStorage.getItem('GOOGLE_CLIENT_ID') || !localStorage.getItem('GEMINI_API_KEY')) {
            setupOnboarding();
        }
    }

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
    
    refreshCalendarButton.addEventListener('click', listUpcomingEvents);
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
            reader.readDataURL(file);
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
            document.querySelectorAll('.modal').forEach(modal => {
                if (modal.classList.contains('visible')) {
                    closeModal(modal);
                }
            });
        }
    });

    upcomingEventsList.addEventListener('click', (e) => {
        const target = e.target;
        const eventItem = target.closest('.event-item');
        if (!eventItem) return;

        const eventId = eventItem.dataset.eventId;
        const calendarId = eventItem.dataset.calendarId;
        if (!eventId || !calendarId) return;

        const deleteButton = target.closest('.delete');
        const gcalLink = target.closest('.open-gcal');
        const meetLink = target.closest('.meet-link');
        
        if (deleteButton) {
             if (confirm('Вы уверены, что хотите удалить это событие?')) {
                deleteCalendarEvent(calendarId, eventId);
            }
            return;
        }

        if (gcalLink || meetLink) {
            return;
        }
        
        handleEditEventStart(calendarId, eventId);
    });

    upcomingEventsList.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const target = e.target;
            if (target.classList.contains('event-item')) {
                e.preventDefault();
                const eventId = target.dataset.eventId;
                const calendarId = target.dataset.calendarId;
                if (eventId && calendarId) {
                    handleEditEventStart(calendarId, eventId);
                }
            }
        }
    });
    
    suggestionChipsContainer.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('suggestion-chip') && target.textContent) {
            handleUserInput(target.textContent);
        }
    });

    quickActionsBar.addEventListener('click', (e) => {
        const target = e.target;
        const action = target.closest('.quick-action-chip')?.dataset.action;
        if (!action) return;

        let prompt = '';
        switch(action) {
            case 'create':
                prompt = 'Создай новое событие';
                break;
            case 'today':
                prompt = 'Покажи мое расписание на сегодня';
                break;
            case 'week':
                prompt = 'Что у меня на этой неделе?';
                break;
        }
        handleUserInput(prompt);
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
