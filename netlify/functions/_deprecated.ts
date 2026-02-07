export function deprecated(name: string) {
  return {
    statusCode: 410,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: false,
      error: `Deprecated Netlify function (${name}). Use Cloud Run worker.`,
    }),
  };
}

