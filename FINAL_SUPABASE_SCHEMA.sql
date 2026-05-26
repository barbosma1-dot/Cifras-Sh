-- CIFRA MISSION - SCHEMA DEFINITIVO V14 (IDEMPOTENT POLICIES + FIXES)

-- 1. GARANTIR QUE AS TABELAS BASE EXISTAM
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE,
    full_name TEXT,
    mission_id UUID,
    role TEXT DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    display_name TEXT,
    photo_url TEXT
);

CREATE TABLE IF NOT EXISTS missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    coordinator_id UUID REFERENCES user_profiles(id),
    invite_code TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de membros da missão (Relacionamento M-M)
CREATE TABLE IF NOT EXISTS mission_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, mission_id)
);

-- Tabela principal de Cifras
CREATE TABLE IF NOT EXISTS chords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    artist TEXT,
    category TEXT,
    content TEXT,
    original_key TEXT,
    youtube_url TEXT,
    audio_url TEXT,
    attachment_url TEXT,
    attachments JSONB DEFAULT '[]'::jsonb,
    owner_id UUID REFERENCES user_profiles(id),
    chord_book_id UUID, -- Mantido para legado durante migração
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir coluna attachments caso a tabela já exista
ALTER TABLE chords ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Chord Books (Cadernos de Cifras)
CREATE TABLE IF NOT EXISTS chord_books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    mission_id UUID, -- Mantido para legado durante migração
    owner_id UUID REFERENCES user_profiles(id),
    share_code TEXT UNIQUE,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de itens do caderno (Cifras vinculadas)
CREATE TABLE IF NOT EXISTS chord_book_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID REFERENCES chord_books(id) ON DELETE CASCADE,
    chord_id UUID REFERENCES chords(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(book_id, chord_id)
);

-- Tabela de vinculação de cadernos a múltiplas missões
CREATE TABLE IF NOT EXISTS chord_book_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID REFERENCES chord_books(id) ON DELETE CASCADE,
    mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(book_id, mission_id)
);

-- Tabela de acesso manual a cadernos via código
CREATE TABLE IF NOT EXISTS chord_book_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    book_id UUID REFERENCES chord_books(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, book_id)
);

-- Repertórios
CREATE TABLE IF NOT EXISTS repertoires (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT,
    date TIMESTAMPTZ NOT NULL,
    rehearsal_date TIMESTAMPTZ,
    responsible_id UUID REFERENCES user_profiles(id),
    mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
    color TEXT DEFAULT 'white',
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repertoire_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repertoire_id UUID REFERENCES repertoires(id) ON DELETE CASCADE,
    chord_id UUID REFERENCES chords(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(repertoire_id, chord_id, section)
);

CREATE TABLE IF NOT EXISTS repertoire_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repertoire_id UUID REFERENCES repertoires(id) ON DELETE CASCADE,
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'none',
    role TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(repertoire_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. LIMPEZA DE POLÍTICAS ANTIGAS
DO $$ 
DECLARE 
    pol record;
BEGIN 
    FOR pol IN (
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename IN (
            'user_profiles', 'missions', 'chord_books', 'chords', 
            'repertoires', 'mission_members', 'repertoire_items', 
            'user_notifications', 'chord_book_items', 'chord_book_access',
            'chord_book_missions', 'repertoire_attendance'
        )
    )
    LOOP
        EXECUTE format('DROP POLICY %I ON %I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- 3. FUNÇÕES RPC (SECURITY DEFINER para quebrar recursão de RLS)
CREATE OR REPLACE FUNCTION check_can_edit_book(p_book_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM chord_books 
        WHERE id = p_book_id 
        AND (
            owner_id = auth.uid() 
            OR (auth.jwt() ->> 'email') = 'barbosma1@gmail.com'
            OR EXISTS (
                SELECT 1 FROM chord_book_missions cbm
                JOIN mission_members mm ON cbm.mission_id = mm.mission_id
                WHERE cbm.book_id = p_book_id 
                AND mm.user_id = auth.uid() 
                AND mm.role IN ('coordinator', 'editor', 'admin')
            )
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION check_can_view_book(p_book_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM chord_books cb
        WHERE cb.id = p_book_id
        AND (
            cb.is_public = true OR 
            cb.owner_id = p_user_id OR
            (auth.jwt() ->> 'email') = 'barbosma1@gmail.com' OR
            EXISTS (
                SELECT 1 FROM chord_book_missions cbm
                JOIN mission_members mm ON cbm.mission_id = mm.mission_id
                WHERE cbm.book_id = cb.id AND mm.user_id = p_user_id
            ) OR
            EXISTS (
                SELECT 1 FROM chord_book_access cba
                WHERE cba.book_id = cb.id AND cba.user_id = p_user_id
            )
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_accessible_chord_books(p_user_id UUID)
RETURNS SETOF chord_books AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT cb.* FROM chord_books cb
    LEFT JOIN chord_book_missions cbm ON cb.id = cbm.book_id
    LEFT JOIN mission_members mm ON cbm.mission_id = mm.mission_id
    WHERE 
        cb.is_public = true OR
        cb.owner_id = p_user_id OR
        mm.user_id = p_user_id OR
        cb.id IN (SELECT book_id FROM chord_book_access WHERE user_id = p_user_id) OR
        EXISTS (SELECT 1 FROM user_profiles WHERE id = p_user_id AND role = 'admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. MIGRAÇÃO E RECUPERAÇÃO DE DADOS (CRÍTICO)

-- Garantir que a Missão de Guarulhos exista
INSERT INTO missions (name, invite_code)
VALUES ('Missão Guarulhos', 'GUA011')
ON CONFLICT (invite_code) DO NOTHING;

-- Sincronizar membros a partir do legacy field mission_id (Cura de Guarulhos e outras)
INSERT INTO mission_members (user_id, mission_id, role)
SELECT id, mission_id, COALESCE(role, 'member')
FROM user_profiles 
WHERE mission_id IS NOT NULL
ON CONFLICT (user_id, mission_id) DO UPDATE SET role = EXCLUDED.role;

-- Se o usuário barbosma1 estiver sem missão, associar a Guarulhos como exemplo de fix
DO $$
DECLARE
    v_guarulhos_id UUID;
    v_user_id UUID;
BEGIN
    SELECT id INTO v_guarulhos_id FROM missions WHERE name ILIKE '%Guarulhos%' LIMIT 1;
    SELECT id INTO v_user_id FROM user_profiles WHERE email = 'barbosma1@gmail.com' LIMIT 1;
    
    IF v_guarulhos_id IS NOT NULL AND v_user_id IS NOT NULL THEN
        INSERT INTO mission_members (user_id, mission_id, role)
        VALUES (v_user_id, v_guarulhos_id, 'admin')
        ON CONFLICT DO NOTHING;
        
        -- Facilitar para outros que possam estar sem missão mas eram de Guarulhos
        -- (Isso assume que Guarulhos é a missão padrão para quem ficou órfão na migração)
        UPDATE user_profiles SET mission_id = v_guarulhos_id WHERE mission_id IS NULL AND email LIKE '%@%';
    END IF;
END $$;

INSERT INTO chord_book_items (book_id, chord_id)
SELECT chord_book_id, id FROM chords 
WHERE chord_book_id IS NOT NULL
ON CONFLICT (book_id, chord_id) DO NOTHING;

INSERT INTO chord_book_missions (book_id, mission_id)
SELECT id, mission_id FROM chord_books 
WHERE mission_id IS NOT NULL 
ON CONFLICT DO NOTHING;

-- Garantir que repertoires tenham mission_id (baseado no responsável ou legado)
UPDATE repertoires r
SET mission_id = mm.mission_id
FROM mission_members mm
WHERE r.mission_id IS NULL 
AND r.responsible_id = mm.user_id;

-- 5. HABILITAR RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chords ENABLE ROW LEVEL SECURITY;
ALTER TABLE chord_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE chord_book_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE chord_book_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chord_book_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE repertoires ENABLE ROW LEVEL SECURITY;
ALTER TABLE repertoire_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE repertoire_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

-- 6. NOVAS POLÍTICAS ROBUSTAS (IDEMPOTENTES)

-- USER PROFILES
DROP POLICY IF EXISTS "Profiles_Public_Read" ON user_profiles;
CREATE POLICY "Profiles_Public_Read" ON user_profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS "Profiles_Owner_Manage" ON user_profiles;
CREATE POLICY "Profiles_Owner_Manage" ON user_profiles FOR ALL USING (auth.uid() = id);
DROP POLICY IF EXISTS "Profiles_Admin" ON user_profiles;
CREATE POLICY "Profiles_Admin" ON user_profiles FOR ALL USING ((auth.jwt() ->> 'email') = 'barbosma1@gmail.com');

-- MISSIONS
DROP POLICY IF EXISTS "Missions_Read_All" ON missions;
CREATE POLICY "Missions_Read_All" ON missions FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Missions_Manage_Coordinator" ON missions;
CREATE POLICY "Missions_Manage_Coordinator" ON missions FOR ALL USING (
    coordinator_id = auth.uid() OR (auth.jwt() ->> 'email') = 'barbosma1@gmail.com'
);

-- MISSION MEMBERS
DROP POLICY IF EXISTS "Members_Select_All" ON mission_members;
CREATE POLICY "Members_Select_All" ON mission_members FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Members_Manage_Coordinator" ON mission_members;
CREATE POLICY "Members_Manage_Coordinator" ON mission_members FOR ALL USING (
    mission_id IN (SELECT id FROM missions WHERE coordinator_id = auth.uid()) OR
    (auth.jwt() ->> 'email') = 'barbosma1@gmail.com'
);

-- CHORDS
DROP POLICY IF EXISTS "Chords_Select_Public" ON chords;
CREATE POLICY "Chords_Select_Public" ON chords FOR SELECT USING (true);
DROP POLICY IF EXISTS "Chords_Manage_Owner" ON chords;
CREATE POLICY "Chords_Manage_Owner" ON chords FOR ALL USING (
    owner_id = auth.uid() OR (auth.jwt() ->> 'email') = 'barbosma1@gmail.com' OR auth.role() = 'authenticated'
);

-- CHORD BOOKS
DROP POLICY IF EXISTS "Books_Select" ON chord_books;
CREATE POLICY "Books_Select" ON chord_books FOR SELECT USING (check_can_view_book(id, auth.uid()));

DROP POLICY IF EXISTS "Books_Manage_Owner" ON chord_books;
CREATE POLICY "Books_Manage_Owner" ON chord_books FOR ALL USING (
    owner_id = auth.uid() OR 
    (auth.jwt() ->> 'email') = 'barbosma1@gmail.com'
);

-- CHORD BOOK ITEMS
DROP POLICY IF EXISTS "BookItems_Select_Public" ON chord_book_items;
CREATE POLICY "BookItems_Select_Public" ON chord_book_items FOR SELECT USING (true);
DROP POLICY IF EXISTS "BookItems_Manage" ON chord_book_items;
CREATE POLICY "BookItems_Manage" ON chord_book_items FOR ALL USING (
    check_can_edit_book(book_id)
);

-- CHORD BOOK MISSIONS
DROP POLICY IF EXISTS "BookMissions_Select_Public" ON chord_book_missions;
CREATE POLICY "BookMissions_Select_Public" ON chord_book_missions FOR SELECT USING (true);
DROP POLICY IF EXISTS "BookMissions_Manage" ON chord_book_missions;
CREATE POLICY "BookMissions_Manage" ON chord_book_missions FOR ALL USING (
    check_can_edit_book(book_id)
);

-- CHORD BOOK ACCESS
DROP POLICY IF EXISTS "BookAccess_Select" ON chord_book_access;
CREATE POLICY "BookAccess_Select" ON chord_book_access FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "BookAccess_Manage" ON chord_book_access;
CREATE POLICY "BookAccess_Manage" ON chord_book_access FOR ALL USING (
    check_can_edit_book(book_id) OR
    user_id = auth.uid()
);

-- REPERTOIRES
DROP POLICY IF EXISTS "Repertoires_Select" ON repertoires;
CREATE POLICY "Repertoires_Select" ON repertoires FOR SELECT USING (
    is_public = true OR
    (auth.jwt() ->> 'email') = 'barbosma1@gmail.com' OR
    mission_id IN (SELECT mission_id FROM mission_members WHERE user_id = auth.uid()) OR
    responsible_id = auth.uid()
);
DROP POLICY IF EXISTS "Repertoires_Manage" ON repertoires;
CREATE POLICY "Repertoires_Manage" ON repertoires FOR ALL USING (
    (auth.jwt() ->> 'email') = 'barbosma1@gmail.com' OR
    mission_id IN (SELECT id FROM missions WHERE coordinator_id = auth.uid()) OR
    mission_id IN (SELECT mission_id FROM mission_members WHERE user_id = auth.uid() AND role IN ('coordinator', 'editor', 'admin')) OR
    responsible_id = auth.uid()
);

-- REPERTOIRE ITEMS
DROP POLICY IF EXISTS "RepertoireItems_Select_Public" ON repertoire_items;
CREATE POLICY "RepertoireItems_Select_Public" ON repertoire_items FOR SELECT USING (true);
DROP POLICY IF EXISTS "RepertoireItems_Manage" ON repertoire_items;
CREATE POLICY "RepertoireItems_Manage" ON repertoire_items FOR ALL USING (
    (auth.jwt() ->> 'email') = 'barbosma1@gmail.com' OR
    repertoire_id IN (
        SELECT r.id FROM repertoires r 
        INNER JOIN mission_members mm ON r.mission_id = mm.mission_id
        WHERE mm.user_id = auth.uid() AND mm.role IN ('coordinator', 'editor', 'admin', 'moderator')
    ) OR
    repertoire_id IN (SELECT id FROM repertoires WHERE responsible_id = auth.uid())
);

-- ATTENDANCE
DROP POLICY IF EXISTS "Attendance_Select_Public" ON repertoire_attendance;
CREATE POLICY "Attendance_Select_Public" ON repertoire_attendance FOR SELECT USING (true);
DROP POLICY IF EXISTS "Attendance_Manage_Own" ON repertoire_attendance;
CREATE POLICY "Attendance_Manage_Own" ON repertoire_attendance FOR ALL USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Attendance_Admin" ON repertoire_attendance;
CREATE POLICY "Attendance_Admin" ON repertoire_attendance FOR ALL USING (
    (auth.jwt() ->> 'email') = 'barbosma1@gmail.com' OR
    repertoire_id IN (
        SELECT id FROM repertoires 
        WHERE mission_id IN (SELECT mission_id FROM mission_members WHERE user_id = auth.uid() AND role IN ('coordinator', 'editor', 'admin'))
    )
);

-- NOTIFICATIONS
DROP POLICY IF EXISTS "Notifications_Manage_Own" ON user_notifications;
CREATE POLICY "Notifications_Manage_Own" ON user_notifications FOR ALL USING (user_id = auth.uid());

-- FINALIZAÇÃO: Garantir admin
UPDATE user_profiles SET role = 'admin' WHERE email = 'barbosma1@gmail.com';

