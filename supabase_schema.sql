-- Execute este código no SQL Editor do Supabase (https://app.supabase.com/)

-- 1. Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabelas Principais
CREATE TABLE IF NOT EXISTS missions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    coordinator_id UUID NOT NULL,
    editor_ids UUID[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    photo_url TEXT,
    whatsapp TEXT,
    role TEXT CHECK (role IN ('admin', 'coordinator', 'editor', 'member')) DEFAULT 'member',
    mission_id UUID REFERENCES missions(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chord_books (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    creator_mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
    shared_with_mission_ids UUID[] DEFAULT '{}',
    is_system BOOLEAN DEFAULT FALSE,
    share_code TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    artist TEXT,
    category TEXT,
    content TEXT NOT NULL,
    original_key TEXT DEFAULT 'C',
    youtube_url TEXT,
    audio_url TEXT,
    attachment_url TEXT,
    attachments JSONB DEFAULT '[]'::jsonb,
    chord_book_id UUID REFERENCES chord_books(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Garantir coluna attachments caso a tabela já exista
ALTER TABLE chords ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS repertoires (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT CHECK (type IN ('missa', 'laudes', 'oração')),
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    rehearsal_date TIMESTAMP WITH TIME ZONE,
    responsible_id UUID REFERENCES auth.users(id),
    mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
    song_ids UUID[] DEFAULT '{}',
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Ativar RLS (Row Level Security)
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chord_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE chords ENABLE ROW LEVEL SECURITY;
ALTER TABLE repertoires ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de Segurança (RLS)

-- ADMIN POLICY: barbosma3@gmail.com
-- Nota: auth.jwt() é usado para verificar o email na sessão do Supabase Auth
CREATE POLICY admin_full_access_profiles ON user_profiles FOR ALL USING (auth.jwt() ->> 'email' = 'barbosma3@gmail.com');
CREATE POLICY admin_full_access_missions ON missions FOR ALL USING (auth.jwt() ->> 'email' = 'barbosma3@gmail.com');
CREATE POLICY admin_full_access_books ON chord_books FOR ALL USING (auth.jwt() ->> 'email' = 'barbosma3@gmail.com');
CREATE POLICY admin_full_access_chords ON chords FOR ALL USING (auth.jwt() ->> 'email' = 'barbosma3@gmail.com');
CREATE POLICY admin_full_access_repertoires ON repertoires FOR ALL USING (auth.jwt() ->> 'email' = 'barbosma3@gmail.com');

-- USER PROFILES: Usuário lê o seu e de outros da mesma missão
CREATE POLICY user_view_profiles ON user_profiles FOR SELECT USING (
    mission_id = (SELECT mission_id FROM user_profiles WHERE id = auth.uid()) OR auth.uid() = id
);
CREATE POLICY user_update_own_profile ON user_profiles FOR UPDATE USING (auth.uid() = id) 
WITH CHECK (auth.uid() = id AND role = role AND mission_id = mission_id); -- Impede mudar role por conta própria

-- MISSIONS: Ver apenas a sua própria missão
CREATE POLICY view_own_mission ON missions FOR SELECT USING (
    id = (SELECT mission_id FROM user_profiles WHERE id = auth.uid())
);
CREATE POLICY coordinator_update_mission ON missions FOR UPDATE USING (
    coordinator_id = auth.uid() OR auth.jwt() ->> 'email' = 'barbosma3@gmail.com'
);

-- REPERTOIRES: Ver se for público ou da mesma missão
CREATE POLICY view_repertoire ON repertoires FOR SELECT USING (
    is_public = true OR mission_id = (SELECT mission_id FROM user_profiles WHERE id = auth.uid())
);
CREATE POLICY manage_repertoire ON repertoires FOR ALL USING (
    mission_id = (SELECT mission_id FROM user_profiles WHERE id = auth.uid()) AND (
        (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin', 'coordinator', 'editor')
    )
);

-- CHORD BOOKS: Ver sistema, criados pela missão ou compartilhados
CREATE POLICY view_books ON chord_books FOR SELECT USING (
    is_system = true OR 
    creator_mission_id = (SELECT mission_id FROM user_profiles WHERE id = auth.uid()) OR
    (SELECT mission_id FROM user_profiles WHERE id = auth.uid()) = ANY(shared_with_mission_ids)
);
CREATE POLICY manage_books ON chord_books FOR ALL USING (
    creator_mission_id = (SELECT mission_id FROM user_profiles WHERE id = auth.uid()) AND (
        (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin', 'coordinator', 'editor')
    )
);

-- CHORDS: Segue acesso do Caderno de Cifras
CREATE POLICY view_chords ON chords FOR SELECT USING (
    EXISTS (SELECT 1 FROM chord_books WHERE id = chords.chord_book_id)
);
CREATE POLICY manage_chords ON chords FOR ALL USING (
    EXISTS (
        SELECT 1 FROM chord_books 
        WHERE id = chords.chord_book_id 
        AND (
            creator_mission_id = (SELECT mission_id FROM user_profiles WHERE id = auth.uid())
            AND (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin', 'coordinator', 'editor')
        )
    )
);

-- Trigger para criar perfil automaticamente no SignUp
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, display_name, role)
  VALUES (
    new.id, 
    new.email, 
    new.raw_user_meta_data->>'full_name',
    CASE WHEN new.email = 'barbosma3@gmail.com' THEN 'admin' ELSE 'member' END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
