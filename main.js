import { createClient } from 'https://esm.sh/@supabase/supabase-js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@latest/modular/sortable.esm.js';

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

// NEW: Multi-Tenant State
let activeOrgId = null;
let activeRole = 'general_user';
let myOrgs = [];

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

// --- INIT, AUTH & WORKSPACE INITIALIZATION ---
async function checkSession() {
  const isSetup = new URLSearchParams(window.location.search).get('setup_password');
  if (isSetup) return;

  const { data: { session } } = await supabase.auth.getSession();
  
  if (session) {
    currentUser = session.user;
    
    try {
      const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
      if (error) console.error("Profile Fetch Error:", error.message);

      // Check for Bans
      if (profile?.is_banned) {
        alert("Your account has been suspended. Please contact your administrator.");
        await supabase.auth.signOut();
        return location.reload();
      }

      if (profile && !profile.email && currentUser.email) {
        await supabase.from('profiles').update({ email: currentUser.email }).eq('id', currentUser.id);
        profile.email = currentUser.email;
      }

            
      // Fetch user's workspaces from the junction table
      const { data: memberships } = await supabase
        .from('organization_members')
        .select('role, org_id, organizations(id, name, join_code)')
        .eq('user_id', currentUser.id);

      myOrgs = memberships || [];

      const authSect = document.getElementById('auth-section');
      const appSect = document.getElementById('app-section');
      const orgModal = document.getElementById('org-modal');

      // Lock Screen if they belong to zero workspaces
      if (myOrgs.length === 0) {
        if (authSect) authSect.classList.add('hidden');
        if (appSect) appSect.classList.add('hidden');
        if (orgModal) orgModal.classList.add('active');
      } 
      else {
        currentUserProfile = profile;
        
        // Determine the Active Workspace
        activeOrgId = profile.last_active_org_id;
        let currentMembership = myOrgs.find(m => m.org_id === activeOrgId);
        
        if (!currentMembership) {
            activeOrgId = profile.default_org_id || myOrgs[0].org_id;
            currentMembership = myOrgs.find(m => m.org_id === activeOrgId);
        }
        activeRole = currentMembership.role;

        // Populate the Header Workspace Switcher
        const wsSelect = document.getElementById('active-org-select');
        if (wsSelect) {
            wsSelect.innerHTML = myOrgs.map(m => `<option value="${m.org_id}" ${m.org_id === activeOrgId ? 'selected' : ''}>🏢 ${m.organizations.name}</option>`).join('');
        }
        // --- POPULATE TOP NAV PROFILE ---
      if (currentUser && profile) {
          const friendlyName = profile.full_name || currentUser.email.split('@')[0];
          document.getElementById('nav-user-name').textContent = friendlyName;
          document.getElementById('nav-user-email').textContent = currentUser.email;
          
          // Generate Avatar Initial
          document.getElementById('nav-user-avatar').textContent = friendlyName.charAt(0);
      }
        // --- NEW PLACEMENT: UPDATE UI AFTER DATA IS LOADED ---
        
        // Update the Role Badge Text
        let roleText = "General User";
        if (activeRole === 'super_admin') roleText = "Super Admin";
        else if (activeRole === 'general_admin') roleText = "Admin";
        document.getElementById('nav-user-role').textContent = roleText;

        // Show/Hide Admin Sidebar Buttons
        const adminBtns = document.querySelectorAll('.admin-only');
        if (activeRole === 'super_admin' || activeRole === 'general_admin') {
            adminBtns.forEach(btn => btn.classList.remove('hidden'));
        } else {
            adminBtns.forEach(btn => btn.classList.add('hidden'));
        }

        // Update Top Nav Org Name
        if (wsSelect && wsSelect.options.length > 0) {
            document.getElementById('top-nav-org-name').textContent = wsSelect.options[wsSelect.selectedIndex].text;
        }

        // --- END NEW PLACEMENT ---

        // Reveal Admin Panel Button if they have authority in THIS workspace
        if (activeRole === 'super_admin' || activeRole === 'general_admin') {
          const adminBtn = document.getElementById('nav-admin-panel-btn');
          if (adminBtn) adminBtn.classList.remove('hidden');
        }

        // Reveal Admin Panel Button if they have authority in THIS workspace
        if (activeRole === 'super_admin' || activeRole === 'general_admin') {
          const adminBtn = document.getElementById('nav-admin-panel-btn');
          if (adminBtn) adminBtn.classList.remove('hidden');
        }

        if (authSect) authSect.classList.add('hidden');
        if (orgModal) orgModal.classList.remove('active');
        if (appSect) appSect.classList.remove('hidden');
        
        loadAppData();
        setupRealtime(); 
        
        if (Notification.permission === 'default') Notification.requestPermission();
      }
    } catch (err) {
      console.error("Crash during login sequence:", err);
    }
  }
}

// Header Workspace Switcher Logic
const orgSelectDropdown = document.getElementById('active-org-select');
if (orgSelectDropdown) {
    orgSelectDropdown.addEventListener('change', async (e) => {
        activeOrgId = e.target.value;
        // Save to profile so it remembers where they left off
        await supabase.from('profiles').update({ last_active_org_id: activeOrgId }).eq('id', currentUser.id);
        // Securely reload the app to purge old data and re-initialize the real-time sockets
        location.reload(); 
    });
}

// Lock Screen Verification Logic (First time join)
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

  await supabase.from('profiles').upsert({
    id: currentUser.id,
    email: currentUser.email, // NEW: Saves the email directly
    full_name: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
    last_active_org_id: org.id
  });
  // Then add them to the junction table
  const { error } = await supabase.from('organization_members').insert({
    user_id: currentUser.id,
    org_id: org.id,
    role: 'general_user'
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
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) alert("Google Connection Interrupted: " + error.message);
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

// --- REALTIME ENGINE (ISOLATED TO ACTIVE WORKSPACE) ---
function setupRealtime() {
  const channel = supabase.channel(`fieldhub-sync-${activeOrgId}`);
  let presenceInitialized = false; 

  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `org_id=eq.${activeOrgId}` }, fetchProjects)
    
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `org_id=eq.${activeOrgId}` }, (payload) => {
      fetchMessages();
      if (payload.new.user_id !== currentUser.id && notifPrefs.newMsg && Notification.permission === 'granted') {
        new Notification("New Message", { 
          body: payload.new.content, 
          icon: "https://fieldhub.uk/assets/images/favicon-transparent.png",
          tag: "fieldhub-chat" 
        });
      }
    })

    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `org_id=eq.${activeOrgId}` }, async (payload) => {
      await fetchTasks();
      if (Notification.permission !== 'granted') return;

      const isMine = payload.new?.user_id === currentUser.id || payload.old?.user_id === currentUser.id;

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

// --- SECURED FETCH PIPELINES (NOW FILTERED BY ACTIVE ORG ID) ---
async function loadAppData() {
  await fetchProjects();
  await fetchCategories();
  await fetchProfiles();
  await fetchTasks();
  await fetchMessages();
}

async function fetchProjects() {
  const { data } = await supabase.from('projects').select('*').eq('org_id', activeOrgId).order('name');
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
  const { data } = await supabase.from('categories').select('*').eq('org_id', activeOrgId).order('name');
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
  // We join through organization_members to get the correct users for THIS workspace
  const { data } = await supabase.from('organization_members').select('profiles(*)').eq('org_id', activeOrgId);
  if (data) {
    allProfiles = data.map(m => m.profiles).filter(Boolean); 
    const options = allProfiles.map(p => `<option value="${p.id}">${p.full_name}</option>`).join('');
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
      org_id: activeOrgId,
      content: content
  }]);
}

async function fetchTasks() {
  const { data } = await supabase
    .from('tasks')
    .select('*, category:categories(name), project:projects(name), assignee:profiles!tasks_assigned_to_fkey(full_name), task_attachments(id, file_url)')
    .eq('org_id', activeOrgId);
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
    document.getElementById('join-msg').textContent = '';
    document.getElementById('workspace-pref-msg').textContent = '';
    newPw.dispatchEvent(new Event('input')); 
  }
};

// --- SIDEBAR NAVIGATION LISTENERS ---
const navNewTaskBtn = document.getElementById('nav-new-task-btn');
if (navNewTaskBtn) {
  navNewTaskBtn.addEventListener('click', () => {
    if(activeGlobalProjectId !== 'all') {
        document.getElementById('task-project-select').value = activeGlobalProjectId;
    }
    openModal('task-modal');
  });
}

const navNewProjectBtn = document.getElementById('nav-new-project-btn');
if (navNewProjectBtn) {
  navNewProjectBtn.addEventListener('click', () => openModal('project-modal'));
}

const navCategoriesBtn = document.getElementById('nav-categories-btn');
if (navCategoriesBtn) {
  navCategoriesBtn.addEventListener('click', () => openModal('cat-modal'));
}

// --- WRITE PIPELINES ---
document.getElementById('add-proj-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-proj-input').value.trim();
  if (name) {
    await supabase.from('projects').insert([{ name, org_id: activeOrgId }]);
    document.getElementById('new-proj-input').value = '';
    closeModal('project-modal');
  }
});

document.getElementById('add-cat-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-cat-input').value.trim();
  if (name) {
    await supabase.from('categories').insert([{ name, org_id: activeOrgId }]);
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
    org_id: activeOrgId,
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
        org_id: activeOrgId,
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
    const chatTitle = document.getElementById('chat-card-title');
    const chatInputArea = document.getElementById('chat-input-area');

    // 1. Toggle UI between Updates Mode and Chat Mode
    if (activeGlobalProjectId === 'all') {
        if(chatTitle) chatTitle.innerHTML = "📢 Workspace Updates";
        // THE FIX: Directly manipulate the style to override inline CSS
        if(chatInputArea) chatInputArea.style.display = 'none'; 
    } else {
        if(chatTitle) chatTitle.innerHTML = "💬 Project Chat";
        // Bring it back as a flex container
        if(chatInputArea) chatInputArea.style.display = 'flex'; 
    }

    // 2. Fetch the data
    let query = supabase
        .from('messages')
        .select('*, profile:profiles(full_name)')
        .eq('org_id', activeOrgId)
        .order('created_at', { ascending: true });

    // THE FIX: Use .is('project_id', null) for the global updates board
    if (activeGlobalProjectId === 'all') {
        query = query.is('project_id', null);
    } else {
        query = query.eq('project_id', activeGlobalProjectId);
    }

    const { data, error } = await query;
    if (error) console.error("Message Fetch Error:", error.message);

    if (data) {
        // 3. Filter out expired updates
        const now = new Date();
        const validMessages = data.filter(m => !m.expires_at || new Date(m.expires_at) > now);

        const msgHtml = validMessages.map(m => {
            const isMe = m.user_id === currentUser.id;
            
            // ROLE-BASED DELETION LOGIC
            let canDelete = false;
            if (activeRole === 'super_admin') canDelete = true;
            else if (activeRole === 'general_admin' && isMe) canDelete = true;
            // general_user remains false implicitly

            const deleteBtn = canDelete ? `<button class="small-btn danger-btn" style="padding: 2px 6px; margin-left: 10px;" onclick="deleteMessage('${m.id}')">X</button>` : '';
            
            // Styling logic (Updates look like announcements, Chat looks like bubbles)
            const isUpdate = activeGlobalProjectId === 'all';
            const bubbleColor = isMe && !isUpdate ? 'var(--primary-color)' : 'var(--surface-color)';
            const textColor = isMe && !isUpdate ? '#000' : 'var(--text-main)';
            const dateStr = new Date(m.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
            const timeStr = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return `
                <div style="display: flex; flex-direction: column; align-items: ${isMe && !isUpdate ? 'flex-end' : 'flex-start'}; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center;">
                        <span style="font-size: 11px; color: var(--text-muted); margin-bottom: 3px; font-weight: bold;">
                            ${m.profile?.full_name || 'Unknown User'} &middot; ${dateStr} at ${timeStr}
                        </span>
                        ${deleteBtn}
                    </div>
                    <div style="background: ${bubbleColor}; color: ${textColor}; padding: 10px 14px; border-radius: 8px; max-width: 85%; word-wrap: break-word; border: ${isUpdate ? '1px solid var(--success)' : 'none'}">
                        ${m.content}
                    </div>
                </div>
            `;
        }).join('');

        const msgList = document.getElementById('message-list');
        const emptyText = activeGlobalProjectId === 'all' ? "No active workspace updates at this time." : "No messages yet. Start the conversation!";
        msgList.innerHTML = msgHtml || `<p style="color: var(--text-muted); text-align: center; margin-top: 20px;">${emptyText}</p>`;
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
// --- DASHBOARD LAYOUT & DRAG ENGINE ---
const dashCanvas = document.getElementById('dashboard-canvas');
const layoutMode = document.getElementById('layout-mode');
const gridColumns = document.getElementById('grid-columns');

// 1. Initialize Drag and Drop
if (dashCanvas) {
    new Sortable(dashCanvas, {
        animation: 150,
        handle: '.drag-handle', // Only allows dragging from the top bar
        ghostClass: 'sortable-ghost', // Styling for the drop placeholder
        onEnd: () => {
            // Future-proofing: You can save the new card order to localStorage or the DB here
            console.log("Dashboard layout rearranged");
        }
    });
}

// 2. Handle Layout Switching
if (layoutMode && gridColumns && dashCanvas) {
    layoutMode.addEventListener('change', (e) => {
        if (e.target.value === 'grid') {
            dashCanvas.classList.remove('stacked-mode');
            dashCanvas.classList.add('grid-mode');
            dashCanvas.classList.add(`cols-${gridColumns.value}`);
            gridColumns.classList.remove('hidden');
        } else {
            dashCanvas.classList.remove('grid-mode', 'cols-1', 'cols-2', 'cols-3');
            dashCanvas.classList.add('stacked-mode');
            gridColumns.classList.add('hidden');
        }
    });

    // 3. Handle Column Adjustments
    gridColumns.addEventListener('change', (e) => {
        dashCanvas.classList.remove('cols-1', 'cols-2', 'cols-3');
        dashCanvas.classList.add(`cols-${e.target.value}`);
    });
}

function renderTasks() {
  // Preserve your animation locks
  if (isAnimating) return;

  // 1. GRAB GLOBAL FILTERS (Using strict existence checks)
  const priorityEl = document.getElementById('global-filter-priority');
  const sortEl = document.getElementById('global-sort');
  const toggleEl = document.getElementById('visibility-toggle');
  
  const globalPriority = priorityEl ? priorityEl.value : 'All';
  const globalSort = sortEl ? sortEl.value : 'newest';
  const showCompleted = toggleEl ? toggleEl.checked : true;

  // 2. GRAB SPECIFIC SEARCH & USER FILTERS
  const searchMyEl = document.getElementById('search-my');
  const searchAllEl = document.getElementById('search-all');
  const filterUserEl = document.getElementById('filter-user-all');

  const searchMy = searchMyEl ? searchMyEl.value.toLowerCase() : '';
  const searchAll = searchAllEl ? searchAllEl.value.toLowerCase() : '';
  const userAll = filterUserEl ? filterUserEl.value : 'All';

  // 3. PRE-FILTER SHOW COMPLETED TOGGLE (Applies to everything)
  let visibleData = allTasksData;
  if (!showCompleted) {
      // Assuming your database uses 'Completed' or a boolean. Adjust if needed!
      visibleData = visibleData.filter(t => t.status !== 'Completed' && t.is_completed !== true);
  }

  // 4. PROCESS MY TASKS (Injecting the global variables)
  let myTasks = visibleData.filter(t => t.assigned_to === currentUser.id || t.is_group_task);
  myTasks = processList(myTasks, searchMy, globalPriority, globalSort, 'All');
  
  // 5. PROCESS ALL TASKS (Injecting the exact same global variables)
  let allTasks = processList(visibleData, searchAll, globalPriority, globalSort, userAll);

  // 6. RENDER HTML USING YOUR HELPER
  const myTaskList = document.getElementById('my-task-list');
  const allTaskList = document.getElementById('all-task-list');
  
  if (myTaskList) myTaskList.innerHTML = buildHTML(myTasks, 'my');
  if (allTaskList) allTaskList.innerHTML = buildHTML(allTasks, 'all');
  
  // 7. PRESERVE OBSERVERS AND STATE RESETS
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
const navSettingsBtn = document.getElementById('nav-settings-btn');
if (navSettingsBtn) {
  navSettingsBtn.addEventListener('click', () => {
    if (currentUserProfile) {
      document.getElementById('settings-name-input').value = currentUserProfile.full_name || '';
      document.getElementById('settings-default-project').value = currentUserProfile.default_project || 'all';
      
      // Load Workspace Settings
      document.getElementById('settings-default-workspace').innerHTML = myOrgs.map(m => `<option value="${m.org_id}">${m.organizations.name}</option>`).join('');
      document.getElementById('settings-default-workspace').value = currentUserProfile.default_org_id || activeOrgId;
    }
    document.getElementById('notif-new-task').checked = notifPrefs.newTask;
    document.getElementById('notif-del-task').checked = notifPrefs.delTask;
    document.getElementById('notif-status-task').checked = notifPrefs.statusTask;
    document.getElementById('notif-msg').checked = notifPrefs.newMsg;
    document.getElementById('notif-login').checked = notifPrefs.login;

    // NEW: Hide/Show Broadcast Tool based on Role
    const broadcastSect = document.getElementById('settings-broadcast-section');
    if (broadcastSect) {
        if (activeRole === 'super_admin' || activeRole === 'general_admin') {
            broadcastSect.classList.remove('hidden');
        } else {
            broadcastSect.classList.add('hidden');
        }
    }
    
    openModal('settings-modal');
  });
}

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

// NEW: Settings "Join Another Workspace" Flow
document.getElementById('settings-join-btn').addEventListener('click', async () => {
  const code = document.getElementById('settings-join-code').value.trim();
  const msg = document.getElementById('join-msg');
  if(!code) return msg.textContent = "Please enter a Join Code.";

  msg.style.color = "var(--text-main)";
  msg.textContent = "Verifying...";

  const { data: org } = await supabase.from('organizations').select('id, name').eq('join_code', code).maybeSingle();

  if(!org) {
    msg.style.color = "var(--danger)";
    return msg.textContent = "Invalid Join Code.";
  }

  const { error } = await supabase.from('organization_members').insert({
    user_id: currentUser.id,
    org_id: org.id,
    role: 'general_user'
  });

  if(error) {
    msg.style.color = "var(--danger)";
    return msg.textContent = "You are already a member of this workspace.";
  }
  
  msg.style.color = "var(--success)";
  msg.textContent = `Successfully joined ${org.name}! Reloading...`;
  setTimeout(() => location.reload(), 1500);
});

// NEW: Settings "Save Default Workspace" Flow
document.getElementById('save-workspace-prefs-btn').addEventListener('click', async () => {
  const newDefaultOrgId = document.getElementById('settings-default-workspace').value;
  const msg = document.getElementById('workspace-pref-msg');
  
  const { error } = await supabase.from('profiles').update({ default_org_id: newDefaultOrgId }).eq('id', currentUser.id);
  
  if (error) {
      msg.style.color = "var(--danger)";
      msg.textContent = error.message;
  } else {
      msg.style.color = "var(--success)";
      msg.textContent = "Default workspace saved!";
      setTimeout(() => msg.textContent = '', 2000);
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
const navAdminPanelBtn = document.getElementById('nav-admin-panel-btn');
if (navAdminPanelBtn) {
  navAdminPanelBtn.addEventListener('click', () => {
    openModal('admin-modal');
    loadAdminDashboard();
  });
}

async function loadAdminDashboard() {
  const isSuper = activeRole === 'super_admin';
  const orgSection = document.getElementById('admin-orgs-section');
  const orgFilter = document.getElementById('admin-user-org-filter');

  if (isSuper) {
    orgSection.classList.remove('hidden');
    orgFilter.classList.remove('hidden');
    
    const { data: orgs } = await supabase.from('organizations').select('*').order('name');
    
    document.getElementById('admin-org-list').innerHTML = orgs.map(o => `
      <div style="display:flex; justify-content:space-between; background:var(--bg-color); padding:10px; border-radius:6px;">
        <span><strong>${o.name}</strong> (Code: ${o.join_code})</span>
        <button class="small-btn danger-btn" onclick="deleteOrg('${o.id}')">Delete</button>
      </div>
    `).join('');

    orgFilter.innerHTML = '<option value="all">View All Organizations</option>' + orgs.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  }

  fetchAdminUsers(isSuper ? 'all' : activeOrgId);
}

async function fetchAdminUsers(targetOrgId) {
  let query = supabase.from('organization_members').select('role, org_id, profiles(id, full_name, is_banned, email), organizations(name)');
  
  if (targetOrgId !== 'all') query = query.eq('org_id', targetOrgId);

  const { data: members } = await query;

  document.getElementById('admin-user-list').innerHTML = members.map(m => {
    const u = m.profiles;
    if(!u) return '';

    const isMe = u.id === currentUser.id;
    
// Add this to your admin-modal render logic
const inviteSection = (activeRole === 'super_admin' || activeRole === 'general_admin') ? `
  <div style="background: var(--surface-light); padding: 15px; margin-top: 20px; border-radius: 8px;">
    <h4 style="margin-top:0;">Invite New Collaborator</h4>
    <div style="display: flex; gap: 10px;">
        <input type="email" id="invite-email-field" placeholder="colleague@email.com" style="flex:1;">
        <select id="invite-role-field">
            <option value="general_user">General User</option>
            <option value="general_admin">Admin</option>
        </select>
        <button class="success-btn" onclick="triggerInvite()">Invite</button>
    </div>
  </div>
` : '';

// Add this helper function
window.triggerInvite = () => {
    const email = document.getElementById('invite-email-field').value;
    const role = document.getElementById('invite-role-field').value;
    inviteCollaborator(email, role);
};

    // CONSISTENT PROTECTION: 
    // If the account being rendered is a super_admin, 
    // they are ALWAYS protected, even from other admins.
    const isTargetSuper = m.role === 'super_admin';
    
    let controlsHtml = '';
    
    if (isTargetSuper) {
        // This is a Super Admin - apply the protected label and strip all controls
        controlsHtml = `<span style="font-size:12px; color:var(--text-muted); font-weight:bold; padding-right:10px;">Protected Account</span>`;
    } else {
        // This is NOT a Super Admin - apply standard controls
        const backdoorBtns = activeRole === 'super_admin' ? `
          <button class="small-btn secondary-btn" onclick="adminAction('reset_password', '${u.id}')" title="Send Password Reset Email" ${isMe ? 'disabled' : ''}>📧 Reset</button>
          <button class="small-btn danger-btn" onclick="adminAction('delete_user', '${u.id}')" title="Hard Delete Account" ${isMe ? 'disabled' : ''}>🗑 Nuke</button>
        ` : '';

        controlsHtml = `
        <select onchange="updateUserRole('${u.id}', '${m.org_id}', this.value)" style="padding:4px; margin:0;" ${isMe ? 'disabled' : ''}>
          <option value="general_user" ${m.role === 'general_user' ? 'selected' : ''}>General User</option>
          <option value="general_admin" ${m.role === 'general_admin' ? 'selected' : ''}>Admin</option>
          ${activeRole === 'super_admin' ? `<option value="super_admin" ${m.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>` : ''}
        </select>
        
        <button class="small-btn ${u.is_banned ? 'success-btn' : 'danger-btn'}" onclick="toggleBan('${u.id}', ${u.is_banned})" ${isMe ? 'disabled' : ''}>
          ${u.is_banned ? 'Unban' : 'Ban'}
        </button>
        ${backdoorBtns}`;
    }

    return `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-color); padding:10px; border-radius:6px; opacity: ${u.is_banned ? '0.5' : '1'}">
      <div style="display:flex; flex-direction:column; gap:4px;">
        <strong>${u.full_name || 'Unnamed'}</strong>
        <span style="font-size:11px; color:var(--text-muted); font-family: monospace;">
          ${u.email || 'No email saved'} | ID: ${u.id}
        </span>
        <span style="font-size:12px; color:var(--text-muted);">
          Org: ${m.organizations?.name || 'None'} | Role: <span style="color:var(--primary-color)">${m.role}</span>
        </span>
      </div>
      
      <div style="display:flex; gap:5px; align-items: center;">
        ${controlsHtml}
      </div>
    </div>
  `}).join('');
}

document.getElementById('admin-user-org-filter').addEventListener('change', (e) => fetchAdminUsers(e.target.value));

window.updateUserRole = async (userId, targetOrgId, newRole) => {
  await supabase.from('organization_members').update({ role: newRole }).match({ user_id: userId, org_id: targetOrgId });
  loadAdminDashboard(); 
};

window.toggleBan = async (userId, currentStatus) => {
  await supabase.from('profiles').update({ is_banned: !currentStatus }).eq('id', userId);
  loadAdminDashboard(); 
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

document.getElementById('send-invite-btn').addEventListener('click', async () => {
    const email = document.getElementById('invite-email').value;
    const role = document.getElementById('invite-role-field')?.value || 'general_user';
    
    if(!email) return alert("Enter email");

    // Show a loading state
    const btn = document.getElementById('send-invite-btn');
    btn.textContent = "Sending...";
    btn.disabled = true;

    try {
        // Call the Edge Function
       const { data, error } = await supabase.functions.invoke('admin-controls', {
            body: { 
                action: 'invite_collaborator', 
                email: email, 
                role: role,
                orgId: activeOrgId,
                originUrl: window.location.origin // Tells the server where your app is hosted
            }
        });

        if (error || data.error) throw new Error(error?.message || data.error);

        alert(data.message);
        document.getElementById('invite-email').value = ''; // Clear input
    } catch (err) {
        alert("Invitation Failed: " + err.message);
    } finally {
        btn.textContent = "Invite User";
        btn.disabled = false;
    }
});

window.adminAction = async (actionType, targetUserId) => {
  let payload = { action: actionType, targetUserId };
  
  if (actionType === 'delete_user') {
    if (!confirm('WARNING: This will permanently destroy this user account across all workspaces. Proceed?')) return;
  }
  
  if (actionType === 'reset_password') {
    if (!confirm('Send a password recovery email to this user?')) return;
  }

  try {
   
    const { data, error } = await supabase.functions.invoke('admin-controls', {
      body: payload
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    alert(data.message);
    loadAdminDashboard(); // Refresh UI
  } catch (err) {
    alert("Admin Action Failed: " + err.message);
  }
};

window.inviteCollaborator = async (email, role) => {
  try {
    const { data, error } = await supabase.functions.invoke('admin-controls', {
     body: { 
        action: 'invite_collaborator', 
        email: email, 
        role: role,
        orgId: activeOrgId // Send the currently active workspace ID
      }
    });

    if (error || data.error) throw new Error(error?.message || data.error);
    alert(data.message);
  } catch (err) {
    alert("Invitation Failed: " + err.message);
  }
};

// Run this when the page loads
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('join_code');
    const setupPassword = urlParams.get('setup_password');

    if (setupPassword) {
        // 1. Forcefully hide all standard app views
        const authSection = document.getElementById('auth-section');
        if (authSection) authSection.classList.add('hidden');

        const orgModal = document.getElementById('org-modal');
        if (orgModal) {
            orgModal.classList.remove('active');
            orgModal.style.display = 'none'; // Hard override
        }

        const appSection = document.getElementById('app-section');
        if (appSection) appSection.classList.add('hidden');

        // 2. Show the secure setup view
        const setupView = document.getElementById('setup-password-view');
        if (setupView) {
            setupView.style.display = 'block';
        }

        // 3. Pre-fill the join code automatically
        if (joinCode) {
            const joinInput = document.getElementById('setup-join-code');
            if (joinInput) joinInput.value = joinCode;
        }

        // 4. Initialize live validation
        initPasswordValidation();
    }
});

function initPasswordValidation() {
    const passInput = document.getElementById('setup-password');
    const confirmInput = document.getElementById('setup-confirm-password');
    const submitBtn = document.getElementById('setup-submit-btn');

    const reqLength = document.getElementById('setup-req-length');
    const reqUpper = document.getElementById('setup-req-upper');
    const reqNum = document.getElementById('setup-req-num');
    const reqSym = document.getElementById('setup-req-sym');
    const reqMatch = document.getElementById('setup-req-match');

    const validate = () => {
        const val = passInput.value;
        const confirmVal = confirmInput.value;
        let isValid = true;

        // Validation Rules
        const isLength = val.length >= 6;
        const isUpper = /[A-Z]/.test(val);
        const isNum = /[0-9]/.test(val);
        const isSym = /[^A-Za-z0-9]/.test(val);
        const isMatch = val === confirmVal && val !== '';

        // UI Updates (Restoring the explicit ✓ and ✗ icons)
        reqLength.style.color = isLength ? '#22c55e' : '#ef4444';
        reqLength.textContent = isLength ? '✓ Minimum 6 characters' : '✗ Minimum 6 characters';

        reqUpper.style.color = isUpper ? '#22c55e' : '#ef4444';
        reqUpper.textContent = isUpper ? '✓ One uppercase letter' : '✗ One uppercase letter';

        reqNum.style.color = isNum ? '#22c55e' : '#ef4444';
        reqNum.textContent = isNum ? '✓ One number' : '✗ One number';

        reqSym.style.color = isSym ? '#22c55e' : '#ef4444';
        reqSym.textContent = isSym ? '✓ One symbol (@$!%*?&)' : '✗ One symbol (@$!%*?&)';

        reqMatch.style.color = isMatch ? '#22c55e' : '#ef4444';
        reqMatch.textContent = isMatch ? '✓ Passwords match' : '✗ Passwords match';

        // Toggle Button State
        isValid = isLength && isUpper && isNum && isSym && isMatch;
        if (isValid) {
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
            submitBtn.style.cursor = 'pointer';
        } else {
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.5';
            submitBtn.style.cursor = 'not-allowed';
        }
    };

    // Listen to every keystroke
    passInput.addEventListener('input', validate);
    confirmInput.addEventListener('input', validate);

    // Handle Secure Submission
    submitBtn.addEventListener('click', async () => {
        submitBtn.textContent = 'Securing Account & Building Profile...';
        submitBtn.disabled = true;

        // 1. Update the Password in Auth
        const { data: authData, error: pwError } = await supabase.auth.updateUser({
            password: passInput.value
        });

        if (pwError) {
            alert("Security Error: " + pwError.message);
            submitBtn.textContent = 'Add Password & Join Workspace';
            submitBtn.disabled = false;
            return;
        }

        // 2. FOOLPROOF FIX: Force Profile and Workspace Initialization
        const joinCode = document.getElementById('setup-join-code').value;
        const authUser = authData.user;

        if (joinCode && authUser) {
            // Find the Org ID from the code
            const { data: org } = await supabase.from('organizations').select('id').eq('join_code', joinCode).maybeSingle();
            
            if (org) {
                // A. Guarantee the profile exists so checkSession() doesn't crash
                await supabase.from('profiles').upsert({
                    id: authUser.id,
                    email: authUser.email,
                    full_name: authUser.email.split('@')[0], // Uses the start of their email as a temp name
                    last_active_org_id: org.id
                });

                // B. Guarantee they are locked into the workspace table
                await supabase.from('organization_members').upsert({
                    user_id: authUser.id,
                    org_id: org.id,
                    role: 'general_user' // Will just act as a fallback if the Edge Function missed them
                }, { onConflict: 'user_id, org_id', ignoreDuplicates: true });
            }
        }

        // 3. Clean the URL and Reload into the main dashboard
        window.history.replaceState({}, document.title, window.location.pathname);
        location.reload(); 
    });
}
// --- ADMIN BROADCAST PIPELINE ---
const sendBroadcastBtn = document.getElementById('send-broadcast-btn');
if (sendBroadcastBtn) {
    sendBroadcastBtn.addEventListener('click', async () => {
        const content = document.getElementById('broadcast-input').value.trim();
        const expiryDays = document.getElementById('broadcast-expiry').value;
        const msgEl = document.getElementById('broadcast-msg');

        if (!content) return;

        msgEl.style.color = "var(--text-main)";
        msgEl.textContent = "Broadcasting...";

        // Calculate Expiry Timestamp
        let expiresAt = null;
        if (expiryDays !== 'never') {
            const date = new Date();
            date.setDate(date.getDate() + parseInt(expiryDays));
            expiresAt = date.toISOString();
        }

        const { error } = await supabase.from('messages').insert([{
            project_id: null, 
            user_id: currentUser.id,
            org_id: activeOrgId,
            content: content,
            expires_at: expiresAt
        }]);

        if (error) {
            msgEl.style.color = "var(--danger)";
            msgEl.textContent = error.message;
        } else {
            msgEl.style.color = "var(--success)";
            msgEl.textContent = "Broadcast published to workspace!";
            document.getElementById('broadcast-input').value = '';
            fetchMessages(); // Auto-refresh the view
            setTimeout(() => msgEl.textContent = '', 2000);
        }
    });
}

checkSession();