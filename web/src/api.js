// The only file that knows the API's address and how its errors look.
// Every panel calls these helpers, so changing the backend URL is a one-line change.
const BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function request(path, options) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, options);
  } catch {
    throw new Error("Cannot reach the API. Is `uvicorn api.main:app` running?");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      // FastAPI sends a string for our own errors and a list for validation errors
      detail = Array.isArray(body.detail)
        ? body.detail.map((d) => `${d.loc[d.loc.length - 1]}: ${d.msg}`).join("; ")
        : body.detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(detail);
  }
  return res.json();
}

const post = (path, body) =>
  request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const getHealth = () => request("/health");
export const getQueries = () => request("/queries");
export const getQuery = (name) => request(`/query/${name}`);
export const explain = (mix) => post("/explain", mix);
export const runExperiment = (settings) => post("/experiment", settings);
