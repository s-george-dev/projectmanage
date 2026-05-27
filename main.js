import { createClient } from 'https://esm.sh/@supabase/supabase-js';

const supabaseUrl = 'https://hwuyvatkyyxfnyzxrcsm.supabase.co';
const supabaseKey = 'sb_publishable_4opExcpgvIsblEQjDfqB3A_VMlCVNdG';
const supabase = createClient(supabaseUrl, supabaseKey);


let currentUser = null;
let allTasksData = [];
let allProjectsData = [];
let pendingFiles = []; 
let editingTaskId = null;
let activeGlobalProjectId = 'all'; 

// Animation & UI States
let hideCompleted = false;
let isAnimating = false;
let newlyAddedTaskId = null;
let triggerSlideInAllCompleted = false;

// --- GALLERY & DELETE LOGIC ---
let currentGalleryAttachments = [];
let currentGalleryIndex = 0;

const priorityScore = { 'High': 3, 'Medium': 2, 'Low': 1 };

// --- INIT & AUTH ---
async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    const authSect = document.getElementById('auth-section');
    const appSect = document.getElementById('app-section');
    if (authSect && appSect) {
      authSect.classList.add('hidden');
      appSect.classList.remove('hidden');
      loadAppData();
      setupRealtime(); // START REALTIME
    }
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

// --- REALTIME SYNC ---
function setupRealtime() {
  supabase.channel('custom-all-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchTasks)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, fetchMessages)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, fetchProjects)
    .subscribe();
}

// --- FETCH DATA ---
async function loadAppData() {
  await fetchProjects();
  await fetchCategories();
  await fetchProfiles();
  await fetchTasks();
  await fetchMessages();
}

async function fetchProjects() {
  const { data } = await supabase.from('projects').select('*').order('name');
  if (data) {
    allProjectsData = data;
    const options = data.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    document.getElementById('global-project-select').innerHTML = '<option value="all">All Projects</option>' + options;
    document.getElementById('task-project-select').innerHTML = options;
    document.getElementById('global-project-select').value = activeGlobalProjectId;
  }
}

async function fetchCategories() {
  const { data } = await supabase.from('categories').select('*').order('name');
  if (data) {
    document.getElementById('category-select').innerHTML = '<option value="">Category...</option>' + data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('category-list').innerHTML = data.map(c => `
      <div style="display:flex; justify-content:space-between; background:var(--bg-color); padding:10px; border-radius:6px;">
        <span>${c.name}</span><button class="small-btn danger-btn" onclick="deleteCategory('${c.id}')">X</button>
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
    .select('*, category:categories(name), project:projects(name), assignee:profiles!tasks_assigned_to_fkey(full_name), task_attachments(id, file_url)')
  if (data) {
    allTasksData = data;
    renderTasks();
  }
}

// --- MODAL UTILS ---
window.openModal = (id) => document.getElementById(id).classList.add('active');
window.closeModal = (id) => {
  document.getElementById(id).classList.remove('active');
  if(id === 'task-modal') {
    editingTaskId = null;
    pendingFiles = [];
    document.getElementById('image-preview-list').innerHTML = '';
    document.getElementById('new-task-input').value = '';
    document.getElementById('form-title').textContent = 'Create New Task';
  }
};

document.getElementById('open-task-modal-btn').addEventListener('click', () => {
    if(activeGlobalProjectId !== 'all') {
        document.getElementById('task-project-select').value = activeGlobalProjectId;
    }
    openModal('task-modal');
});

document.getElementById('open-proj-modal-btn').addEventListener('click', () => openModal('project-modal'));
document.getElementById('open-cat-modal-btn').addEventListener('click', () => openModal('cat-modal'));

// --- PROJECT & CATEGORY CRUD ---
document.getElementById('add-proj-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-proj-input').value.trim();
  if (name) {
    await supabase.from('projects').insert([{ name }]);
    document.getElementById('new-proj-input').value = '';
    closeModal('project-modal');
  }
});

document.getElementById('add-cat-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-cat-input').value.trim();
  if (name) {
    await supabase.from('categories').insert([{ name }]);
    document.getElementById('new-cat-input').value = '';
    fetchCategories();
  }
});

window.deleteCategory = async (id) => {
  if (confirm('Delete category?')) {
    await supabase.from('categories').delete().eq('id', id);
    fetchCategories();
  }
};

// --- IMAGE UPLOAD LOGIC ---
const dropZone = document.getElementById('image-upload-zone');
const fileInput = document.getElementById('file-input');

if (dropZone && fileInput) {
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

  document.addEventListener('paste', (e) => {
    if(document.getElementById('task-modal').classList.contains('active')) {
      if(e.clipboardData && e.clipboardData.files.length > 0) {
        handleFiles(e.clipboardData.files);
      }
    }
  });
}

function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (file.type.startsWith('image/')) {
      pendingFiles.push(file);
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.height = '60px';
      document.getElementById('image-preview-list').appendChild(img);
    }
  });
}

// --- TASK SAVE LOGIC ---
document.getElementById('add-task-btn').addEventListener('click', async () => {
  const title = document.getElementById('new-task-input').value.trim();
  const assigneeVal = document.getElementById('assignee-select').value;
  const projectId = document.getElementById('task-project-select').value;
  if (!title || !projectId) return alert("Title and Project are required.");

  document.getElementById('add-task-btn').textContent = "Saving...";

  const payload = {
    title,
    project_id: projectId,
    category_id: document.getElementById('category-select').value || null,
    priority: document.getElementById('priority-select').value,
    is_group_task: assigneeVal === 'ALL',
    assigned_to: (assigneeVal === 'ALL' || assigneeVal === '') ? null : assigneeVal
  };

  let targetTaskId = editingTaskId;

  if (editingTaskId) {
    await supabase.from('tasks').update(payload).eq('id', editingTaskId);
  } else {
    payload.user_id = currentUser.id;
    const { data } = await supabase.from('tasks').insert([payload]).select();
    if(data) {
        newlyAddedTaskId = data[0].id;
        targetTaskId = data[0].id;
    }
  }

  if (pendingFiles.length > 0 && targetTaskId) {
    for (const file of pendingFiles) {
      const fileExt = file.name.split('.').pop() || 'png'; 
      const fileName = `${targetTaskId}-${Date.now()}.${fileExt}`;
      
      const { data: uploadData } = await supabase.storage
        .from('task-images')
        .upload(fileName, file);

      if (uploadData) {
        const { data: publicUrlData } = supabase.storage.from('task-images').getPublicUrl(fileName);
        await supabase.from('task_attachments').insert([{
          task_id: targetTaskId,
          file_url: publicUrlData.publicUrl,
          uploaded_by: currentUser.id
        }]);
      }
    }
  }

  document.getElementById('add-task-btn').textContent = "Save Task";
  closeModal('task-modal');
  fetchTasks(); 
});

window.editTask = (id) => {
  const task = allTasksData.find(t => t.id === id);
  editingTaskId = id;
  document.getElementById('new-task-input').value = task.title;
  document.getElementById('task-project-select').value = task.project_id || '';
  document.getElementById('category-select').value = task.category_id || '';
  document.getElementById('priority-select').value = task.priority;
  document.getElementById('assignee-select').value = task.is_group_task ? 'ALL' : (task.assigned_to || '');
  document.getElementById('form-title').textContent = 'Edit Task';
  openModal('task-modal');
};

window.deleteTask = async (id) => {
  if (confirm('Are you sure you want to delete this task?')) {
    if (isAnimating) return;
    isAnimating = true;

    // 1. Find the task in both lists (if it exists in both)
    const myEl = document.getElementById(`my-task-${id}`);
    const allEl = document.getElementById(`all-task-${id}`);
    const activeElements = [myEl, allEl].filter(el => el !== null);

    // 2. Trigger the red slide-out animation
    activeElements.forEach(el => el.classList.add('anim-slide-out'));

    // 3. Wait for the 600ms animation to finish before deleting from the database
    setTimeout(async () => {
      await supabase.from('tasks').delete().eq('id', id);
      isAnimating = false;
      // Note: Because we set up Realtime, deleting it here will automatically
      // trigger fetchTasks() and refresh the lists for everyone!
    }, 600);
  }
};

// --- CHAT LOGIC ---
document.getElementById('send-msg-btn').addEventListener('click', async () => {
    const content = document.getElementById('new-msg-input').value.trim();
    if (!content || activeGlobalProjectId === 'all') return;

    const { error } = await supabase.from('messages').insert([{
        project_id: activeGlobalProjectId,
        user_id: currentUser.id,
        content: content
    }]);
    
    if (error) {
        alert("Failed to send message. Make sure this user exists in the 'profiles' table! Error: " + error.message);
        console.error("Chat Insert Error:", error);
        return;
    }
    
    document.getElementById('new-msg-input').value = '';
});

document.getElementById('new-msg-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('send-msg-btn').click();
});

async function fetchMessages() {
    if (activeGlobalProjectId === 'all') {
        document.getElementById('message-list').innerHTML = '<p style="color: var(--text-muted); text-align: center;">Select a specific project to view chat.</p>';
        document.getElementById('new-msg-input').disabled = true;
        document.getElementById('send-msg-btn').disabled = true;
        return;
    }

    document.getElementById('new-msg-input').disabled = false;
    document.getElementById('send-msg-btn').disabled = false;

    const { data } = await supabase
        .from('messages')
        .select('*, profile:profiles(full_name)')
        .eq('project_id', activeGlobalProjectId)
        .order('created_at', { ascending: true });
    
    if (data) {
        const msgHtml = data.map(m => {
            const isMe = m.user_id === currentUser.id;
            const timeString = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            // NEW: Delete button for your own messages
            const deleteBtn = isMe ? `<button class="small-btn danger-btn" style="padding: 2px 6px; margin-left: 10px;" onclick="deleteMessage('${m.id}')">X</button>` : '';

            return `
                <div style="display: flex; flex-direction: column; align-items: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center;">
                        <span style="font-size: 10px; color: var(--text-muted); margin-bottom: 3px;">
                            ${m.profile?.full_name || 'Unknown User'} • ${timeString}
                        </span>
                        ${deleteBtn}
                    </div>
                    <div style="background: ${isMe ? 'var(--primary-color)' : 'var(--surface-color)'}; color: ${isMe ? '#000' : 'var(--text-main)'}; padding: 8px 12px; border-radius: 8px; max-width: 80%; word-wrap: break-word;">
                        ${m.content}
                    </div>
                </div>
            `;
        }).join('');

        const msgList = document.getElementById('message-list');
        msgList.innerHTML = msgHtml || '<p style="color: var(--text-muted); text-align: center;">No messages yet. Start the conversation!</p>';
        msgList.scrollTop = msgList.scrollHeight; 
    }
}

// --- GLOBAL FILTERS & SEARCH ---
document.getElementById('global-project-select').addEventListener('change', (e) => {
  activeGlobalProjectId = e.target.value;
  renderTasks(); 
  fetchMessages();
});

window.clearSearch = (id) => { document.getElementById(id).value = ''; renderTasks(); };
document.querySelectorAll('input[id^="search-"], select').forEach(el => el.addEventListener('input', renderTasks));
document.querySelectorAll('input[id^="search-"]').forEach(searchBox => {
  searchBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { searchBox.value = ''; renderTasks(); }});
});

document.getElementById('toggle-visibility-btn').addEventListener('click', () => {
  if (isAnimating) return;
  const btn = document.getElementById('toggle-visibility-btn');
  if (!hideCompleted) {
    const completedEls = document.querySelectorAll('.task-item.completed');
    if (completedEls.length > 0) {
      isAnimating = true;
      completedEls.forEach(el => el.classList.add('anim-slide-out'));
      setTimeout(() => { hideCompleted = true; btn.textContent = 'Show Completed'; isAnimating = false; renderTasks(); }, 600);
    } else {
      hideCompleted = true; btn.textContent = 'Show Completed'; renderTasks();
    }
  } else {
    hideCompleted = false; btn.textContent = 'Hide Completed'; triggerSlideInAllCompleted = true; renderTasks();
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

  let myTasks = allTasksData.filter(t => t.assigned_to === currentUser.id || t.is_group_task);
  myTasks = processList(myTasks, searchMy, prioMy, sortMy, 'All');
  let allTasks = processList(allTasksData, searchAll, prioAll, sortAll, userAll);

  document.getElementById('my-task-list').innerHTML = buildHTML(myTasks, 'my');
  document.getElementById('all-task-list').innerHTML = buildHTML(allTasks, 'all');

  newlyAddedTaskId = null;
  triggerSlideInAllCompleted = false;
}

function processList(tasks, search, priorityFilter, sortMode, userFilter) {
  let filtered = [...tasks];
  if (activeGlobalProjectId !== 'all') filtered = filtered.filter(t => t.project_id === activeGlobalProjectId);
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
  incomplete.sort(sortFn); completed.sort(sortFn);
  return [...incomplete, ...completed];
}

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
    
    // NEW: Thumbnails placed here, triggering openGallery()
    const imageHtml = t.task_attachments && t.task_attachments.length > 0 
        ? `<div style="display:flex; gap:8px; margin: 0 15px; overflow-x: auto; max-width: 150px;">` + 
          t.task_attachments.map((att, index) => 
            `<img src="${att.file_url}" onclick="openGallery('${t.id}', ${index})" style="height:40px; width:40px; object-fit:cover; cursor:pointer; border-radius:4px; border:1px solid var(--border-color); flex-shrink: 0;">`
          ).join('') + `</div>`
        : '';

    return `
      <div class="task-item ${isCompleted ? 'completed' : ''} ${animClass}" id="${prefix}-task-${t.id}">
        <div class="task-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          
          <div style="display:flex; align-items:center; gap:15px; flex:1;">
            <button class="small-btn ${btnClass}" style="min-width: 130px;" onclick="toggleTaskStatus('${t.id}', '${t.status}')">${btnText}</button>
            <div>
              <div class="task-title" style="font-weight:bold; font-size:16px;">${t.title}</div>
              <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
                [${t.category?.name || 'No Cat'}] • <span class="priority-${t.priority}">${t.priority}</span> • ${assigneeName}
              </div>
            </div>
          </div>

          ${imageHtml} <div style="display:flex; gap:5px;">
            <button class="small-btn" onclick="editTask('${t.id}')">Edit</button>
            <button class="small-btn danger-btn" onclick="deleteTask('${t.id}')">X</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- ANIMATED STATUS UPDATE ---
window.toggleTaskStatus = async (id, currentStatus) => {
  if (isAnimating) return;
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
      }, 600);
    } else {
      activeElements.forEach(el => el.classList.add('anim-pulse-complete'));
      setTimeout(() => {
        activeElements.forEach(el => {
          el.classList.remove('anim-pulse-complete'); el.classList.add('completed');
          const btn = el.querySelector('button');
          if(btn) { btn.className = 'small-btn secondary-btn'; btn.textContent = 'Mark Incomplete'; }
        });
        setTimeout(async () => {
          await supabase.from('tasks').update({ status: 'completed' }).eq('id', id);
          isAnimating = false;
        }, 500); 
      }, 600);
    }
  } else {
    await supabase.from('tasks').update({ status: 'pending' }).eq('id', id);
  }
};




window.openGallery = (taskId, startIndex) => {
  const task = allTasksData.find(t => t.id === taskId);
  if (task && task.task_attachments) {
    currentGalleryAttachments = task.task_attachments;
    currentGalleryIndex = startIndex;
    updateGalleryUI();
    openModal('gallery-modal');
  }
};

window.updateGalleryUI = () => {
  if (currentGalleryAttachments.length === 0) return closeModal('gallery-modal');
  const att = currentGalleryAttachments[currentGalleryIndex];
  document.getElementById('gallery-main-img').src = att.file_url;
  document.getElementById('gallery-counter').textContent = `${currentGalleryIndex + 1} / ${currentGalleryAttachments.length}`;
};

window.nextGalleryImage = () => {
  if (currentGalleryIndex < currentGalleryAttachments.length - 1) {
    currentGalleryIndex++;
    updateGalleryUI();
  }
};

window.prevGalleryImage = () => {
  if (currentGalleryIndex > 0) {
    currentGalleryIndex--;
    updateGalleryUI();
  }
};

window.deleteGalleryImage = async () => {
  if (!confirm('Are you sure you want to delete this image?')) return;
  
  const att = currentGalleryAttachments[currentGalleryIndex];
  
  // 1. Extract filename from the Supabase public URL
  const urlParts = att.file_url.split('/');
  const fileName = urlParts[urlParts.length - 1];

  // 2. Delete the actual file from the Storage Bucket
  await supabase.storage.from('task-images').remove([fileName]);

  // 3. Delete the record from the database table
  await supabase.from('task_attachments').delete().eq('id', att.id);

  // Remove from local array to prevent crash before DB refresh
  currentGalleryAttachments.splice(currentGalleryIndex, 1);
  if (currentGalleryIndex >= currentGalleryAttachments.length) currentGalleryIndex--;
  
  updateGalleryUI();
  fetchTasks();
};

window.deleteMessage = async (id) => {
  if (confirm('Delete this message?')) {
    await supabase.from('messages').delete().eq('id', id);
    // Realtime will auto-refresh the chat list
  }
};


checkSession();