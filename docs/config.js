// Public settings for the page. The key below is Supabase's *publishable* (anon) key, which is
// designed to sit in browser code: the database rules in supabase/schema.sql decide what it can do.
// Never put the secret/service_role key here.
// Leave both blank to preview the page with example events.
window.WW_CONFIG = {
  supabaseUrl: 'https://bfpclgyrnonxherhmcwi.supabase.co',      // Supabase -> Project Settings -> API -> Project URL, e.g. https://abcd1234.supabase.co
  supabaseAnonKey: 'sb_publishable_L83k_Ltekxv7orDAG14JAg_IrrtIir1',  // Supabase -> Project Settings -> API Keys -> publishable (or legacy "anon") key
  cohortLabel: 'Berkeley Haas EWMBA',
  adobeFontsKitId: '',  // Adobe Fonts web project ID that includes Larken (fonts.adobe.com -> Web Projects). Blank = Barlow headings.
};
