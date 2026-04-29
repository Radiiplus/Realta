import { createClient } from '@supabase/supabase-js';

let supabase = null;
let config = {
  table: 'realta',
  rowId: 'realtadb',
  bucket: 'realta',
  uploadsPrefix: 'uploads',
};

function asTrimmedString(value) {
  return String(value || '').trim();
}

function normalizeUploadsPrefix(value) {
  const clean = asTrimmedString(value).replace(/^\/+|\/+$/g, '');
  return clean || 'uploads';
}

function joinObjectPath(fileToken) {
  const safeToken = asTrimmedString(fileToken).replace(/^\/+|\/+$/g, '');
  if (!safeToken) throw new Error('Invalid storage token.');
  return `${config.uploadsPrefix}/${safeToken}`;
}

function assertSupabaseReady() {
  if (!supabase) {
    throw new Error('Supabase is not initialized.');
  }
}

export function isSupabasePortalEnabled() {
  return asTrimmedString(process.env.SUPABASE_ENABLED).toLowerCase() === 'true';
}

export function initSupabasePortal(options = {}) {
  const supabaseUrl = asTrimmedString(options.url || process.env.SUPABASE_URL);
  const serviceRoleKey = asTrimmedString(options.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase enabled but credentials missing. Provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  config = {
    table: asTrimmedString(options.table || process.env.SUPABASE_PORTAL_TABLE || 'realta') || 'realta',
    rowId: asTrimmedString(options.rowId || process.env.SUPABASE_PORTAL_ROW_ID || 'realtadb') || 'realtadb',
    bucket: asTrimmedString(options.bucket || process.env.SUPABASE_STORAGE_BUCKET || 'realta') || 'realta',
    uploadsPrefix: normalizeUploadsPrefix(options.uploadsPrefix || process.env.SUPABASE_STORAGE_UPLOADS_PREFIX || 'uploads'),
  };

  supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function loadPortalDbFromSupabase() {
  assertSupabaseReady();
  const { data, error } = await supabase
    .from(config.table)
    .select('data')
    .eq('id', config.rowId)
    .maybeSingle();
  if (error) throw error;
  if (!data || typeof data !== 'object') return null;
  if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data)) return null;
  return data.data;
}

export async function savePortalDbToSupabase(db) {
  assertSupabaseReady();
  if (!db || typeof db !== 'object' || Array.isArray(db)) {
    throw new Error('Portal DB payload must be an object.');
  }
  const { error } = await supabase
    .from(config.table)
    .upsert(
      {
        id: config.rowId,
        data: db,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
  if (error) throw error;
}

export async function uploadContentToSupabase(fileToken, fileBuffer, mimeType) {
  assertSupabaseReady();
  const objectPath = joinObjectPath(fileToken);
  const { error } = await supabase
    .storage
    .from(config.bucket)
    .upload(objectPath, fileBuffer, {
      contentType: asTrimmedString(mimeType) || 'application/octet-stream',
      upsert: false,
    });
  if (error) throw error;
}

export async function downloadContentFromSupabase(fileToken) {
  assertSupabaseReady();
  const objectPath = joinObjectPath(fileToken);
  const { data, error } = await supabase.storage.from(config.bucket).download(objectPath);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: asTrimmedString(data.type) || null,
  };
}
