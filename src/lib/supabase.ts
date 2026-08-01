/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export { supabaseUrl };

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('missing-url')) {
  console.error('CRITICAL: Supabase credentials missing or invalid. Check your environment variables.');
  if (typeof window !== 'undefined') {
    // We can't use alert in iframe safely but we can log clearly
    console.log('%c STOP! Supabase is not configured. %c Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.', 'color: white; background: red; font-size: 20px', 'color: red; font-size: 14px');
  }
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);
