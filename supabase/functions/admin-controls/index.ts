/// <reference lib="deno.window" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = 'https://hwuyvatkyyxfnyzxrcsm.supabase.co';
    
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceRoleKey) {
        throw new Error("CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing from the Edge Function environment.");
    }

    // We only need ONE client now: The Admin Client
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
    
    // Extract the raw JWT token from the frontend request
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error("Missing Authorization header. Are you logged in?")
    
    // Strip the "Bearer " text to get just the token string
    const jwt = authHeader.replace('Bearer ', '')

    // 2. Validate Caller (THE FIX: Pass the jwt directly into getUser)
    const { data: { user: callerUser }, error: authError } = await supabaseAdmin.auth.getUser(jwt)
    
    if (authError || !callerUser) throw new Error(`Auth Error: ${authError?.message || 'No user'}`)

    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single()

    if (profileError) throw new Error(`Profile Check Error: ${profileError.message}`)
    if (callerProfile?.role !== 'super_admin') {
      throw new Error('Forbidden: Only Super Admins can perform this action.')
    }

    // 3. Execute Action
    // Read the body ONCE and store it in a variable
    const body = await req.json();
    const { action, targetUserId, newEmail, email, role, orgId, originUrl } = body;

    if (action === 'invite_collaborator') {
      if (!email) throw new Error('Email is required.');

      // 1. Fetch the Organization Details (Name and Join Code)
      const { data: orgData, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('name, join_code')
        .eq('id', orgId)
        .single();
        
      if (orgError) throw new Error(`Could not find organization: ${orgError.message}`);

      // 2. Create the user
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: crypto.randomUUID(),
        email_confirm: false
      });
      if (createError) throw new Error(`User creation failed: ${createError.message}`);

      // 3. Generate magic link (Upgraded to include the Join Code in the URL)
      // We grab the originUrl that you sent from main.js
      const originUrl = body.originUrl; 

      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery', 
        email: email,
        options: {
          // This tells Supabase to send them back to your site with the code attached
          redirectTo: `${originUrl}?join_code=${orgData.join_code}&setup_password=true`
        }
      });
      if (linkError) throw linkError;

      // 4. Format a Professional HTML Email
      const roleText = role === 'general_admin' ? 'Workspace Admin' : 'Collaborator';
      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <h2 style="color: #1e293b; margin-top: 0;">Welcome to FieldHub Tasks!</h2>
          <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello,</p>
          <p style="color: #475569; font-size: 16px; line-height: 1.6;">You have been invited to join <strong>${orgData.name}</strong> on FieldHub Tasks as a ${roleText}.</p>
          
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 25px 0; border: 1px dashed #cbd5e1;">
            <p style="margin: 0; color: #475569; font-size: 14px;"><strong>Your Workspace Join Code:</strong></p>
            <p style="margin: 5px 0 0 0; font-family: monospace; font-size: 18px; color: #0f172a; font-weight: bold;">${orgData.join_code || 'Not Available'}</p>
          </div>

          <p style="color: #475569; font-size: 16px; line-height: 1.6;">To get started and access your tasks, please click the button below to set up your account password:</p>
          
          <div style="text-align: center; margin: 35px 0;">
            <a href="${linkData.properties.action_link}" style="background-color: #3b82f6; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; display: inline-block;">Set Password & Join</a>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
          <p style="color: #94a3b8; font-size: 13px; text-align: center; margin: 0;">If you did not expect this invitation, you can safely ignore this email.</p>
        </div>
      `;

      // 5. Send email via Resend API
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get('RESEND_API_KEY')}`
        },
        body: JSON.stringify({
          from: " FieldHub User Accounts <noreply@accounts.fieldhub.uk>", 
          to: email,
          subject: `You have been invited to ${orgData.name} on FieldHub Tasks!`,
          html: emailHtml
        })
      });

      if (!res.ok) {
        const errorData = await res.text();
        throw new Error(`Resend API Error: ${errorData}`);
      }

      // 6. Add to organization_members
      await supabaseAdmin.from('organization_members').insert({
        user_id: newUser.user.id,
        org_id: orgId,
        role: role
      });

      return new Response(JSON.stringify({ success: true, message: `Professional invite sent to ${email}!` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'archive_user') {
  // Instead of deleting from Auth, just mark them as archived in your public profiles
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ is_archived: true, is_banned: true }) // Also ban them for good measure
    .eq('id', targetUserId)
  
  if (error) throw new Error(`Archive failed: ${error.message}`)
  return new Response(JSON.stringify({ success: true, message: 'User archived.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
    
    if (action === 'reset_password') {
      const { data: targetData, error: targetError } = await supabaseAdmin.auth.admin.getUserById(targetUserId)
      if (targetError) throw new Error(`Failed to find target user: ${targetError.message}`)
      if (!targetData?.user?.email) throw new Error('This user does not have an email address on file.')
      
      const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(targetData.user.email)
      if (resetError) throw new Error(`Supabase Email Error: ${resetError.message}`)
      
      return new Response(JSON.stringify({ success: true, message: `Password reset email sent to ${targetData.user.email}.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    throw new Error('Invalid Action Provided')

  } catch (error) {
    console.error("Function Error:", error.message)
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }
})