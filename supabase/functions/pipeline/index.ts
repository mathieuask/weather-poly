// DEPRECATED: replaced by prices + ensembles functions
Deno.serve((_req) => new Response(JSON.stringify({ deprecated: true }), {
  headers: { "Content-Type": "application/json" },
}));
