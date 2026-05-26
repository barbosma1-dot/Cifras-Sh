-- SQL para Configuração do Supabase (Cifra Mission)

-- 1. Tabela de Perfis de Usuário
CREATE TABLE user_profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  photo_url TEXT,
  whatsapp TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'coordinator', 'editor', 'member')),
  mission_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de Missões
CREATE TABLE missions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  coordinator_id UUID REFERENCES user_profiles(id),
  editor_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabela de Cadernos de Cifras
CREATE TABLE chord_books (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabela de Cifras
CREATE TABLE chords (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  category TEXT,
  content TEXT NOT NULL,
  original_key TEXT,
  youtube_url TEXT,
  chord_book_id UUID REFERENCES chord_books(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabela de Repertórios
CREATE TABLE repertoires (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  date TIMESTAMPTZ NOT NULL,
  responsible_id UUID REFERENCES user_profiles(id),
  mission_id UUID REFERENCES missions(id),
  chord_ids UUID[] DEFAULT '{}',
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS em todas as tabelas
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chord_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE chords ENABLE ROW LEVEL SECURITY;
ALTER TABLE repertoires ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS RLS (Exemplos básicos)

-- User Profiles: Usuário pode ler todos, mas só editar o próprio
CREATE POLICY "Profiles are viewable by everyone" ON user_profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON user_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can update any profile" ON user_profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Missões: Membros da missão ou Admins podem ver
CREATE POLICY "Missions are viewable by members or admins" ON missions FOR SELECT USING (
  auth.uid() = coordinator_id OR 
  auth.uid() = ANY(editor_ids) OR
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND (role = 'admin' OR mission_id = missions.id))
);

-- Cadernos: Público ou membros da missão
CREATE POLICY "Chord books viewable by mission or public" ON chord_books FOR SELECT USING (
  is_public = true OR 
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND mission_id = chord_books.mission_id)
);

-- Cifras: Mesmo que cadernos
CREATE POLICY "Chords viewable through books" ON chords FOR SELECT USING (
  EXISTS (SELECT 1 FROM chord_books WHERE id = chords.chord_book_id AND (is_public = true OR EXISTS (SELECT 1 FROM user_profiles WHERE u.id = auth.uid() AND u.mission_id = mission_id)))
);
