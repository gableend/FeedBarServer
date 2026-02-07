export async function handler() {
  return {
    statusCode: 410,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: false,
      error: "Deprecated. Ingestion handled by Cloud Run worker.",
    }),
  };
}
