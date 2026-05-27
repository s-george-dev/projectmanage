import { createClient } from '@supabase/supabase-js';

// Initialize Supabase (Replace with your project keys)
const supabaseUrl = 'https://hwuyvatkyyxfnyzxrcsm.supabase.co';
const supabaseKey = 'sb_publishable_4opExcpgvIsblEQjDfqB3A_VMlCVNdG';
const supabase = createClient(supabaseUrl, supabaseKey);

// DOM Elements
const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authMsg = document.getElementById('auth-msg');
const taskInput = document.getElementById('new-task-input');
const addTaskBtn = document.getElementById('add-task-btn');
const taskList = document.getElementById('task-list');

let currentUser = null;

// Check active session on load
async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    showApp();
    fetchTasks();
  }
}

// Handle Login/Signup (Passwordless or standard)
loginBtn.addEventListener('click', async () => {
  const email = emailInput.value;
  const password = passwordInput.value;
  
  authMsg.textContent = 'Authenticating...';
  
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  
  if (error) {
    // If user doesn't exist, try signing them up automatically
    if (error.message.includes('Invalid login credentials')) {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) return authMsg.textContent = signUpError.message;
        authMsg.textContent = 'Check your email to confirm signup!';
        return;
    }
    return authMsg.textContent = error.message;
  }
  
  currentUser = data.user;
  showApp();
  fetchTasks();
});

// Handle Logout
logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  currentUser = null;
  authSection.classList.remove('hidden');
  appSection.classList.add('hidden');
  emailInput.value = '';
  passwordInput.value = '';
});

// Fetch Tasks
async function fetchTasks() {
  taskList.innerHTML = '<p>Loading tasks...</p>';
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching tasks', error);
    return;
  }

  renderTasks(tasks);
}

// Add Task
addTaskBtn.addEventListener('click', async () => {
  const title = taskInput.value.trim();
  if (!title) return;

  const { error } = await supabase
    .from('tasks')
    .insert([{ title, user_id: currentUser.id }]);

  if (!error) {
    taskInput.value = '';
    fetchTasks();
  }
});

// Toggle Task Status
async function toggleTask(id, currentStatus) {
  const newStatus = currentStatus === 'pending' ? 'completed' : 'pending';
  const { error } = await supabase
    .from('tasks')
    .update({ status: newStatus })
    .eq('id', id);

  if (!error) fetchTasks();
}

// Render UI
function renderTasks(tasks) {
  taskList.innerHTML = '';
  if (tasks.length === 0) {
    taskList.innerHTML = '<p style="color: var(--text-muted)">No tasks yet. Start building!</p>';
    return;
  }

  tasks.forEach(task => {
    const div = document.createElement('div');
    div.className = `task-item ${task.status === 'completed' ? 'completed' : ''}`;
    
    div.innerHTML = `
      <span>${task.title}</span>
      <input type="checkbox" ${task.status === 'completed' ? 'checked' : ''} />
    `;
    
    const checkbox = div.querySelector('input');
    checkbox.addEventListener('change', () => toggleTask(task.id, task.status));
    
    taskList.appendChild(div);
  });
}

function showApp() {
  authSection.classList.add('hidden');
  appSection.classList.remove('hidden');
}

// Init
checkSession();
