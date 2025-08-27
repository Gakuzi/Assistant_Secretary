/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, GenerateContentResponse, Part } from '@google/genai';
import { marked } from 'marked';

// FIX: Add declarations for gapi and google to resolve TypeScript errors
// as their types are loaded from external scripts.
declare const gapi: any;
declare const google: any;

// --- API Config ---
// FIX: Per @google/genai guidelines, the API key must be read from process.env.API_KEY
// and the AI client should be initialized once.
// We assume process.env.API_KEY is set in the build environment.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

// Google Client ID for Calendar API is managed via UI and localStorage.
let GOOGLE_CLIENT_ID: string | null = null;

const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

// --- DOM Elements ---
const messageList = document.getElementById('message-list') as HTMLElement;
const chatTextInput = document.getElementById('chat-text-input') as HTMLTextAreaElement;
const micButtonChat = document.getElementById('mic-button-chat') as HTMLButtonElement;
const cameraButtonChat = document.getElementById('camera-button-chat') as HTMLButtonElement;
const cameraOptionsMenu = document.getElementById('camera-options-menu') as HTMLDivElement;
const takePhotoOption = document.getElementById('take-photo-option') as HTMLButtonElement;
const uploadPhotoOption = document.getElementById('upload-photo-option') as HTMLButtonElement;
const imageUploadInputChat = document.getElementById('image-upload-input-chat') as HTMLInputElement;
const loadingIndicator = document.getElementById('loading-indicator') as HTMLElement;
const cameraModal = document.getElementById('camera-modal') as HTMLElement;
const cameraStreamElement = document.getElementById('camera-stream') as HTMLVideoElement;
const capturePhotoButton = document.getElementById('capture-photo-button') as HTMLButtonElement;
const cancelCameraButton = document.getElementById('cancel-camera-button') as HTMLButtonElement;
const welcomeScreen = document.getElementById('welcome-screen') as HTMLElement;
const suggestionChipsContainer = document.getElementById('suggestion-chips-container') as HTMLElement;
const quickActionsBar = document.getElementById('quick-actions-bar') as HTMLElement;

// Calendar Integration Elements
const userProfile = document.getElementById('user-profile') as HTMLElement;
const userAvatar = document.getElementById('user-avatar') as HTMLImageElement;
const userName = document.getElementById('user-name') as HTMLElement;
const calendarPanel = document.querySelector('.calendar-panel') as HTMLElement;
const calendarLoginPrompt = document.getElementById('calendar-login-prompt') as HTMLElement;
const upcomingEventsList = document.getElementById('upcoming-events-list') as HTMLElement;
const refreshCalendarButton = document.getElementById('refresh-calendar-button') as HTMLButtonElement;

// Settings Modal Elements
const settingsButton = document.getElementById('settings-button') as HTMLButtonElement;
const settingsModal = document.getElementById('settings-modal') as HTMLElement;
const closeSettingsButton = document.getElementById('close-settings-button') as HTMLButtonElement;
const settingsUserProfile = document.getElementById('settings-user-profile') as HTMLElement;
const settingsUserAvatar = document.getElementById('settings-user-avatar') as HTMLImageElement;
const settingsUserName = document.getElementById('settings-user-name') as HTMLElement;
const settingsUserEmail = document.getElementById('settings-user-email') as HTMLElement;
const signOutButton = document.getElementById('sign-out-button') as HTMLButtonElement;
const authContainerSettings = document.getElementById('auth-container-settings') as HTMLElement;
const settingsGeminiKeyInput = document.getElementById('settings-gemini-api-key') as HTMLInputElement;
const settingsGoogleClientIdInput = document.getElementById('settings-google-client-id') as HTMLInputElement;
const saveApiKeysButton = document.getElementById('save-api-keys-button') as HTMLButtonElement;


// Onboarding Modal Elements
const onboardingModal = document.getElementById('onboarding-modal') as HTMLElement;
const onboardingSteps = document.querySelectorAll('.onboarding-step');
const nextButton1 = document.getElementById('onboarding-next-1') as HTMLButtonElement;
const nextButton2 = document.getElementById('onboarding-next-2') as HTMLButtonElement;
const backButton2 = document.getElementById('onboarding-back-2') as HTMLButtonElement;
const backButton3 = document.getElementById('onboarding-back-3') as HTMLButtonElement;
const geminiApiKeyInput = document.getElementById('gemini-api-key-input') as HTMLInputElement;
const googleClientIdInput = document.getElementById('google-client-id-input') as HTMLInputElement;
const authContainerOnboarding = document.getElementById('auth-container') as HTMLElement;


// --- State Variables ---
let currentEventDraft: any | null = null;
let editModeEventId: string | null = null;
let isWaitingForConfirmation = false;
let isRecognizingSpeech = false;
let isCameraOptionsOpen = false;
let userLocation: { latitude: number, longitude: number } | null = null;
let currentStream: MediaStream | null = null;
let imageBase64DataForNextSend: string | null = null;


// --- Onboarding Flow ---
function showOnboardingStep(stepNumber: number) {
    onboardingSteps.forEach(step => (step as HTMLElement).style.display = 'none');
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
        // FIX: Gemini API key is now handled by environment variable, remove related UI logic.
        const googleId = googleClientIdInput.value.trim();

        if (!googleId) {
            alert('Пожалуйста, введите ваш Google Client ID.');
            return;
        }

        localStorage.setItem('GOOGLE_CLIENT_ID', googleId);
        
        // Re-initialize with new keys
        initializeApiClients();
        showOnboardingStep(3);
    };

    backButton3.onclick = () => showOnboardingStep(2);
}

// --- Google API & Authentication ---
function initializeApiClients() {
    GOOGLE_CLIENT_ID = localStorage.getItem('GOOGLE_CLIENT_ID');
    
    // Reset auth state in case keys changed
    gapiInited = false;
    gisInited = false;

    // Trigger re-initialization of GAPI/GIS if they are already loaded
    // FIX: Use direct access to `gapi` and `google` as they are declared globally for this module.
    // This resolves the TypeScript error "Property 'gapi' does not exist on type 'Window'".
    if (gapi) gapi.load('client', initializeGapiClient);
    if (google && GOOGLE_CLIENT_ID) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID!,
            scope: SCOPES,
            callback: '', // defined later
        });
        gisInited = true;
    }
    maybeEnableAuthUI();
}


async function initializeGapiClient() {
  await gapi.client.init({
    // apiKey is not strictly needed for OAuth flow but good for discovery
    discoveryDocs: DISCOVERY_DOCS,
  });
  gapiInited = true;
  maybeEnableAuthUI();
}

function maybeEnableAuthUI() {
  if (gapiInited && gisInited && GOOGLE_CLIENT_ID) {
    const signInButtonHtml = `<button class="action-button primary">Войти через Google</button>`;
    
    // Add button to both onboarding and settings modals
    authContainerOnboarding.innerHTML = signInButtonHtml;
    authContainerSettings.innerHTML = signInButtonHtml;
    
    authContainerOnboarding.querySelector('button')!.onclick = handleAuthClick;
    authContainerSettings.querySelector('button')!.onclick = handleAuthClick;
    
    updateWelcomeScreenVisibility();
  }
}


function handleAuthClick() {
  if (!gisInited || !tokenClient) {
    console.error("Google Identity Services client not initialized.");
    appendMessage("Ошибка входа: сервис аутентификации еще не готов.", 'system', 'error');
    return;
  }
  tokenClient.callback = async (resp: any) => {
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
    await listUpcomingEvents();
    
    // Onboarding complete!
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
      updateSignInStatus(false);
      closeSettingsModal();
    });
  }
}

function updateSignInStatus(isSignedIn: boolean, userInfo: any = null) {
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
    welcomeScreen.querySelector('.welcome-subheading')!.textContent = 'Чем я могу помочь вам сегодня?';
    
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
    welcomeScreen.querySelector('.welcome-subheading')!.textContent = 'Войдите в свой аккаунт Google, чтобы начать управлять календарем.';
  }
  updateWelcomeScreenVisibility();
}


// --- Calendar Functionality ---

async function listUpcomingEvents() {
  if (!gapiInited || !gapi.client.getToken()) {
    console.log("Not signed in or GAPI not ready, can't fetch events.");
    return;
  }
  try {
    const request = {
      'calendarId': 'primary',
      'timeMin': (new Date()).toISOString(),
      'showDeleted': false,
      'singleEvents': true,
      'maxResults': 10,
      'orderBy': 'startTime'
    };
    const response = await gapi.client.calendar.events.list(request);
    const events = response.result.items;
    upcomingEventsList.innerHTML = ''; // Clear previous list

    if (!events || events.length == 0) {
      upcomingEventsList.innerHTML = '<li>Нет предстоящих событий.</li>';
      return;
    }

    events.forEach((event: any) => {
      const start = event.start?.dateTime || event.start?.date;
      if (!start) return;

      const eventElement = document.createElement('li');
      eventElement.className = 'event-item';

      const startDate = new Date(start);
      const timeString = startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const dateString = startDate.toLocaleDateString('ru-RU', { weekday: 'short', month: 'long', day: 'numeric' });

      eventElement.innerHTML = `
        <div class="event-item-header">
            <h3 class="event-item-title">${event.summary || '(Без названия)'}</h3>
        </div>
        <p class="event-item-time">
            <span class="material-symbols-outlined">schedule</span>
            ${dateString}, ${timeString}
        </p>
        ${event.location ? `
        <p class="event-item-location">
            <span class="material-symbols-outlined">location_on</span>
            ${event.location}
        </p>` : ''}
        <div class="event-item-actions">
            <button class="event-action-button edit" data-event-id="${event.id}">Изменить</button>
            <button class="event-action-button delete" data-event-id="${event.id}">Удалить</button>
        </div>
      `;
      upcomingEventsList.appendChild(eventElement);
    });
  } catch (err: any) {
    console.error('Execute error', err);
    appendMessage(`Ошибка при загрузке событий: ${err.message}`, 'system', 'error');
  }
}

async function createCalendarEvent(eventData: any) {
  if (!gapiInited || !gapi.client.getToken()) {
    appendMessage('Пожалуйста, войдите в Google, чтобы создать событие.', 'system', 'error');
    return;
  }
  try {
    const response = await gapi.client.calendar.events.insert({
      'calendarId': 'primary',
      'resource': eventData
    });
    console.log('Event created: ', response.result);
    appendMessage(`Событие **"${response.result.summary}"** успешно создано!`, 'system');
    await listUpcomingEvents(); // Refresh the list
    return response.result;
  } catch (err: any) {
    console.error('Execute error', err);
    appendMessage(`Ошибка при создании события: ${err.message}`, 'system', 'error');
    return null;
  }
}

async function updateCalendarEvent(eventId: string, eventData: any) {
    if (!gapiInited || !gapi.client.getToken()) {
      appendMessage('Пожалуйста, войдите в Google, чтобы обновить событие.', 'system', 'error');
      return;
    }
    try {
      const response = await gapi.client.calendar.events.patch({
        'calendarId': 'primary',
        'eventId': eventId,
        'resource': eventData
      });
      console.log('Event updated: ', response.result);
      appendMessage(`Событие **"${response.result.summary}"** успешно обновлено!`, 'system');
      await listUpcomingEvents();
      return response.result;
    } catch (err: any) {
      console.error('Execute error', err);
      appendMessage(`Ошибка при обновлении события: ${err.message}`, 'system', 'error');
      return null;
    }
  }

async function deleteCalendarEvent(eventId: string) {
    if (!gapiInited || !gapi.client.getToken()) return;
    try {
        await gapi.client.calendar.events.delete({
            'calendarId': 'primary',
            'eventId': eventId
        });
        appendMessage('Событие успешно удалено.', 'system');
        await listUpcomingEvents();
    } catch (err: any) {
        console.error('Delete error', err);
        appendMessage(`Ошибка при удалении события: ${err.message}`, 'system', 'error');
    }
}


// --- Speech Recognition ---
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
let recognition: any | null = null;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = 'ru-RU';
  recognition.interimResults = false;

  recognition.onstart = () => { isRecognizingSpeech = true; micButtonChat.classList.add('active'); };
  recognition.onresult = (event: any) => { handleUserInput(event.results[0][0].transcript); };
  recognition.onerror = (event: any) => { console.error('Ошибка распознавания речи:', event.error); };
  recognition.onend = () => { isRecognizingSpeech = false; micButtonChat.classList.remove('active'); setLoading(false); };
} else {
  console.warn('Распознавание речи не поддерживается этим браузером.');
  if (micButtonChat) micButtonChat.disabled = true;
}


// --- UI Helper Functions ---
function setLoading(isLoading: boolean) {
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
  content: string,
  sender: 'user' | 'ai' | 'system',
  type: 'text' | 'confirmation_request' | 'error' = 'text',
  eventData: any = null
) {
  const messageBubble = document.createElement('div');
  messageBubble.classList.add('message-bubble', sender);
  if (type === 'error') messageBubble.classList.add('error-message');

  let mainContentHtml = marked.parse(content) as string;
  let eventHtml = '';

  if (type === 'confirmation_request' && eventData) {
    isWaitingForConfirmation = true;
    currentEventDraft = eventData; // Ensure draft is set before confirmation

    const confirmationTitle = editModeEventId 
        ? 'Подтвердите изменения в событии:' 
        : 'Подтвердите создание события:';
    const confirmButtonText = editModeEventId ? 'Да, обновить' : 'Да, создать';

    let eventDetailsHtml = `<h3>${confirmationTitle}</h3><ul>`;
    if (eventData.summary) eventDetailsHtml += `<li><strong>Название:</strong> ${eventData.summary}</li>`;
    if (eventData.start?.dateTime) eventDetailsHtml += `<li><strong>Начало:</strong> ${new Date(eventData.start.dateTime).toLocaleString('ru-RU')}</li>`;
    if (eventData.end?.dateTime) eventDetailsHtml += `<li><strong>Окончание:</strong> ${new Date(eventData.end.dateTime).toLocaleString('ru-RU')}</li>`;
    if (eventData.location) eventDetailsHtml += `<li><strong>Место:</strong> ${eventData.location}</li>`;
    if (eventData.description) eventDetailsHtml += `<li><strong>Описание:</strong> ${eventData.description}</li>`;
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

async function processAiResponse(parsedData: any) {
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
      if (parsedData.followUpQuestion) {
        appendMessage(parsedData.followUpQuestion, 'ai');
      } else {
        appendMessage('Вот детали события. Все верно?', 'ai', 'confirmation_request', currentEventDraft);
      }
      break;

    case 'GENERAL_QUERY':
      if (parsedData.generalResponse) {
        appendMessage(parsedData.generalResponse, 'ai');
      } else {
        appendMessage('Не удалось получить осмысленный ответ. Попробуйте переформулировать.', 'ai', 'error');
      }
      currentEventDraft = null;
      editModeEventId = null;
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
          await updateCalendarEvent(editModeEventId, currentEventDraft);
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
  appendMessage('Чем еще могу помочь?', 'ai');
}

function handleCancelEvent() {
  const action = editModeEventId ? 'Редактирование' : 'Создание';
  appendMessage(`${action} события отменено.`, 'system');
  currentEventDraft = null;
  editModeEventId = null;
  isWaitingForConfirmation = false;
  appendMessage('Чем могу помочь?', 'ai');
}

async function handleEditEventStart(eventId: string) {
    if (!gapiInited || !gapi.client.getToken()) {
        appendMessage('Пожалуйста, войдите, чтобы редактировать события.', 'system', 'error');
        return;
    }
    setLoading(true);
    try {
        const response = await gapi.client.calendar.events.get({
            calendarId: 'primary',
            eventId: eventId,
        });
        const event = response.result;
        
        currentEventDraft = {
            summary: event.summary,
            start: event.start,
            end: event.end,
            location: event.location,
            description: event.description
        };
        editModeEventId = eventId;
        isWaitingForConfirmation = false;

        appendMessage(`Редактируем событие: **"${event.summary}"**. Что вы хотите изменить?`, 'ai');
    } catch (err: any) {
        console.error('Error fetching event for edit:', err);
        appendMessage(`Не удалось загрузить событие для редактирования: ${err.message}`, 'system', 'error');
        currentEventDraft = null;
        editModeEventId = null;
    } finally {
        setLoading(false);
    }
}

async function handleListEventsAction(params: any = {}) {
  if (!gapiInited || !gapi.client.getToken()) {
    appendMessage('Пожалуйста, войдите в Google, чтобы просмотреть события.', 'system', 'error');
    return;
  }
  setLoading(true);
  try {
    const defaultParams: { [key: string]: any } = {
      'calendarId': 'primary',
      'showDeleted': false,
      'singleEvents': true,
      'maxResults': 10,
      'orderBy': 'startTime'
    };
    
    // Use current time if not specified by AI
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
    events.forEach((event: any) => {
      const start = new Date(event.start.dateTime || event.start.date);
      responseText += `*   **${event.summary}** - ${start.toLocaleString('ru-RU')}\n`;
    });
    appendMessage(responseText, 'ai');

  } catch (err: any) {
    console.error('List events error', err);
    appendMessage(`Ошибка при загрузке событий: ${err.message}`, 'system', 'error');
  } finally {
    setLoading(false);
  }
}

async function handleUserInput(text: string) {
  const userInput = text.trim();
  if (userInput === '') return;

  appendMessage(userInput, 'user');
  chatTextInput.value = '';
  setLoading(true);

  if (isWaitingForConfirmation) {
      appendMessage('Понял, вношу изменения. Что еще?', 'ai');
      isWaitingForConfirmation = false; 
  }

  const currentDate = new Date().toISOString();
  
  const systemInstruction = `Вы — ИИ-ассистент для управления Google Календарем. Ваша задача — помочь пользователю создавать, редактировать, просматривать и удалять события.
- Текущая дата и время: ${currentDate}.
- Всегда отвечайте в формате JSON.
- Для создания или редактирования события, соберите всю необходимую информацию: название (summary), дата и время начала (start.dateTime), дата и время окончания (end.dateTime), место (location) и описание (description).
- Если информация неполная, задавайте уточняющие вопросы в поле 'followUpQuestion'.
- Если пользователь хочет просмотреть события, используйте action 'LIST_EVENTS' и укажите параметры 'timeMin' и 'timeMax' в формате ISO 8601.
- Если пользователь просто общается, используйте action 'GENERAL_QUERY' и дайте ответ в 'generalResponse'.
- Если пользователь подтверждает создание/редактирование, а все данные уже есть, не задавайте 'followUpQuestion'.
- Для ответа всегда используйте один из следующих actions: 'CREATE_EVENT', 'EDIT_EVENT', 'LIST_EVENTS', 'GENERAL_QUERY'.
- Если пользователь хочет изменить существующее событие, сначала соберите информацию об изменениях, а затем представьте полный обновленный объект события.

Пример JSON ответа:
{
  "action": "CREATE_EVENT",
  "eventDetails": {
    "summary": "Командный митинг",
    "start": { "dateTime": "2024-09-25T10:00:00+03:00", "timeZone": "Europe/Moscow" },
    "end": { "dateTime": "2024-09-25T11:00:00+03:00", "timeZone": "Europe/Moscow" }
  },
  "followUpQuestion": "Где будет проходить встреча?",
  "generalResponse": null
}`;

  const userPrompt = `
    Текущий контекст (редактируемое событие, если есть): ${editModeEventId ? JSON.stringify(currentEventDraft) : 'Нет'}
    Запрос пользователя: "${userInput}"
  `;

  try {
    // FIX: Per Gemini guidelines, `ai` client is now a const initialized at the top,
    // so no need to check for its existence here.
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: userPrompt,
        config: {
            systemInstruction: systemInstruction,
            responseMimeType: "application/json",
        }
    });

    const jsonString = response.text;
    const parsedData = JSON.parse(jsonString);
    console.log("AI Response:", parsedData);

    await processAiResponse(parsedData);

  } catch (error: any) {
    console.error("Ошибка Gemini API:", error);
    let errorMessage = "К сожалению, произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте еще раз.";
    if (error.message) {
      // Check for common JSON parsing error from Gemini
      if (error.message.includes('Unexpected token')) {
        errorMessage = "Получен некорректный ответ от ассистента. Пожалуйста, попробуйте переформулировать ваш запрос.";
      } else {
        errorMessage += `\n\n*Детали: ${error.message}*`;
      }
    }
    appendMessage(errorMessage, 'ai', 'error');
    currentEventDraft = null;
    editModeEventId = null;
  } finally {
    setLoading(false);
  }
}

// --- App Initialization & Event Listeners ---
function openSettingsModal() {
    // FIX: Gemini API key is now handled by environment variable, remove related UI logic.
    settingsGoogleClientIdInput.value = localStorage.getItem('GOOGLE_CLIENT_ID') || '';
    settingsModal.style.display = 'flex';
    settingsModal.setAttribute('aria-hidden', 'false');
}

function closeSettingsModal() {
    settingsModal.style.display = 'none';
    settingsModal.setAttribute('aria-hidden', 'true');
}

function handleSaveApiKeys() {
    // FIX: Gemini API key is now handled by environment variable, remove related UI logic.
    const googleId = settingsGoogleClientIdInput.value.trim();

    if (!googleId) {
        alert('Пожалуйста, введите ваш Google Client ID.');
        return;
    }
    
    localStorage.setItem('GOOGLE_CLIENT_ID', googleId);
    
    initializeApiClients(); // Re-initialize with new keys
    appendMessage('Ключи API успешно сохранены и применены.', 'system');
    closeSettingsModal();
}

document.addEventListener('DOMContentLoaded', () => {
  // Check if onboarding is complete
  if (localStorage.getItem('onboardingComplete') !== 'true') {
      setupOnboarding();
  } else {
      initializeApiClients();
  }
  
  // Custom event listeners for Google script loading
  document.addEventListener('gapiLoaded', initializeGapiClient);
  document.addEventListener('gisInitalised', () => {
    if (!GOOGLE_CLIENT_ID) {
        console.warn("Google Client ID не установлен, инициализация GIS отложена.");
        return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: '',
    });
    gisInited = true;
    maybeEnableAuthUI();
  });

  // --- Event Listeners ---
  chatTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleUserInput(chatTextInput.value);
    }
  });

  micButtonChat.addEventListener('click', () => {
    if (!recognition) return;
    if (isRecognizingSpeech) {
      recognition.stop();
    } else {
      setLoading(true);
      recognition.start();
    }
  });

  suggestionChipsContainer.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('suggestion-chip')) {
      handleUserInput(target.textContent || '');
    }
  });

  quickActionsBar.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest('.quick-action-chip');
      if (button) {
          const action = button.getAttribute('data-action');
          let prompt = '';
          if (action === 'create') prompt = 'Создай новое событие';
          if (action === 'today') prompt = 'Какие у меня планы на сегодня?';
          if (action === 'week') prompt = 'Покажи мое расписание на эту неделю';
          if (prompt) handleUserInput(prompt);
      }
  });
  
  upcomingEventsList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const eventId = target.dataset.eventId;
      if (!eventId) return;

      if (target.classList.contains('edit')) {
          handleEditEventStart(eventId);
      } else if (target.classList.contains('delete')) {
          if (confirm('Вы уверены, что хотите удалить это событие?')) {
              deleteCalendarEvent(eventId);
          }
      }
  });
  
  refreshCalendarButton.addEventListener('click', listUpcomingEvents);

  // Settings Modal
  settingsButton.addEventListener('click', openSettingsModal);
  closeSettingsButton.addEventListener('click', closeSettingsModal);
  signOutButton.addEventListener('click', handleSignOutClick);
  saveApiKeysButton.addEventListener('click', handleSaveApiKeys);

  // Close modals on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettingsModal();
      cameraModal.style.display = 'none';
      cameraModal.setAttribute('aria-hidden', 'true');
    }
  });

  // Camera UI (functionality not fully implemented)
  cameraButtonChat.addEventListener('click', () => {
      isCameraOptionsOpen = !isCameraOptionsOpen;
      cameraOptionsMenu.style.display = isCameraOptionsOpen ? 'block' : 'none';
  });

  uploadPhotoOption.addEventListener('click', () => {
    imageUploadInputChat.click();
    isCameraOptionsOpen = false;
    cameraOptionsMenu.style.display = 'none';
  });

  // Hide camera menu when clicking outside
  document.addEventListener('click', (e) => {
      if (!cameraButtonChat.contains(e.target as Node) && !cameraOptionsMenu.contains(e.target as Node)) {
          isCameraOptionsOpen = false;
          cameraOptionsMenu.style.display = 'none';
      }
  });
  
  updateWelcomeScreenVisibility();
});
