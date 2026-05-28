import { createClient } from 'https://esm.sh/@supabase/supabase-js';

const supabaseUrl = 'https://hwuyvatkyyxfnyzxrcsm.supabase.co';
const supabaseKey = 'sb_publishable_4opExcpgvIsblEQjDfqB3A_VMlCVNdG';
const supabase = createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let currentUserProfile = null; 
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

// --- NOTIFICATIONS & UNSEEN STATE ---
let unseenTaskIds = new Set();
let notifPrefs = JSON.parse(localStorage.getItem('fieldhub_notifs')) || {
  newTask: true, delTask: true, statusTask: true, newMsg: true, login: true
};

let allProfiles = [];

const viewportObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const rawId = el.id.replace('my-task-', '').replace('all-task-', '');
      if (unseenTaskIds.has(rawId)) {
        unseenTaskIds.delete(rawId);
        el.classList.remove('unseen-task');
        viewportObserver.unobserve(el);
      }
    }
  });
}, { threshold: 0.5 }); 

// --- INIT & MULTI-TENANCY VERIFICATION ---
// --- INIT, AUTH & MULTI-TENANCY VERIFICATION ---
async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (session) {
    currentUser = session.user;
    
    try {
      // Fetch the profile exactly ONE time
      const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();

      if (error) console.error("Profile Fetch Error:", error.message);

      const authSect = document.getElementById('auth-section');
      const appSect = document.getElementById('app-section');
      const orgModal = document.getElementById('org-modal');

      // 1. Check for Bans first
      if (profile?.is_banned) {
        alert("Your account has been suspended. Please contact your administrator.");
        await supabase.auth.signOut();
        return location.reload();
      }

      // 2. Check for missing Organization (The Lock Screen)
      if (!profile || !profile.org_id) {
        if (authSect) authSect.classList.add('hidden');
        if (appSect) appSect.classList.add('hidden');
        
        if (orgModal) {
          orgModal.classList.add('active');
        } else {
          console.error("CRITICAL: You are missing the <div id='org-modal'> in your index.html!");
          alert("Error: Missing Organization Modal HTML. Check console F12.");
        }
      } 
      // 3. Let them into the app!
      else {
        currentUserProfile = profile;
        
        // REVEAL ADMIN BUTTON IF AUTHORIZED
        if (currentUserProfile.role === 'super_admin' || currentUserProfile.role === 'general_admin') {
          const adminBtn = document.getElementById('open-admin-btn');
          if (adminBtn) {
            adminBtn.classList.remove('hidden');
          } else {
            console.warn("Notice: You are an Admin, but the 'open-admin-btn' is missing from index.html.");
          }
        }

        if (authSect) authSect.classList.add('hidden');
        if (orgModal) orgModal.classList.remove('active');
        if (appSect) appSect.classList.remove('hidden');
        
        loadAppData();
        setupRealtime(); 
        
        if (Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }
    } catch (err) {
      console.error("Crash during login sequence:", err);
    }
  }
}

// Verification Gatehouse Handler
document.getElementById('verify-org-btn').addEventListener('click', async () => {
  const code = document.getElementById('org-code-input').value.trim();
  const msg = document.getElementById('org-msg');
  if(!code) return msg.textContent = "Please enter an Organisation ID.";

  msg.style.color = "var(--text-main)";
  msg.textContent = "Verifying...";

  const { data: org } = await supabase.from('organizations').select('id').eq('join_code', code).maybeSingle();

  if(!org) {
    msg.style.color = "var(--danger)";
    return msg.textContent = "Invalid Organisation ID. Access Denied.";
  }

  const { error } = await supabase.from('profiles').upsert({
    id: currentUser.id,
    full_name: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
    org_id: org.id
  });

  if(error) {
    msg.style.color = "var(--danger)";
    return msg.textContent = error.message;
  }

  location.reload();
});

document.getElementById('org-logout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

document.getElementById('login-btn').addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  location.reload();
});

document.getElementById('google-login-btn').addEventListener('click', async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });
  if (error) alert("Google Connection Interrupted: " + error.message);
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

// --- REALTIME ENGINE ---
function setupRealtime() {
  const channel = supabase.channel('fieldhub-sync');
  let presenceInitialized = false; 

  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, fetchProjects)
    
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      fetchMessages();
      if (payload.new.user_id !== currentUser.id && payload.new.org_id === currentUserProfile.org_id && notifPrefs.newMsg && Notification.permission === 'granted') {
        new Notification("New Message", { 
          body: payload.new.content, 
          icon: "https://fieldhub.uk/assets/images/favicon-transparent.png",
          tag: "fieldhub-chat" 
        });
      }
    })

    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async (payload) => {
      await fetchTasks();
      if (Notification.permission !== 'granted') return;

      const isMine = payload.new?.user_id === currentUser.id || payload.old?.user_id === currentUser.id;
      const targetOrg = payload.new?.org_id || payload.old?.org_id;
      if (targetOrg !== currentUserProfile.org_id) return;

      if (payload.eventType === 'INSERT') {
        if (isMine) return; 
        const creatorName = allProfiles.find(p => p.id === payload.new.user_id)?.full_name || 'A teammate';
        unseenTaskIds.add(payload.new.id);
        renderTasks(); 
        
        if (notifPrefs.newTask) {
          if (payload.new.is_group_task) {
            new Notification("Task Update!", { body: `${creatorName} has just assigned you to a group task: ${payload.new.title}`, icon: "https://fieldhub.uk/assets/images/favicon-transparent.png" });
          } else if (payload.new.assigned_to === currentUser.id) {
            new Notification("Task Update!", { body: `${creatorName} has just assigned you a task: ${payload.new.title}`, icon: "https://fieldhub.uk/assets/images/favicon-transparent.png" });
          } else {
            new Notification("New Task Added", { body: payload.new.title });
          }
        }
      }
      
      if (payload.eventType === 'UPDATE' && !isMine) {
        if (payload.new.assigned_to === currentUser.id && notifPrefs.statusTask) {
           const editorName = allProfiles.find(p => p.id === payload.new.user_id)?.full_name || 'A teammate';
           new Notification("Task Update!", { body: `${editorName} has just updated one of your tasks: ${payload.new.title}`, icon: "https://fieldhub.uk/assets/images/favicon-transparent.png" });
        } else if (payload.old.status !== payload.new.status && notifPrefs.statusTask) {
           const action = payload.new.status === 'completed' ? "Completed" : "Reinstated";
           new Notification(`Task ${action}`, { body: payload.new.title });
        }
      }

      if (payload.eventType === 'DELETE' && notifPrefs.delTask && !isMine) {
        new Notification("Task Deleted", { body: "A task was removed from the board." });
      }
    })

    .on('presence', { event: 'join' }, ({ newPresences }) => {
      if (notifPrefs.login && Notification.permission === 'granted') {
        const myName = currentUserProfile?.full_name || currentUser.user_metadata?.full_name || "A Teammate";
        newPresences.forEach(userState => {
          if (userState.user_name && userState.user_name !== myName) {
             const actionText = presenceInitialized ? "just logged in. 👨‍💻" : "is online. 🌐";
             new Notification("Teammate Status", { body: `${userState.user_name} ${actionText}` });
          }
        });
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        const broadcastName = currentUserProfile?.full_name || currentUser.user_metadata?.full_name || "A Teammate";
        await channel.track({ user_name: broadcastName, online_at: new Date().toISOString() });
        setTimeout(() => { presenceInitialized = true; }, 1000);
      }
    });
}

// --- SECURED FETCH PIPELINES ---
async function loadAppData() {
  await fetchProjects();
  await fetchCategories();
  await fetchProfiles();
  await fetchTasks();
  await fetchMessages();
}

async function fetchProjects() {
  const { data } = await supabase.from('projects').select('*').eq('org_id', currentUserProfile.org_id).order('name');
  if (data) {
    allProjectsData = data;
    const options = data.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    document.getElementById('global-project-select').innerHTML = '<option value="all">All Projects</option>' + options;
    document.getElementById('task-project-select').innerHTML = options;
    document.getElementById('settings-default-project').innerHTML = '<option value="all">Show All Projects on Startup</option>' + options;
    document.getElementById('global-project-select').value = activeGlobalProjectId;
  }
}

async function fetchCategories() {
  const { data } = await supabase.from('categories').select('*').eq('org_id', currentUserProfile.org_id).order('name');
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
  const { data } = await supabase.from('profiles').select('*').eq('org_id', currentUserProfile.org_id);
  if (data) {
    allProfiles = data; 
    const options = data.map(p => `<option value="${p.id}">${p.full_name}</option>`).join('');
    document.getElementById('assignee-select').innerHTML = '<option value="">Unassigned</option><option value="ALL">Group Task (All)</option>' + options;
    document.getElementById('filter-user-all').innerHTML = '<option value="All">All Users</option>' + options;
    
    if (currentUserProfile && currentUserProfile.default_project && activeGlobalProjectId === 'all') {
        activeGlobalProjectId = currentUserProfile.default_project;
        document.getElementById('global-project-select').value = activeGlobalProjectId;
    }
  }
}

async function sendSystemMessage(projectId, content) {
  if (!projectId || projectId === 'all') return;
  await supabase.from('messages').insert([{
      project_id: projectId,
      user_id: currentUser.id,
      org_id: currentUserProfile.org_id,
      content: content
  }]);
}

async function fetchTasks() {
  const { data } = await supabase
    .from('tasks')
    .select('*, category:categories(name), project:projects(name), assignee:profiles!tasks_assigned_to_fkey(full_name), task_attachments(id, file_url)')
    .eq('org_id', currentUserProfile.org_id);
  if (data) {
    allTasksData = data;
    renderTasks();
  }
}

// --- DIALOG MODAL UTILS ---
window.openModal = (id) => document.getElementById(id).classList.add('active');
window.closeModal = (id) => {
  document.getElementById(id).classList.remove('active');
  if(id === 'task-modal') {
    editingTaskId = null;
    pendingFiles = [];
    renderPendingFiles(); 
    document.getElementById('new-task-input').value = '';
    document.getElementById('form-title').textContent = 'Create New Task';
  } 
  else if (id === 'settings-modal') {
    document.getElementById('old-password').value = '';
    const newPw = document.getElementById('new-password');
    newPw.value = '';
    document.getElementById('confirm-password').value = '';
    document.getElementById('confirm-password').disabled = true;
    document.getElementById('update-password-btn').disabled = true;
    document.getElementById('match-msg').textContent = '';
    document.getElementById('settings-msg').textContent = '';
    document.getElementById('profile-msg').textContent = '';
    newPw.dispatchEvent(new Event('input')); 
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

// --- WRITE PIPELINES (PROCESSED WITH VALIDATED ORG_ID) ---
document.getElementById('add-proj-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-proj-input').value.trim();
  if (name) {
    await supabase.from('projects').insert([{ name, org_id: currentUserProfile.org_id }]);
    document.getElementById('new-proj-input').value = '';
    closeModal('project-modal');
  }
});

document.getElementById('add-cat-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-cat-input').value.trim();
  if (name) {
    await supabase.from('categories').insert([{ name, org_id: currentUserProfile.org_id }]);
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

// --- MULTI-ATTACHMENT DRAG/DROP FILE ENGINE ---
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
      renderPendingFiles();
    }
  });
}

function renderPendingFiles() {
  const previewList = document.getElementById('image-preview-list');
  previewList.innerHTML = '';
  pendingFiles.forEach((file, index) => {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
         
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.style.height = '60px';
    img.style.borderRadius = '4px';
    img.style.border = '1px solid var(--border-color)';
         
    const delBtn = document.createElement('span');
    delBtn.innerHTML = '&times;';
    delBtn.style.position = 'absolute';
    delBtn.style.top = '-5px';
    delBtn.style.right = '-5px';
    delBtn.style.background = 'var(--danger)';
    delBtn.style.color = 'white';
    delBtn.style.borderRadius = '50%';
    delBtn.style.width = '18px';
    delBtn.style.height = '18px';
    delBtn.style.display = 'flex';
    delBtn.style.alignItems = 'center';
    delBtn.style.justifyContent = 'center';
    delBtn.style.cursor = 'pointer';
    delBtn.style.fontSize = '12px';
    delBtn.style.fontWeight = 'bold';
         
    delBtn.onclick = () => {
      pendingFiles.splice(index, 1);
      renderPendingFiles(); 
    };
    wrapper.appendChild(img);
    wrapper.appendChild(delBtn);
    previewList.appendChild(wrapper);
  });
}

// --- SECURED TASK WORKFLOW MANAGEMENT ---
document.getElementById('add-task-btn').addEventListener('click', async () => {
  const title = document.getElementById('new-task-input').value.trim();
  const assigneeVal = document.getElementById('assignee-select').value;
  const projectId = document.getElementById('task-project-select').value;
  const myName = currentUserProfile?.full_name || 'A teammate';
  const assigneeText = assigneeVal === 'ALL' ? 'everyone' : (allProfiles.find(p => p.id === assigneeVal)?.full_name || 'unassigned');

  if (!title || !projectId) return alert("Title and Project are required.");

  document.getElementById('add-task-btn').textContent = "Saving...";

  const payload = {
    title,
    project_id: projectId,
    org_id: currentUserProfile.org_id,
    category_id: document.getElementById('category-select').value || null,
    priority: document.getElementById('priority-select').value,
    is_group_task: assigneeVal === 'ALL',
    assigned_to: (assigneeVal === 'ALL' || assigneeVal === '') ? null : assigneeVal
  };

  let targetTaskId = editingTaskId;

  if (editingTaskId) {
    await supabase.from('tasks').update(payload).eq('id', editingTaskId);
    sendSystemMessage(payload.project_id, `Automated Update: ${myName} has just updated the task: "${payload.title}".`);
  } else {
    payload.user_id = currentUser.id;
    const { data } = await supabase.from('tasks').insert([payload]).select();
    if(data) {
        newlyAddedTaskId = data[0].id;
        targetTaskId = data[0].id;
    }
    sendSystemMessage(payload.project_id, `Automated Update: ${myName} has set a task: "${payload.title}" for ${assigneeText}. It is ${payload.priority} priority.`);
  }

  if (pendingFiles.length > 0 && targetTaskId) {
    for (const file of pendingFiles) {
      const fileExt = file.name.split('.').pop() || 'png'; 
      const fileName = `${targetTaskId}-${Date.now()}.${fileExt}`;
      const { data: uploadData } = await supabase.storage.from('task-images').upload(fileName, file);

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

    const task = allTasksData.find(t => t.id === id);
    const myName = currentUserProfile?.full_name || 'A teammate';
    const myEl = document.getElementById(`my-task-${id}`);
    const allEl = document.getElementById(`all-task-${id}`);
    const activeElements = [myEl, allEl].filter(el => el !== null);

    activeElements.forEach(el => el.classList.add('anim-slide-out'));
    sendSystemMessage(task.project_id, `Automated Update: ${myName} has deleted the task: "${task.title}".`);

    setTimeout(async () => {
      await supabase.from('tasks').delete().eq('id', id);
      isAnimating = false;
    }, 600);
  }
};

// --- CONVERSATION PIPELINES ---
document.getElementById('send-msg-btn').addEventListener('click', async () => {
    const content = document.getElementById('new-msg-input').value.trim();
    if (!content || activeGlobalProjectId === 'all') return;

    const { error } = await supabase.from('messages').insert([{
        project_id: activeGlobalProjectId,
        user_id: currentUser.id,
        org_id: currentUserProfile.org_id,
        content: content
    }]);
    
    if (error) {
        alert("Failed to deliver update channel broadcast: " + error.message);
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
        .eq('org_id', currentUserProfile.org_id)
        .order('created_at', { ascending: true });
    
    if (data) {
        const msgHtml = data.map(m => {
            const isMe = m.user_id === currentUser.id;
            const timeString = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const deleteBtn = isMe ? `<button class="small-btn danger-btn" style="padding: 2px 6px; margin-left: 10px;" onclick="deleteMessage('${m.id}')">X</button>` : '';

            return `
                <div style="display: flex; flex-direction: column; align-items: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center;">
                        <span style="font-size: 10px; color: var(--text-muted); margin-bottom: 3px;">
                            ${m.profile?.full_name || 'Unknown User'} &middot; ${timeString}
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

// --- VISUAL FILTERS, VIEWPORT SCAN & LIST SORTING ---
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

const visibilityToggle = document.getElementById('visibility-toggle');
if (visibilityToggle) {
  visibilityToggle.addEventListener('change', (e) => {
    if (isAnimating) {
      e.preventDefault(); 
      visibilityToggle.checked = !visibilityToggle.checked; 
      return; 
    }
    const label = document.getElementById('visibility-label');
    const isChecked = visibilityToggle.checked;
    
    if (!isChecked) {
      const completedEls = document.querySelectorAll('.task-item.completed');
      if (completedEls.length > 0) {
        isAnimating = true;
        completedEls.forEach(el => el.classList.add('anim-slide-out'));
        setTimeout(() => {
          hideCompleted = true;
          label.textContent = 'Hide Completed';
          isAnimating = false;
          renderTasks();
        }, 600);
      } else {
        hideCompleted = true;
        label.textContent = 'Hide Completed';
        renderTasks();
      }
    } else {
      hideCompleted = false;
      label.textContent = 'Show Completed';
      triggerSlideInAllCompleted = true;
      renderTasks();
    }
  });
}

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
  
  document.querySelectorAll('.unseen-task').forEach(el => {
    viewportObserver.observe(el);
  });
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

    const assigneeName = t.is_group_task ? '<span style="color:var(--primary-color)">Group Task</span>' : (t.assignee?.full_name || 'Unassigned');
    const imageHtml = t.task_attachments && t.task_attachments.length > 0 
        ? `<div style="display:flex; gap:8px; margin-top: 10px; overflow-x: auto; max-width: 150px;">` + 
          t.task_attachments.map((att, index) => 
            `<img src="${att.file_url}" onclick="openGallery('${t.id}', ${index})" style="height:40px; width:40px; object-fit:cover; cursor:pointer; border-radius:4px; border:1px solid var(--border-color); flex-shrink: 0;">`
          ).join('') + `</div>`
        : '';

    return `
      <div class="task-item ${isCompleted ? 'completed' : ''} ${animClass} ${unseenTaskIds.has(t.id) ? 'unseen-task' : ''}" id="${prefix}-task-${t.id}">
        <div class="task-header" style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
          <div style="display:flex; flex-direction:column; flex:1;">
            <div>
              <div class="task-title" style="font-weight:bold; font-size:16px;">${t.title}</div>
              <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
                [${t.category?.name || 'No Cat'}] &bull; <span class="priority-${t.priority}">${t.priority}</span> &bull; ${assigneeName}
              </div>
            </div>
            ${imageHtml}
          </div>
          <div style="display:flex; align-items:center; gap:15px; margin-left: 15px;">
            <label class="switch" title="${isCompleted ? 'Mark Incomplete' : 'Mark Complete'}">
              <input type="checkbox" ${isCompleted ? 'checked' : ''} onchange="toggleTaskStatus('${t.id}', '${t.status}', this)">
              <span class="slider"></span>
            </label>
            <div style="display:flex; gap:5px; border-left: 1px solid var(--border-color); padding-left: 15px;">
              <button class="small-btn" onclick="editTask('${t.id}')">Edit</button>
              <button class="small-btn danger-btn" onclick="deleteTask('${t.id}')">X</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- TASK STATUS ENGINE ---
window.toggleTaskStatus = async (id, currentStatus, checkboxEl) => {
  if (isAnimating) {
    if (checkboxEl) checkboxEl.checked = !checkboxEl.checked; 
    return;
  }
  
  const task = allTasksData.find(t => t.id === id);
  const myName = currentUserProfile?.full_name || 'A teammate';
  const myEl = document.getElementById(`my-task-${id}`);
  const allEl = document.getElementById(`all-task-${id}`);
  const activeElements = [myEl, allEl].filter(el => el !== null);

  if (currentStatus === 'pending') {
    isAnimating = true;
    sendSystemMessage(task.project_id, `Automated Update - Completed Task: ${myName} has just completed "${task.title}". Go team!`);

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

// --- MEDIA PORTAL PREVIEW GALLERY ---
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
  const urlParts = att.file_url.split('/');
  const fileName = urlParts[urlParts.length - 1];

  await supabase.storage.from('task-images').remove([fileName]);
  await supabase.from('task_attachments').delete().eq('id', att.id);

  currentGalleryAttachments.splice(currentGalleryIndex, 1);
  if (currentGalleryIndex >= currentGalleryAttachments.length) currentGalleryIndex--;
  
  updateGalleryUI();
  fetchTasks();
};

window.deleteMessage = async (id) => {
  if (confirm('Delete this message?')) {
    await supabase.from('messages').delete().eq('id', id);
  }
};

// --- SETTINGS PREFERENCES LOGIC ---
document.getElementById('open-settings-btn').addEventListener('click', () => {
  if (currentUserProfile) {
    document.getElementById('settings-name-input').value = currentUserProfile.full_name || '';
    document.getElementById('settings-default-project').value = currentUserProfile.default_project || 'all';
  }
  document.getElementById('notif-new-task').checked = notifPrefs.newTask;
  document.getElementById('notif-del-task').checked = notifPrefs.delTask;
  document.getElementById('notif-status-task').checked = notifPrefs.statusTask;
  document.getElementById('notif-msg').checked = notifPrefs.newMsg;
  document.getElementById('notif-login').checked = notifPrefs.login;
  openModal('settings-modal');
});

document.getElementById('update-profile-btn').addEventListener('click', async () => {
  const newName = document.getElementById('settings-name-input').value.trim();
  const newDefaultProject = document.getElementById('settings-default-project').value;
  const msgEl = document.getElementById('profile-msg');
  
  msgEl.style.color = "var(--text-main)";
  msgEl.textContent = "Saving profile...";

  const profileUpdate = { full_name: newName };
  profileUpdate.default_project = newDefaultProject === 'all' ? null : newDefaultProject;
  
  const { error: profileError } = await supabase.from('profiles').update(profileUpdate).eq('id', currentUser.id);
  
  if (newName) {
    await supabase.auth.updateUser({
      data: { full_name: newName }
    });
  }
  
  if (profileError) {
    msgEl.style.color = "var(--danger)";
    msgEl.textContent = profileError.message;
  } else {
    msgEl.style.color = "var(--success)";
    msgEl.textContent = "Profile saved successfully!";
    setTimeout(() => {
      msgEl.textContent = '';
      fetchProfiles(); 
      fetchTasks();
    }, 2000);
  }
});

document.getElementById('save-notifs-btn').addEventListener('click', () => {
  if (Notification.permission === 'default') Notification.requestPermission();
  notifPrefs = {
    newTask: document.getElementById('notif-new-task').checked,
    delTask: document.getElementById('notif-del-task').checked,
    statusTask: document.getElementById('notif-status-task').checked,
    newMsg: document.getElementById('notif-msg').checked,
    login: document.getElementById('notif-login').checked
  };
  localStorage.setItem('fieldhub_notifs', JSON.stringify(notifPrefs));
  const msgEl = document.getElementById('notif-msg-text');
  msgEl.textContent = "Preferences saved for this device.";
  setTimeout(() => msgEl.textContent = '', 2000);
});

// --- CORE PASSWORD COMPLIANCE REGEX ENGINE ---
const newPwInput = document.getElementById('new-password');
const confirmPwInput = document.getElementById('confirm-password');
const updatePwBtn = document.getElementById('update-password-btn');
const matchMsg = document.getElementById('match-msg');
const settingsMsg = document.getElementById('settings-msg');

const reqs = {
  length: { el: document.getElementById('req-length'), test: (v) => v.length >= 6 },
  cap: { el: document.getElementById('req-cap'), test: (v) => /[A-Z]/.test(v) },
  num: { el: document.getElementById('req-num'), test: (v) => /[0-9]/.test(v) },
  sym: { el: document.getElementById('req-sym'), test: (v) => /[@$!%*?&]/.test(v) }
};

newPwInput.addEventListener('input', (e) => {
  const val = e.target.value;
  let allMet = true;

  Object.keys(reqs).forEach(key => {
    const isMet = reqs[key].test(val);
    reqs[key].el.className = isMet ? 'req-met' : 'req-unmet';
    reqs[key].el.innerHTML = isMet ? `✅ ${reqs[key].el.innerText.substring(2)}` : `❌ ${reqs[key].el.innerText.substring(2)}`;
    if (!isMet) allMet = false;
  });

  if (allMet) {
    confirmPwInput.disabled = false;
  } else {
    confirmPwInput.disabled = true;
    confirmPwInput.value = '';
    matchMsg.textContent = '';
    updatePwBtn.disabled = true;
  }
  checkMatch();
});

function checkMatch() {
  if (confirmPwInput.value.length > 0) {
    if (confirmPwInput.value === newPwInput.value) {
      matchMsg.textContent = '✅ Passwords match';
      matchMsg.style.color = 'var(--success)';
      updatePwBtn.disabled = false;
    } else {
      matchMsg.textContent = '❌ Passwords do not match';
      matchMsg.style.color = 'var(--danger)';
      updatePwBtn.disabled = true;
    }
  } else {
    matchMsg.textContent = '';
    updatePwBtn.disabled = true;
  }
}
confirmPwInput.addEventListener('input', checkMatch);

updatePwBtn.addEventListener('click', async () => {
  const oldPassword = document.getElementById('old-password').value;
  const newPassword = newPwInput.value;
  if (!oldPassword) return settingsMsg.textContent = 'Please enter your current password.';
  
  settingsMsg.style.color = 'var(--text-main)';
  settingsMsg.textContent = 'Verifying current password...';
  updatePwBtn.disabled = true;

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: currentUser.email,
    password: oldPassword
  });

  if (verifyError) {
    settingsMsg.style.color = 'var(--danger)';
    settingsMsg.textContent = 'Current password is incorrect.';
    updatePwBtn.disabled = false;
    return;
  }

  settingsMsg.textContent = 'Updating password...';
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

  if (updateError) {
    settingsMsg.style.color = 'var(--danger)';
    settingsMsg.textContent = updateError.message;
    updatePwBtn.disabled = false;
  } else {
    settingsMsg.style.color = 'var(--success)';
    settingsMsg.textContent = 'Password updated successfully!';
    setTimeout(() => {
      document.getElementById('old-password').value = '';
      newPwInput.value = '';
      confirmPwInput.value = '';
      newPwInput.dispatchEvent(new Event('input')); 
      settingsMsg.textContent = '';
      closeModal('settings-modal');
    }, 2000);
  }
});

// ==========================================
// --- ROLE-BASED ADMIN PANEL LOGIC ---
// ==========================================

document.getElementById('open-admin-btn').addEventListener('click', () => {
  openModal('admin-modal');
  loadAdminDashboard();
});

async function loadAdminDashboard() {
  const isSuper = currentUserProfile.role === 'super_admin';
  const orgSection = document.getElementById('admin-orgs-section');
  const orgFilter = document.getElementById('admin-user-org-filter');

  // Super Admins get to see and manage Orgs
  if (isSuper) {
    orgSection.classList.remove('hidden');
    orgFilter.classList.remove('hidden');
    
    // Fetch all Orgs
    const { data: orgs } = await supabase.from('organizations').select('*').order('name');
    
    // Populate Org List
    document.getElementById('admin-org-list').innerHTML = orgs.map(o => `
      <div style="display:flex; justify-content:space-between; background:var(--bg-color); padding:10px; border-radius:6px;">
        <span><strong>${o.name}</strong> (Code: ${o.join_code})</span>
        <button class="small-btn danger-btn" onclick="deleteOrg('${o.id}')">Delete</button>
      </div>
    `).join('');

    // Populate the Filter Dropdown
    orgFilter.innerHTML = '<option value="all">View All Organizations</option>' + 
                          orgs.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  }

  fetchAdminUsers(isSuper ? 'all' : currentUserProfile.org_id);
}

// Fetch users based on admin limits
async function fetchAdminUsers(targetOrgId) {
  let query = supabase.from('profiles').select('*, organizations(name)').order('full_name');
  
  // If not filtering for 'all' (or if they are just a general admin), lock the query to a specific org
  if (targetOrgId !== 'all') {
    query = query.eq('org_id', targetOrgId);
  }

  const { data: users } = await query;

  document.getElementById('admin-user-list').innerHTML = users.map(u => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-color); padding:10px; border-radius:6px; opacity: ${u.is_banned ? '0.5' : '1'}">
      <div style="display:flex; flex-direction:column; gap:4px;">
        <strong>${u.full_name || 'Unnamed'}</strong>
        <span style="font-size:12px; color:var(--text-muted);">
          Org: ${u.organizations?.name || 'None'} | Role: <span style="color:var(--primary-color)">${u.role}</span>
        </span>
      </div>
      
      <div style="display:flex; gap:5px; align-items: center;">
        <select onchange="updateUserRole('${u.id}', this.value)" style="padding:4px; margin:0;" ${u.id === currentUser.id ? 'disabled' : ''}>
          <option value="general_user" ${u.role === 'general_user' ? 'selected' : ''}>General User</option>
          <option value="general_admin" ${u.role === 'general_admin' ? 'selected' : ''}>Admin</option>
          ${currentUserProfile.role === 'super_admin' ? `<option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>` : ''}
        </select>
        
        <button class="small-btn ${u.is_banned ? 'success-btn' : 'danger-btn'}" onclick="toggleBan('${u.id}', ${u.is_banned})" ${u.id === currentUser.id ? 'disabled' : ''}>
          ${u.is_banned ? 'Unban' : 'Ban'}
        </button>
      </div>
    </div>
  `).join('');
}

// Re-filter users when super_admin changes the dropdown
document.getElementById('admin-user-org-filter').addEventListener('change', (e) => {
  fetchAdminUsers(e.target.value);
});

// Admin Actions
window.updateUserRole = async (userId, newRole) => {
  await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
  loadAdminDashboard(); // Refresh
};

window.toggleBan = async (userId, currentStatus) => {
  await supabase.from('profiles').update({ is_banned: !currentStatus }).eq('id', userId);
  loadAdminDashboard(); // Refresh
};

document.getElementById('create-org-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-org-name').value.trim();
  const code = document.getElementById('new-org-code').value.trim();
  if (name && code) {
    const { error } = await supabase.from('organizations').insert([{ name, join_code: code }]);
    if (error) alert(error.message);
    else {
      document.getElementById('new-org-name').value = '';
      document.getElementById('new-org-code').value = '';
      loadAdminDashboard();
    }
  }
});


checkSession();