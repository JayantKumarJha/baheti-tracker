// =====================================================================
//  BAHETI Tracker - Supabase connection settings
//
//  Paste your two values from the Supabase dashboard:
//    SUPABASE_URL       -> Project Settings > Data API  (Project URL)
//    SUPABASE_ANON_KEY  -> Project Settings > API Keys
//                          use the "Publishable key" (starts with sb_publishable_)
//                          OR the legacy "anon" key (starts with eyJ...)
//
//  This key is SAFE to keep in a public repo - your data is protected by
//  login + Row Level Security (see supabase/schema.sql).
//  NEVER paste the "secret" or "service_role" key here.
// =====================================================================
window.BAHETI_CONFIG = {
  SUPABASE_URL: "https://qnbahugndknhnkantwin.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_9JUTskW6ONd5iQqpDWQ8Tw_UfdNpxT9"
};
