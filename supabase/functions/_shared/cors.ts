/**
 * CORS headers shared across edge functions.
 * Allowed origin is *; tighten in production if you serve the API to a fixed list of origins.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
