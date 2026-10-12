export const getGoogleData = (u: any) => {
  const gid = u?.identities?.find((i: any) => i.provider === 'google');
  const meta = u?.user_metadata || {};
  const idData = gid?.identity_data || {};
  return {
    hasGoogle: !!gid || u?.app_metadata?.provider === 'google',
    name: String(meta.full_name || meta.name || idData.full_name || idData.name || '').trim(),
    photo: String(meta.avatar_url || meta.picture || idData.avatar_url || idData.picture || '').trim(),
  };
};

export const isPlaceholderName = (name?: string | null, email?: string | null): boolean => {
  const n = String(name || '').trim().toLowerCase();
  return !n || n === 'nome' || n === 'usuário' || n === 'usuario' || n === 'novo usuário' || n === String(email || '').split('@')[0].toLowerCase();
};
