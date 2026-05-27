import { createClient } from 'https://esm.sh/@supabase/supabase-js';

const supabaseUrl = 'https://hwuyvatkyyxfnyzxrcsm.supabase.co';
const supabaseKey = 'sb_publishable_4opExcpgvIsblEQjDfqB3A_VMlCVNdG';
const supabase = createClient(supabaseUrl, supabaseKey);


let currentUser = null;
let allTasksData = [];
let editingTaskId = null;

// Animation & UI States
let hideCompleted = false;
let isAnimating = false;
let newlyAddedTaskId = null;
let triggerSlideInAllCompleted = false;

const priorityScore = { 'High': 3, 'Medium': 2, 'Low': 1 };

// --- INIT & AUTH ---
async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('app-section').classList.remove('hidden');
    loadAppData();
  }
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  location.reload();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

// --- FETCH DATA ---
async function loadAppData() {
  await fetchCategories();
  await fetchProfiles();
  await fetchTasks();
}

async function fetchCategories() {
  const { data } = await supabase.from('categories').select('*').order('name');
  if (data) {
    document.getElementById('category-select').innerHTML = '<option value="">Category...</option>' + 
      data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    
    document.getElementById('category-list').innerHTML = data.map(c => `
      <div style="display:flex; justify-content:space-between; background:var(--bg-color); padding:10px; border-radius:6px;">
        <span>${c.name}</span>
        <button class="small-btn danger-btn" onclick="deleteCategory('${c.id}')">X</button>
      </div>
    `).join('');
  }
}

async function fetchProfiles() {
  const { data } = await supabase.from('profiles').select('*');
  if (data) {
    const options = data.map(p => `<option value="${p.id}">${p.full_name}</option>`).join('');
    document.getElementById('assignee-select').innerHTML = '<option value="">Unassigned</option><option value="ALL">Group Task (All)</option>' + options;
    document.getElementById('filter-user-all').innerHTML = '<option value="All">All Users</option>' + options;
  }
}

async function fetchTasks() {
  const { data } = await supabase
    .from('tasks')
    .select('*, category:categories(name), assignee:profiles!tasks_assigned_to_fkey(full_name)')
    .order('created_at', { ascending: false });

  if (data) {
    allTasksData = data;
    renderTasks();
  }
}

// --- TASK CRUD ---
window.openModal = (id) => document.getElementById(id).classList.add('active');
window.closeModal = (id) => {
  document.getElementById(id).classList.remove('active');
  if(id === 'task-modal') {
    editingTaskId = null;
    document.getElementById('new-task-input').value = '';
    document.getElementById('form-title').textContent = 'Create New Task';
  }
};

document.getElementById('open-task-modal-btn').addEventListener('click', () => openModal('task-modal'));

document.getElementById('add-task-btn').addEventListener('click', async () => {
  const title = document.getElementById('new-task-input').value.trim();
  const assigneeVal = document.getElementById('assignee-select').value;
  if (!title) return;

  const payload = {
    title,
    category_id: document.getElementById('category-select').value || null,
    priority: document.getElementById('priority-select').value,
    is_group_task: assigneeVal === 'ALL',
    assigned_to: (assigneeVal === 'ALL' || assigneeVal === '') ? null : assigneeVal
  };

  if (editingTaskId) {
    await supabase.from('tasks').update(payload).eq('id', editingTaskId);
  } else {
    payload.user_id = currentUser.id;
    const { data } = await supabase.from('tasks').insert([payload]).select();
    if(data) newlyAddedTaskId = data[0].id;
  }
  closeModal('task-modal');
  fetchTasks();
});

window.editTask = (id) => {
  const task = allTasksData.find(t => t.id === id);
  editingTaskId = id;
  document.getElementById('new-task-input').value = task.title;
  document.getElementById('category-select').value = task.category_id || '';
  document.getElementById('priority-select').value = task.priority;
  document.getElementById('assignee-select').value = task.is_group_task ? 'ALL' : (task.assigned_to || '');
  document.getElementById('form-title').textContent = 'Edit Task';
  openModal('task-modal');
};

window.deleteTask = async (id) => {
  if (confirm('Delete task?')) {
    await supabase.from('tasks').delete().eq('id', id);
    fetchTasks();
  }
};

// --- FILTERS & SEARCH ---

window.clearSearch = (id) => {
  document.getElementById(id).value = '';
  renderTasks();
};

document.querySelectorAll('input[id^="search-"], select').forEach(el => {
  el.addEventListener('input', renderTasks); // Live search on input
});

// New: Listen for the Escape key on search inputs
document.querySelectorAll('input[id^="search-"]').forEach(searchBox => {
  searchBox.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchBox.value = '';
      renderTasks();
    }
  });
});

document.querySelectorAll('input[id^="search-"], select').forEach(el => {
  el.addEventListener('input', renderTasks); // Live search on input
});

// Animation toggles
document.getElementById('toggle-visibility-btn').addEventListener('click', () => {
  if (isAnimating) return;
  
  const btn = document.getElementById('toggle-visibility-btn');
  
  if (!hideCompleted) {
    // Sliding OUT
    const completedEls = document.querySelectorAll('.task-item.completed');
    if (completedEls.length > 0) {
      isAnimating = true;
      completedEls.forEach(el => el.classList.add('anim-slide-out'));
      setTimeout(() => {
        hideCompleted = true;
        btn.textContent = 'Show Completed';
        isAnimating = false;
        renderTasks();
      }, 600); // Wait for animation
    } else {
      hideCompleted = true;
      btn.textContent = 'Show Completed';
      renderTasks();
    }
  } else {
    // Sliding IN
    hideCompleted = false;
    btn.textContent = 'Hide Completed';
    triggerSlideInAllCompleted = true;
    renderTasks();
  }
});

// --- RENDER LOGIC ---
function renderTasks() {
  if (isAnimating) return;

  const searchMy = document.getElementById('search-my').value.toLowerCase();
  const searchAll = document.getElementById('search-all').value.toLowerCase();
  
  const prioMy = document.getElementById('filter-priority-my').value;
  const sortMy = document.getElementById('sort-my').value;
  
  const prioAll = document.getElementById('filter-priority-all').value;
  const sortAll = document.getElementById('sort-all').value;
  const userAll = document.getElementById('filter-user-all').value;

  // Process My Tasks
  let myTasks = allTasksData.filter(t => t.assigned_to === currentUser.id || t.is_group_task);
  myTasks = processList(myTasks, searchMy, prioMy, sortMy, 'All');
  
  // Process All Tasks
  let allTasks = processList(allTasksData, searchAll, prioAll, sortAll, userAll);

  // We now pass a unique prefix to the HTML builder
  document.getElementById('my-task-list').innerHTML = buildHTML(myTasks, 'my');
  document.getElementById('all-task-list').innerHTML = buildHTML(allTasks, 'all');

  newlyAddedTaskId = null;
  triggerSlideInAllCompleted = false;
}

// Applies search, filters, and STRICT sorting
function processList(tasks, search, priorityFilter, sortMode, userFilter) {
  let filtered = [...tasks];

  if (search) filtered = filtered.filter(t => t.title.toLowerCase().includes(search) || (t.category && t.category.name.toLowerCase().includes(search)));
  if (priorityFilter !== 'All') filtered = filtered.filter(t => t.priority === priorityFilter);
  if (userFilter !== 'All') {
    if (userFilter === 'ALL') filtered = filtered.filter(t => t.is_group_task);
    else filtered = filtered.filter(t => t.assigned_to === userFilter);
  }
  if (hideCompleted) filtered = filtered.filter(t => t.status !== 'completed');

  let incomplete = filtered.filter(t => t.status !== 'completed');
  let completed = filtered.filter(t => t.status === 'completed');

  const sortFn = (a, b) => {
    if (sortMode === 'highest') return priorityScore[b.priority] - priorityScore[a.priority];
    return new Date(b.created_at) - new Date(a.created_at);
  };

  incomplete.sort(sortFn);
  completed.sort(sortFn);

  return [...incomplete, ...completed];
}

// Build HTML now accepts a prefix to ensure unique IDs across the two lists
function buildHTML(tasks, prefix) {
  if (tasks.length === 0) return '<p style="color:var(--text-muted)">No tasks found.</p>';

  return tasks.map(t => {
    const isCompleted = t.status === 'completed';
    let animClass = '';
    
    if (t.id === newlyAddedTaskId) animClass = 'anim-new';
    if (isCompleted && triggerSlideInAllCompleted) animClass = 'anim-slide-in';

    const btnClass = isCompleted ? 'secondary-btn' : 'success-btn';
    const btnText = isCompleted ? 'Mark Incomplete' : 'Mark Complete';
    const assigneeName = t.is_group_task ? '<span style="color:var(--primary-color)">Group Task</span>' : (t.assignee?.full_name || 'Unassigned');

    return `
      <div class="task-item ${isCompleted ? 'completed' : ''} ${animClass}" id="${prefix}-task-${t.id}">
        <div style="display:flex; align-items:center; gap:15px; flex:1;">
          <button class="small-btn ${btnClass}" style="min-width: 130px;" 
                  onclick="toggleTaskStatus('${t.id}', '${t.status}')">${btnText}</button>
          <div>
            <div class="task-title" style="font-weight:bold; font-size:16px;">${t.title}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
              [${t.category?.name || 'No Cat'}] • <span class="priority-${t.priority}">${t.priority}</span> • ${assigneeName}
            </div>
          </div>
        </div>
        <div style="display:flex; gap:5px;">
          <button class="small-btn" onclick="editTask('${t.id}')">Edit</button>
          <button class="small-btn danger-btn" onclick="deleteTask('${t.id}')">X</button>
        </div>
      </div>
    `;
  }).join('');
}

// --- ANIMATED STATUS UPDATE ---
window.toggleTaskStatus = async (id, currentStatus) => {
  if (isAnimating) return;

  // Find the task in both lists (if it exists in both)
  const myEl = document.getElementById(`my-task-${id}`);
  const allEl = document.getElementById(`all-task-${id}`);
  const activeElements = [myEl, allEl].filter(el => el !== null);

  if (currentStatus === 'pending') {
    isAnimating = true;
    
    if (hideCompleted) {
      activeElements.forEach(el => el.classList.add('anim-slide-out')); 
      
      setTimeout(async () => {
        await supabase.from('tasks').update({ status: 'completed' }).eq('id', id);
        isAnimating = false;
        fetchTasks();
      }, 600);
      
    } else {
      activeElements.forEach(el => el.classList.add('anim-pulse-complete'));
      
      setTimeout(() => {
        activeElements.forEach(el => {
          el.classList.remove('anim-pulse-complete');
          el.classList.add('completed');
          const btn = el.querySelector('button');
          if(btn) {
              btn.className = 'small-btn secondary-btn';
              btn.textContent = 'Mark Incomplete';
          }
        });

        setTimeout(async () => {
          await supabase.from('tasks').update({ status: 'completed' }).eq('id', id);
          isAnimating = false;
          fetchTasks();
        }, 500); 
      }, 600);
    }
    
  } else {
    await supabase.from('tasks').update({ status: 'pending' }).eq('id', id);
    fetchTasks();
  }
};

checkSession();