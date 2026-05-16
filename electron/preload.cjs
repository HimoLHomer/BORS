const { contextBridge, ipcRenderer } = require("electron");

function headersToObject(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === "function") {
    headers.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  return { ...headers };
}

contextBridge.exposeInMainWorld("__borsIpcFetch", async (url, init = {}) => {
  const payload = {
    url,
    init: {
      method: init.method,
      headers: headersToObject(init.headers),
      body:
        typeof init.body === "string" || init.body == null ?
          init.body
        : JSON.stringify(init.body),
    },
  };
  const res = await ipcRenderer.invoke("bors:fetch", payload);
  return new Response(res.bodyText, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
});
