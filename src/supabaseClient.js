import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Revisa el archivo .env (ver .env.example) o las variables de entorno en Vercel.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
