JavaScript
// supabaseClient.js
import { createClient } from '@supabase/supabase-js'

// 1. Paste your project URL here between the quotes
const supabaseUrl = 'https://hwuyvatkyyxfnyzxrcsm.supabase.co'

// 2. Paste your Anon Key here between the quotes
const supabaseAnonKey = 'sb_publishable_4opExcpgvIsblEQjDfqB3A_VMlCVNdG'

// This creates the connection we will use in the Vue page
export const supabase = createClient(supabaseUrl, supabaseAnonKey)