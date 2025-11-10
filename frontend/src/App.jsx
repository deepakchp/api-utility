
import React, { useState, useEffect } from "react";
import { Play, List } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import axios from "axios";

export default function App() {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("https://jsonplaceholder.typicode.com/posts");
  const [headers, setHeaders] = useState([{ key: "Content-Type", value: "application/json" }]);
  const [params, setParams] = useState([]);
  const [body, setBody] = useState("{\n  \"title\": \"foo\",\n  \"body\": \"bar\"\n}");
  const [activeTab, setActiveTab] = useState("body");
  const [response, setResponse] = useState(null);
  const [responsePanelTab, setResponsePanelTab] = useState("body");
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [apiNames, setApiNames] = useState([]);
  const [allApiNames, setAllApiNames] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedApi, setSelectedApi] = useState(null);
  const [collectionItems, setCollectionItems] = useState([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState(null);
  const [environments, setEnvironments] = useState(["local", "dev", "staging", "prod"]);
  const [selectedEnv, setSelectedEnv] = useState("local");

  const runRequest = async () => {
    // build url with query params if provided
    let finalUrl = url || "";
    const queryPairs = (params || []).filter(p => p.key && p.key.trim() !== "");
    if (queryPairs.length) {
      const esc = (s) => encodeURIComponent(s);
      const qs = queryPairs.map(p => `${esc(p.key)}=${esc(p.value || "")}`).join("&");
      // append to existing query string if any
      finalUrl += (finalUrl.includes("?") ? "&" : "?") + qs;
    }

    const payload = { method, url: finalUrl, headers, body, params, environment: selectedEnv };
    if (selectedApi) payload.collectionName = selectedApi;
    if (selectedEndpoint) payload.endpointName = selectedEndpoint;

    const res = await fetch("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setResponse(data);
    setActiveTab("response");
  };

  const updateHeader = (i, key, value) => {
    const copy = [...headers];
    copy[i][key] = value;
    setHeaders(copy);
  };

  const updateParam = (i, key, value) => {
    const copy = [...params];
    copy[i][key] = value;
    setParams(copy);
  };

  const addParam = () => setParams([...params, { key: "", value: "" }]);

  const addHeader = () => setHeaders([...headers, { key: "", value: "" }]);

  // Load API names from server (reads Excel master list)
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await axios.get('/apis');
        if (mounted) {
          const list = Array.isArray(res.data) ? res.data : [];
          setApiNames(list);
          setAllApiNames(list);
        }
      } catch (err) {
        console.error('Failed to load APIs', err);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  // Auto-select first API and its first endpoint after apis load
  useEffect(() => {
    if (allApiNames.length > 0 && !selectedApi) {
      // pick first API by default
      handleSelectApi(allApiNames[0]);
    }
    // only run when allApiNames changes
  }, [allApiNames]);

  const handleSelectApi = async (apiName) => {
    setSelectedApi(apiName);
    // Show only the selected API in the list and populate the search box
    setApiNames([apiName]);
    setSearchTerm(apiName);
    setCollectionItems([]);
    setSelectedEndpoint(null);
    try {
      const res = await axios.get(`/collection/${encodeURIComponent(apiName)}`);
      const collection = res.data;
      // extract all request items from collection (flatten nested folders)
      const extractRequests = (coll) => {
        const out = [];
        const walk = (items) => {
          if (!items) return;
          for (const it of items) {
            if (it.request) out.push({ name: it.name || (it.request && it.request.url && (it.request.url.raw || it.request.url.toString && it.request.url.toString())) || 'Request', request: it.request });
            if (it.item) walk(it.item);
          }
        };
        walk(coll.item || []);
        return out;
      };
      const items = extractRequests(collection);
      if (items.length) {
        setCollectionItems(items);
        // auto-select the first endpoint
        const first = items[0];
        setSelectedEndpoint(first.name);
        const request = first.request;
        // populate request fields
        if (request) {
          if (request.method) setMethod(request.method);
          if (typeof request.url === 'string') setUrl(request.url);
          else if (request.url?.raw) setUrl(request.url.raw);
          else if (request.url?.href) setUrl(request.url.href);
          else if (request.url?.toString) setUrl(request.url.toString());

          const reqHeaders = [];
          const hdrs = request.header || request.headers || [];
          for (const h of hdrs) {
            if (h && (h.key || h.name)) reqHeaders.push({ key: h.key || h.name, value: h.value || h.value });
          }
          if (reqHeaders.length) setHeaders(reqHeaders);

          // extract query params if present
          const reqParams = [];
          const qarr = request.url?.query || request.query || [];
          for (const q of qarr) {
            if (q && (q.key || q.name)) reqParams.push({ key: q.key || q.name, value: q.value || q.value });
          }
          if (reqParams.length) setParams(reqParams);

          const rb = request.body;
          if (rb) {
            if (rb.raw) setBody(rb.raw);
            else if (rb.mode === 'raw' && rb[rb.mode]) setBody(rb[rb.mode]);
            else if (typeof rb === 'string') setBody(rb);
          }
        }
      }
      // Try to extract first request from Postman collection
      const item = collection?.item?.[0] || collection?.items?.[0] || null;
      const request = item?.request || null;
      if (request) {
        // method
        if (request.method) setMethod(request.method);
        // url can be string or object
        if (typeof request.url === 'string') setUrl(request.url);
        else if (request.url?.raw) setUrl(request.url.raw);
        else if (request.url?.href) setUrl(request.url.href);
        else if (request.url?.toString) setUrl(request.url.toString());

        // headers
        const reqHeaders = [];
        const hdrs = request.header || request.headers || [];
        for (const h of hdrs) {
          if (h && (h.key || h.name)) reqHeaders.push({ key: h.key || h.name, value: h.value || h.value });
        }
        if (reqHeaders.length) setHeaders(reqHeaders);

        // extract query params from request.url if available
        const reqParams = [];
        const qarr = request.url?.query || request.query || [];
        for (const q of qarr) {
          if (q && (q.key || q.name)) reqParams.push({ key: q.key || q.name, value: q.value || q.value });
        }
        if (reqParams.length) setParams(reqParams);

        // body
        const rb = request.body;
        if (rb) {
          // raw body
          if (rb.raw) setBody(rb.raw);
          else if (rb.mode === 'raw' && rb[rb.mode]) setBody(rb[rb.mode]);
          else if (typeof rb === 'string') setBody(rb);
        }
      }
    } catch (err) {
      console.error('Failed to load collection for', apiName, err);
    }
  };

  const handleSelectEndpoint = (endpoint) => {
    setSelectedEndpoint(endpoint.name);
    const request = endpoint.request;
    if (!request) return;
    if (request.method) setMethod(request.method);
    if (typeof request.url === 'string') setUrl(request.url);
    else if (request.url?.raw) setUrl(request.url.raw);
    else if (request.url?.href) setUrl(request.url.href);
    else if (request.url?.toString) setUrl(request.url.toString());

    const reqHeaders = [];
    const hdrs = request.header || request.headers || [];
    for (const h of hdrs) {
      if (h && (h.key || h.name)) reqHeaders.push({ key: h.key || h.name, value: h.value || h.value });
    }
    if (reqHeaders.length) setHeaders(reqHeaders);

    // extract query params
    const reqParams = [];
    const qarr = request.url?.query || request.query || [];
    for (const q of qarr) {
      if (q && (q.key || q.name)) reqParams.push({ key: q.key || q.name, value: q.value || q.value });
    }
    if (reqParams.length) setParams(reqParams);

    const rb = request.body;
    if (rb) {
      if (rb.raw) setBody(rb.raw);
      else if (rb.mode === 'raw' && rb[rb.mode]) setBody(rb[rb.mode]);
      else if (typeof rb === 'string') setBody(rb);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <div className="flex items-center bg-white border-b shadow px-4 py-2">
        <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-gray-200 rounded">
          <List size={18} />
        </button>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="border px-2 py-1 rounded mx-2 text-sm font-semibold text-gray-700"
        >
          {["GET", "POST", "PUT", "DELETE", "PATCH"].map(m => <option key={m}>{m}</option>)}
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Enter request URL"
          className="flex-1 border px-3 py-2 rounded mr-2"
        />
        <button
          onClick={runRequest}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center"
        >
          <Play size={16} className="mr-1" /> Send
        </button>
        <button
          onClick={async () => {
            // Save edited request back to collection
            if (!selectedApi) {
              window.alert('Please select a collection to save into');
              return;
            }
            let nameToSave = selectedEndpoint;
            if (!nameToSave) {
              nameToSave = window.prompt('Enter a name for this saved request', `Saved Request ${Date.now()}`);
              if (!nameToSave) return; // cancelled
            }

            const payload = {
              collectionName: selectedApi,
              endpointName: nameToSave,
              request: { method, url, headers, body, params }
            };

            try {
              const res = await fetch('/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
              });
              const data = await res.json();
              if (res.ok) {
                // refresh collection view
                await (async () => {
                  try {
                    const r = await axios.get(`/collection/${encodeURIComponent(selectedApi)}`);
                    const coll = r.data;
                    const extractRequests = (coll) => {
                      const out = [];
                      const walk = (items) => {
                        if (!items) return;
                        for (const it of items) {
                          if (it.request) out.push({ name: it.name || 'Request', request: it.request });
                          if (it.item) walk(it.item);
                        }
                      };
                      walk(coll.item || []);
                      return out;
                    };
                    const items = extractRequests(coll);
                    setCollectionItems(items);
                    setSelectedEndpoint(nameToSave);
                  } catch (e) { /* ignore */ }
                })();
                window.alert('Saved to collection: ' + data.savedName);
              } else {
                window.alert('Failed to save: ' + (data.error || JSON.stringify(data)));
              }
            } catch (err) {
              console.error('Save failed', err);
              window.alert('Save failed: ' + (err.message || err));
            }
          }}
          className="ml-2 bg-gray-200 hover:bg-gray-300 text-gray-900 px-4 py-2 rounded flex items-center"
        >
          Save
        </button>
        <select
          value={selectedEnv}
          onChange={(e) => setSelectedEnv(e.target.value)}
          className="ml-2 border px-2 py-1 rounded text-sm"
          title="Select environment"
        >
          {environments.map((env) => (
            <option key={env} value={env}>{env.toUpperCase()}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {isSidebarOpen && (
          <div className="w-72 bg-gray-50 border-r overflow-hidden flex flex-col">
            <div className="p-4 flex items-center justify-between bg-white border-b">
              <div className="flex items-center space-x-2">
                <div className="text-lg font-semibold text-gray-800">APIs</div>
                <div className="text-sm text-gray-500">{allApiNames.length}</div>
              </div>
              <div className="text-xs text-gray-400">Collections</div>
            </div>

            <div className="p-3 bg-white border-b">
              <input
                value={searchTerm}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchTerm(v);
                  // clear URL when user types
                  setUrl("");
                  // if a collection is selected, typing should clear the collection and restore API search
                  if (selectedApi) {
                    setSelectedApi(null);
                    setApiNames(allApiNames);
                    setCollectionItems([]);
                    setSelectedEndpoint(null);
                  }
                }}
                placeholder="Search APIs..."
                className="w-full border px-3 py-2 rounded text-sm bg-gray-50"
              />
            </div>

            <div className="flex-1 overflow-auto p-2 space-y-1">
              {apiNames.length === 0 && <div className="text-gray-400 p-2">No APIs found</div>}

              {/* If an API is selected and we have collection items, list endpoints */}
              {selectedApi && collectionItems.length > 0 ? (
                <div>
                  <div className="px-2 py-2 text-sm font-medium text-gray-600 border-b">{selectedApi}</div>
                  <div className="p-2">
                    {collectionItems.map((ep) => (
                      <div
                        key={ep.name}
                        onClick={() => handleSelectEndpoint(ep)}
                        className={`cursor-pointer hover:bg-gray-100 p-2 rounded ${selectedEndpoint === ep.name ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-700'}`}
                      >
                        {ep.name}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  {apiNames
                    .filter((n) => n.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((name) => (
                      <div
                        key={name}
                        onClick={() => handleSelectApi(name)}
                        className={`cursor-pointer hover:bg-gray-100 p-2 rounded flex items-center justify-between ${selectedApi === name ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-700'}`}
                      >
                        <div>{name}</div>
                        <div className="text-xs text-gray-400">›</div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="p-3 border-t text-xs text-gray-500 bg-white">Tip: Click an API to load its collection. Use the search above to filter.</div>
          </div>
        )}

        <div className="flex-1 flex flex-col">
          <div className="flex border-b bg-white">
            {["params", "headers", "body", "response"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-semibold ${
                  activeTab === tab ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"
                }`}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto bg-white p-4">
            {activeTab === "headers" && (
              <>
                {headers.map((h, i) => (
                  <div key={i} className="flex mb-2">
                    <input
                      value={h.key}
                      onChange={(e) => updateHeader(i, "key", e.target.value)}
                      placeholder="Header key"
                      className="border px-2 py-1 rounded mr-2 w-1/3"
                    />
                    <input
                      value={h.value}
                      onChange={(e) => updateHeader(i, "value", e.target.value)}
                      placeholder="Header value"
                      className="border px-2 py-1 rounded w-2/3"
                    />
                  </div>
                ))}
                <button onClick={addHeader} className="text-blue-600 text-sm mt-2 hover:underline">
                  + Add Header
                </button>
              </>
            )}

            {activeTab === "params" && (
              <>
                {params.map((p, i) => (
                  <div key={i} className="flex mb-2">
                    <input
                      value={p.key}
                      onChange={(e) => updateParam(i, "key", e.target.value)}
                      placeholder="Query param key"
                      className="border px-2 py-1 rounded mr-2 w-1/3"
                    />
                    <input
                      value={p.value}
                      onChange={(e) => updateParam(i, "value", e.target.value)}
                      placeholder="Query param value"
                      className="border px-2 py-1 rounded w-2/3"
                    />
                  </div>
                ))}
                <button onClick={addParam} className="text-blue-600 text-sm mt-2 hover:underline">
                  + Add Param
                </button>
              </>
            )}

            {activeTab === "body" && (
              <CodeMirror
                value={body}
                height="400px"
                extensions={[json(), EditorView.lineWrapping]}
                theme={oneDark}
                onChange={(v) => setBody(v)}
              />
            )}

            {activeTab === "response" && (
              <div>
                {response ? (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`px-3 py-1 rounded text-white font-semibold`}
                          style={{ background: (response.response?.code >= 200 && response.response?.code < 300) ? '#16a34a' : '#f59e0b' }}
                        >
                          {response.response?.code || '—'}
                        </div>
                        <div className="text-sm text-gray-700">{response.response?.status || ''}</div>
                      </div>
                      <div className="text-sm text-gray-500">{response.time ? `${response.time} ms` : ''}</div>
                    </div>

                    <div className="border-b mb-3">
                      <div className="flex">
                        <button
                          onClick={() => setResponsePanelTab('body')}
                          className={`px-3 py-1 text-sm ${responsePanelTab === 'body' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}
                        >
                          Body
                        </button>
                        <button
                          onClick={() => setResponsePanelTab('headers')}
                          className={`px-3 py-1 text-sm ${responsePanelTab === 'headers' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}
                        >
                          Headers
                        </button>
                      </div>
                    </div>

                    {responsePanelTab === 'headers' ? (
                      <div className="mb-3">
                        <div className="text-sm font-semibold mb-1">Headers</div>
                        <div className="border rounded p-2 bg-gray-50">
                          {(response.response?.headers || []).length === 0 && (
                            <div className="text-sm text-gray-500">No headers</div>
                          )}
                          {(response.response?.headers || []).map((h, idx) => (
                            <div key={idx} className="text-sm">
                              <span className="font-medium">{h.key || h.name}</span>: <span>{h.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                            <CodeMirror
                              value={response.response?.body ? response.response.body : "// No body"}
                              height="400px"
                              extensions={[json(), EditorView.lineWrapping]}
                              theme={oneDark}
                              editable={false}
                            />
                      </div>
                    )}
                  </div>
                ) : (
                  <CodeMirror
                    value="// No response yet"
                    height="400px"
                    extensions={[json(), EditorView.lineWrapping]}
                    theme={oneDark}
                    editable={false}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
