const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api") {
      return json({
        name: "Wordle API",
        version: 1,
        status: "ready",
        endpoints: ["GET /api", "GET /api/health"]
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "wordle-api",
        version: 1,
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return json(
        {
          error: "Not found",
          path: url.pathname
        },
        404
      );
    }

    return env.ASSETS.fetch(request);
  }
};
