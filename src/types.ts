export type UserRole = 'admin' | 'coordinator' | 'editor' | 'member';

export interface UserProfile {
  id: string;
  uid?: string; // Legacy support
  email: string;
  display_name: string;
  displayName?: string; // Legacy support
  photo_url?: string;
  photoURL?: string; // Legacy support
  whatsapp?: string;
  city?: string;
  full_name?: string;
  role: UserRole;
  mission_id?: string;
  missionId?: string; // Legacy support
  created_at: any;
}

export interface Mission {
  id: string;
  name: string;
  coordinator_id: string;
  coordinatorId?: string; // Legacy support
  editor_ids: string[];
  editorIds?: string[]; // Legacy support
  invite_code: string;
  inviteCode?: string; // Legacy support
  created_at: any;
}

export interface ChordBook {
  id: string;
  name: string;
  mission_id?: string;
  owner_id?: string;
  share_code?: string;
  is_public?: boolean;
  created_at: any;
}

export interface Chord {
  id: string;
  title: string;
  artist: string;
  category: string; // Keep for DB compatibility, will store comma-separated categories
  content: string;
  original_key: string;
  originalKey?: string; // Legacy support
  bpm?: number | null;
  time_signature?: string; // '4/4' | '2/2' | '3/4' | '6/8'
  youtube_url?: string;
  spotify_url?: string;
  youtubeUrl?: string; // Legacy support
  audio_url?: string;
  attachment_url?: string;
  attachments?: { id?: string; name: string; url: string; type: 'audio' | 'text' }[];
  chord_book_id?: string;
  created_at: any;
  updated_at: any;
  // Temporary for backward compatibility in components
  original_key_legacy?: string;
}

export interface Repertoire {
  id: string;
  name: string;
  type: string;
  date: any;
  responsible_id: string | null;
  mission_id: string;
  color: string;
  chord_ids: string[];
  is_public: boolean;
  created_at: any;
}

export interface UserNotification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: any;
}

export interface RepertoireItem {
  id: string;
  repertoire_id: string;
  chord_id: string;
  section: string;
  order_index: number;
  // Tom só para este repertório — sobrepõe o `original_key` global da cifra
  // ao visualizá-la a partir deste repertório específico. `null`/ausente =
  // usa o tom original da cifra.
  display_key?: string | null;
}

export type AttendanceStatus = 'confirmed' | 'declined' | 'tentative' | 'none';

export interface RepertoireAttendance {
  id: string;
  repertoire_id: string;
  user_id: string;
  status: AttendanceStatus;
  role: string | null;
  created_at: any;
  updated_at: any;
}
