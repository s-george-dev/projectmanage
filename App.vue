<template>
  <div class="login-wrapper">
    <div class="login-card">
      <div class="logo-container">
        <svg class="photo-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 002-2H4a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      
      <h1>Media Portal</h1>
      <p class="subtitle">Sign in to securely access and manage your Google Photos library.</p>
      
      <button @click="handleLogin" class="google-btn">
        <svg class="google-logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </button>

      <p class="security-note">Secured by Supabase & OAuth 2.0</p>
    </div>
  </div>
</template>

<script setup>
// Look up one folder level to find your keys in the main src folder
import { supabase } from '../supabaseClient'

const handleLogin = async () => {
  console.log("Starting Google login process...")
  
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: 'https://www.googleapis.com/auth/photoslibrary.readonly',
      queryParams: {
        access_type: 'offline',
        prompt: 'consent'
      }
    }
  })
  
  if (error) {
    console.error("Login failed:", error.message)
    alert("There was an issue connecting to Google. Please try again.")
  }
}
</script>

<style scoped>
.login-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background-color: #f3f4f6;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.login-card {
  background: white;
  padding: 3rem 2rem;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
  text-align: center;
  max-width: 400px;
  width: 90%;
  border: 1px solid #e5e7eb;
}

.logo-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  background-color: #eff6ff;
  color: #3b82f6;
  border-radius: 50%;
  margin: 0 auto 1.5rem auto;
}

.photo-icon {
  width: 32px;
  height: 32px;
}

h1 {
  margin: 0 0 0.5rem 0;
  color: #111827;
  font-size: 1.75rem;
}

.subtitle {
  color: #6b7280;
  font-size: 0.95rem;
  margin-bottom: 2rem;
  line-height: 1.5;
}

.google-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  background-color: white;
  color: #374151;
  font-size: 1rem;
  font-weight: 600;
  padding: 12px 24px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.google-btn:hover {
  background-color: #f9fafb;
  border-color: #9ca3af;
}

.google-logo {
  width: 20px;
  height: 20px;
}

.security-note {
  margin-top: 1.5rem;
  font-size: 0.75rem;
  color: #9ca3af;
}
</style>