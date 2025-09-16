// PWA Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration);
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}

// Database setup using IndexedDB
class SurveyDB {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SurveyDB', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Surveys store
        if (!db.objectStoreNames.contains('surveys')) {
          const surveyStore = db.createObjectStore('surveys', { keyPath: 'id', autoIncrement: true });
          surveyStore.createIndex('name', 'name', { unique: false });
        }
        
        // Responses store
        if (!db.objectStoreNames.contains('responses')) {
          const responseStore = db.createObjectStore('responses', { keyPath: 'id', autoIncrement: true });
          responseStore.createIndex('surveyId', 'surveyId', { unique: false });
          responseStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  isReady() {
    return this.db !== null;
  }

  async saveSurvey(survey) {
    const transaction = this.db.transaction(['surveys'], 'readwrite');
    const store = transaction.objectStore('surveys');
    return store.add(survey);
  }

  async getAllSurveys() {
    const transaction = this.db.transaction(['surveys'], 'readonly');
    const store = transaction.objectStore('surveys');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getSurvey(id) {
    const transaction = this.db.transaction(['surveys'], 'readonly');
    const store = transaction.objectStore('surveys');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteSurvey(id) {
    const transaction = this.db.transaction(['surveys', 'responses'], 'readwrite');
    const surveyStore = transaction.objectStore('surveys');
    const responseStore = transaction.objectStore('responses');
    
    // Delete survey
    surveyStore.delete(id);
    
    // Delete all responses for this survey
    const responseIndex = responseStore.index('surveyId');
    const responseRequest = responseIndex.getAll(id);
    responseRequest.onsuccess = () => {
      responseRequest.result.forEach(response => {
        responseStore.delete(response.id);
      });
    };
    
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async saveResponse(surveyId, responseData) {
    const response = {
      surveyId: surveyId,
      data: responseData,
      timestamp: new Date().toISOString()
    };
    
    const transaction = this.db.transaction(['responses'], 'readwrite');
    const store = transaction.objectStore('responses');
    return store.add(response);
  }

  async getResponses(surveyId) {
    const transaction = this.db.transaction(['responses'], 'readonly');
    const store = transaction.objectStore('responses');
    const index = store.index('surveyId');
    return new Promise((resolve, reject) => {
      const request = index.getAll(surveyId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clearResponses(surveyId) {
    const transaction = this.db.transaction(['responses'], 'readwrite');
    const store = transaction.objectStore('responses');
    const index = store.index('surveyId');
    const request = index.getAll(surveyId);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        request.result.forEach(response => {
          store.delete(response.id);
        });
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Initialize database
let surveyDB = null;

// Application state
let currentSurvey = null;
let currentSurveyId = null;
let responseCards = [];
let sessionResponseCount = 0;

// Initialize database and start the app
async function initializeApp() {
  try {
    surveyDB = new SurveyDB();
    await surveyDB.init();
    console.log('Database initialized successfully');
    
    // Now that database is ready, show the surveys page
    showPage('surveys');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    alert('Failed to initialize database. Please refresh the page.');
  }
}

// DOM elements
const pages = {
  surveys: document.getElementById('surveys-page'),
  create: document.getElementById('create-page'),
  load: document.getElementById('load-page'),
  conduct: document.getElementById('conduct-page')
};

const navButtons = {
  surveys: document.getElementById('nav-surveys'),
  create: document.getElementById('nav-create'),
  load: document.getElementById('nav-load')
};

// Navigation
function showPage(pageName) {
  Object.values(pages).forEach(page => page.classList.add('hidden'));
  pages[pageName].classList.remove('hidden');
  
  if (pageName === 'surveys') {
    loadSurveys();
  }
}

// Event listeners for navigation
navButtons.surveys.addEventListener('click', () => showPage('surveys'));
navButtons.create.addEventListener('click', () => showPage('create'));
navButtons.load.addEventListener('click', () => showPage('load'));

// Survey Management
async function loadSurveys() {
  if (!surveyDB) {
    console.error('Database not initialized');
    return;
  }
  
  try {
    const surveys = await surveyDB.getAllSurveys();
    const surveysList = document.getElementById('surveys-list');
    const noSurveys = document.getElementById('no-surveys');
    
    if (surveys.length === 0) {
      surveysList.innerHTML = '';
      noSurveys.classList.remove('hidden');
      return;
    }
    
    noSurveys.classList.add('hidden');
    surveysList.innerHTML = (await Promise.all(surveys.map(async survey => {
      const responses = await surveyDB.getResponses(survey.id);
      return `
        <div class="bg-white shadow rounded-lg p-6">
          <div class="flex justify-between items-start">
            <div>
              <h3 class="text-lg font-medium text-gray-900">${survey.name}</h3>
              <p class="text-sm text-gray-500">${survey.questions.length} questions • ${responses.length} responses</p>
              <p class="text-xs text-gray-400">Created: ${new Date(survey.createdAt).toLocaleDateString()}</p>
            </div>
            <div class="flex space-x-2">
              <button onclick="downloadSurveyConfig(${survey.id})" 
                      class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors">
                Download Config
              </button>
              <button onclick="conductSurvey(${survey.id})" 
                      class="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition-colors">
                Conduct
              </button>
              <button onclick="downloadResponses(${survey.id})" 
                      class="bg-purple-600 text-white px-3 py-1 rounded text-sm hover:bg-purple-700 transition-colors">
                Download Responses
              </button>
              <button onclick="clearResponses(${survey.id})" 
                      class="bg-yellow-600 text-white px-3 py-1 rounded text-sm hover:bg-yellow-700 transition-colors">
                Clear Responses
              </button>
              <button onclick="deleteSurvey(${survey.id})" 
                      class="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      `;
    }))).join('');
  } catch (error) {
    console.error('Error loading surveys:', error);
    alert('Error loading surveys');
  }
}

async function downloadSurveyConfig(surveyId) {
  if (!surveyDB) {
    console.error('Database not initialized');
    return;
  }
  
  try {
    const survey = await surveyDB.getSurvey(surveyId);
    if (!survey) {
      alert('Survey not found');
      return;
    }
    
    const dataStr = JSON.stringify(survey, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `${survey.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_config.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading survey config:', error);
    alert('Error downloading survey config');
  }
}

async function conductSurvey(surveyId) {
  if (!surveyDB) {
    console.error('Database not initialized');
    return;
  }
  
  try {
    const survey = await surveyDB.getSurvey(surveyId);
    if (!survey) {
      alert('Survey not found');
      return;
    }
    
    currentSurvey = survey;
    currentSurveyId = surveyId;
    responseCards = [];
    sessionResponseCount = 0; // Reset session counter
    
    document.getElementById('conduct-survey-title').textContent = `Conduct Survey: ${survey.name}`;
    document.getElementById('response-cards-container').innerHTML = '';
    document.getElementById('no-cards').classList.remove('hidden');
    
    // Update session response counter
    updateSessionResponseCounter();
    
    showPage('conduct');
  } catch (error) {
    console.error('Error loading survey for conduction:', error);
    alert('Error loading survey');
  }
}

async function deleteSurvey(surveyId) {
  if (!surveyDB) {
    console.error('Database not initialized');
    return;
  }
  
  if (!confirm('Are you sure you want to delete this survey? This will also delete all associated response data.')) {
    return;
  }
  
  try {
    await surveyDB.deleteSurvey(surveyId);
    loadSurveys();
  } catch (error) {
    console.error('Error deleting survey:', error);
    alert('Error deleting survey');
  }
}

async function downloadResponses(surveyId) {
  if (!surveyDB) {
    console.error('Database not initialized');
    return;
  }
  
  try {
    const responses = await surveyDB.getResponses(surveyId);
    const survey = await surveyDB.getSurvey(surveyId);
    
    if (responses.length === 0) {
      alert('No responses found for this survey');
      return;
    }
    
    // Convert to CSV
    const csv = convertResponsesToCSV(survey, responses);
    const dataBlob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `${survey.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_responses.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading responses:', error);
    alert('Error downloading responses');
  }
}

async function clearResponses(surveyId) {
  if (!surveyDB) {
    console.error('Database not initialized');
    return;
  }
  
  if (!confirm('Are you sure you want to clear all response data for this survey?')) {
    return;
  }
  
  try {
    await surveyDB.clearResponses(surveyId);
    alert('Response data cleared successfully');
  } catch (error) {
    console.error('Error clearing responses:', error);
    alert('Error clearing responses');
  }
}

function convertResponsesToCSV(survey, responses) {
  const headers = ['Response ID', 'Timestamp'];
  survey.questions.forEach((question, index) => {
    headers.push(`Q${index + 1}: ${question.text}`);
  });
  
  const rows = responses.map(response => {
    const row = [response.id, response.timestamp];
    survey.questions.forEach((question, index) => {
      const answer = response.data[`question_${index}`] || '';
      row.push(Array.isArray(answer) ? answer.join('; ') : answer);
    });
    return row;
  });
  
  const csvContent = [headers, ...rows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');
  
  return csvContent;
}

// Survey Creation
let questionCounter = 0;

document.getElementById('add-question').addEventListener('click', addQuestion);
document.getElementById('save-survey').addEventListener('click', saveSurvey);
document.getElementById('cancel-create').addEventListener('click', () => {
  document.getElementById('survey-name').value = '';
  document.getElementById('questions-container').innerHTML = '';
  questionCounter = 0;
  showPage('surveys');
});

function addQuestion() {
  const template = document.getElementById('question-template');
  const clone = template.content.cloneNode(true);
  
  const questionItem = clone.querySelector('.question-item');
  questionItem.dataset.questionId = questionCounter++;
  
  // Set up question type change handler
  const questionTypeSelect = clone.querySelector('.question-type');
  const multipleChoiceOptions = clone.querySelector('#multiple-choice-options');
  const numChoicesInput = clone.querySelector('.num-choices');
  const choicesContainer = clone.querySelector('.choices-container');
  
  questionTypeSelect.addEventListener('change', () => {
    if (questionTypeSelect.value === 'multiple') {
      multipleChoiceOptions.classList.remove('hidden');
      updateChoices(choicesContainer, parseInt(numChoicesInput.value));
    } else {
      multipleChoiceOptions.classList.add('hidden');
    }
  });
  
  numChoicesInput.addEventListener('change', () => {
    updateChoices(choicesContainer, parseInt(numChoicesInput.value));
  });
  
  // Set up remove button
  clone.querySelector('.remove-question').addEventListener('click', () => {
    questionItem.remove();
  });
  
  document.getElementById('questions-container').appendChild(clone);
}

function updateChoices(container, numChoices) {
  container.innerHTML = '';
  for (let i = 0; i < numChoices; i++) {
    const choiceDiv = document.createElement('div');
    choiceDiv.innerHTML = `
      <input type="text" class="choice-input w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" 
             placeholder="Choice ${i + 1}">
    `;
    container.appendChild(choiceDiv);
  }
}

async function saveSurvey() {
  const surveyName = document.getElementById('survey-name').value.trim();
  if (!surveyName) {
    alert('Please enter a survey name');
    return;
  }
  
  const questionItems = document.querySelectorAll('.question-item');
  if (questionItems.length === 0) {
    alert('Please add at least one question');
    return;
  }
  
  const questions = [];
  
    questionItems.forEach(item => {
      const questionType = item.querySelector('.question-type').value;
      const questionText = item.querySelector('.question-text').value.trim();
      const isRequired = item.querySelector('.question-required').checked;
      
      if (!questionText) {
        alert('Please enter text for all questions');
        return;
      }
      
      const question = {
        type: questionType,
        text: questionText,
        required: isRequired
      };
    
    if (questionType === 'multiple') {
      const numChoices = parseInt(item.querySelector('.num-choices').value);
      const allowMultiple = item.querySelector('.allow-multiple').checked;
      const choiceInputs = item.querySelectorAll('.choice-input');
      
      const choices = [];
      for (let i = 0; i < numChoices; i++) {
        const choiceText = choiceInputs[i]?.value.trim();
        if (!choiceText) {
          alert('Please enter text for all choices');
          return;
        }
        choices.push(choiceText);
      }
      
      question.choices = choices;
      question.allowMultiple = allowMultiple;
    }
    
    questions.push(question);
  });
  
  const survey = {
    name: surveyName,
    questions: questions,
    createdAt: new Date().toISOString()
  };
  
  if (!surveyDB) {
    console.error('Database not initialized');
    alert('Database not ready. Please refresh the page.');
    return;
  }
  
  try {
    await surveyDB.saveSurvey(survey);
    alert('Survey saved successfully!');
    
    // Reset form
    document.getElementById('survey-name').value = '';
    document.getElementById('questions-container').innerHTML = '';
    questionCounter = 0;
    
    showPage('surveys');
  } catch (error) {
    console.error('Error saving survey:', error);
    alert('Error saving survey');
  }
}

// Survey Loading
document.getElementById('load-survey').addEventListener('click', loadSurveyFromFile);
document.getElementById('cancel-load').addEventListener('click', () => showPage('surveys'));

function loadSurveyFromFile() {
  const fileInput = document.getElementById('survey-file');
  const file = fileInput.files[0];
  
  if (!file) {
    alert('Please select a survey file');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const surveyData = JSON.parse(e.target.result);
      
      // Validate survey data structure
      if (!surveyData.name || !surveyData.questions || !Array.isArray(surveyData.questions)) {
        alert('Invalid survey file format');
        return;
      }
      
      // Add timestamp for when it was loaded
      surveyData.loadedAt = new Date().toISOString();
      
      if (!surveyDB) {
        console.error('Database not initialized');
        alert('Database not ready. Please refresh the page.');
        return;
      }
      
      await surveyDB.saveSurvey(surveyData);
      alert('Survey loaded successfully!');
      fileInput.value = '';
      showPage('surveys');
    } catch (error) {
      console.error('Error loading survey:', error);
      alert('Error loading survey file');
    }
  };
  
  reader.readAsText(file);
}

// Session response counter update function
function updateSessionResponseCounter() {
  const counterElement = document.getElementById('session-response-counter');
  if (counterElement) {
    counterElement.textContent = `Responses recorded this session: ${sessionResponseCount}`;
  }
}

// Survey Conduction
document.getElementById('add-response-card').addEventListener('click', addResponseCard);
document.getElementById('finish-conducting').addEventListener('click', () => {
  if (confirm('Are you sure you want to finish conducting this survey? All incomplete response cards will be lost.')) {
    showPage('surveys');
  }
});

function addResponseCard() {
  if (!currentSurvey) {
    alert('No survey selected');
    return;
  }
  
  const template = document.getElementById('response-card-template');
  const clone = template.content.cloneNode(true);
  
  const cardId = Date.now();
  const responseCard = clone.querySelector('.response-card');
  responseCard.dataset.cardId = cardId;
  
  // Set up remove button
  clone.querySelector('.remove-card').addEventListener('click', () => {
    responseCard.remove();
    responseCards = responseCards.filter(card => card.id !== cardId);
  });
  
  // Set up mark complete button
  clone.querySelector('.mark-complete').addEventListener('click', () => {
    markCardComplete(cardId);
  });
  
  // Create response inputs for each question
  const responsesContainer = clone.querySelector('.responses-container');
  currentSurvey.questions.forEach((question, index) => {
    const questionDiv = document.createElement('div');
    questionDiv.className = 'mb-4';
    
    let inputHtml = '';
    const requiredIndicator = question.required ? ' <span class="text-red-500">*</span>' : '';
    
    if (question.type === 'freeform') {
      inputHtml = `
        <label class="block text-sm font-medium text-gray-700 mb-2">${question.text}${requiredIndicator}</label>
        <input type="text" class="response-input w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" 
               data-question="${index}">
      `;
    } else if (question.type === 'multiple') {
      inputHtml = `
        <label class="block text-sm font-medium text-gray-700 mb-2">${question.text}${requiredIndicator}</label>
        <div class="space-y-2">
          ${question.choices.map((choice, choiceIndex) => `
            <label class="flex items-center">
              <input type="${question.allowMultiple ? 'checkbox' : 'radio'}" 
                     name="question_${index}_card_${cardId}" 
                     value="${choice}" 
                     class="response-input mr-2" 
                     data-question="${index}">
              <span class="text-sm text-gray-700">${choice}</span>
            </label>
          `).join('')}
        </div>
      `;
    }
    
    questionDiv.innerHTML = inputHtml;
    responsesContainer.appendChild(questionDiv);
  });
  
  document.getElementById('response-cards-container').appendChild(clone);
  document.getElementById('no-cards').classList.add('hidden');
  
  responseCards.push({
    id: cardId,
    element: responseCard,
    completed: false
  });
}

async function markCardComplete(cardId) {
  const card = responseCards.find(c => c.id === cardId);
  if (!card) return;
  
  const responseData = {};
  const inputs = card.element.querySelectorAll('.response-input');
  const validationErrors = [];
  
  // Clear previous validation errors
  card.element.querySelectorAll('.border-red-500').forEach(el => {
    el.classList.remove('border-red-500');
    el.classList.add('border-gray-300');
  });
  // Only remove error messages, not buttons
  card.element.querySelectorAll('.text-red-600.text-sm').forEach(el => {
    el.remove();
  });
  
  // Collect responses and validate required questions
  inputs.forEach(input => {
    const questionIndex = input.dataset.question;
    if (input.type === 'checkbox' || input.type === 'radio') {
      if (input.checked) {
        if (!responseData[`question_${questionIndex}`]) {
          responseData[`question_${questionIndex}`] = [];
        }
        responseData[`question_${questionIndex}`].push(input.value);
      }
    } else {
      responseData[`question_${questionIndex}`] = input.value;
    }
  });
  
  // Validate required questions
  currentSurvey.questions.forEach((question, index) => {
    if (question.required) {
      const hasAnswer = responseData[`question_${index}`] && 
        (Array.isArray(responseData[`question_${index}`]) ? 
         responseData[`question_${index}`].length > 0 : 
         responseData[`question_${index}`].trim() !== '');
      
      if (!hasAnswer) {
        validationErrors.push(index);
        // Highlight the question input
        const questionInputs = card.element.querySelectorAll(`[data-question="${index}"]`);
        questionInputs.forEach(input => {
          input.classList.remove('border-gray-300');
          input.classList.add('border-red-500');
        });
        
        // Add error message
        const questionDiv = questionInputs[0].closest('.mb-4');
        if (questionDiv && !questionDiv.querySelector('.text-red-600')) {
          const errorDiv = document.createElement('div');
          errorDiv.className = 'text-red-600 text-sm mt-1';
          errorDiv.textContent = 'This question is required';
          questionDiv.appendChild(errorDiv);
        }
      }
    }
  });
  
  // If there are validation errors, don't complete the card
  if (validationErrors.length > 0) {
    return;
  }
  
  if (!surveyDB) {
    console.error('Database not initialized');
    alert('Database not ready. Please refresh the page.');
    return;
  }
  
  if (!surveyDB.isReady()) {
    console.error('Database not ready');
    alert('Database not ready. Please refresh the page.');
    return;
  }
  
  try {
    await surveyDB.saveResponse(currentSurveyId, responseData);
    card.completed = true;
    card.element.remove();
    
    // Increment session response counter
    sessionResponseCount++;
    updateSessionResponseCounter();
    
    if (responseCards.every(c => c.completed)) {
      document.getElementById('no-cards').classList.remove('hidden');
    }
    
    // Show success message briefly
    const successDiv = document.createElement('div');
    successDiv.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow-lg z-50';
    successDiv.textContent = 'Response saved successfully!';
    document.body.appendChild(successDiv);
    setTimeout(() => successDiv.remove(), 3000);
  } catch (error) {
    console.error('Error saving response:', error);
    alert('Error saving response');
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});
