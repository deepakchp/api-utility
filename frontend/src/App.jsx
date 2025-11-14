
import React, { useState, useEffect } from "react";
import { Play, List, Key } from "lucide-react";
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
  const [selectedEnv, setSelectedEnv] = useState("sit");
  const [environmentVars, setEnvironmentVars] = useState([]);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [envEditorOpen, setEnvEditorOpen] = useState(false);
  const [envEditValues, setEnvEditValues] = useState([]);
  const [showConsole, setShowConsole] = useState(false);
  const [lastRequest, setLastRequest] = useState(null);
  const [lastResponse, setLastResponse] = useState(null);
  const [showReqHeaders, setShowReqHeaders] = useState(true);
  const [showReqBody, setShowReqBody] = useState(true);
  const [showResHeaders, setShowResHeaders] = useState(false);
  const [showResBody, setShowResBody] = useState(true);
  
  const substituteVars = (text, envVals) => {
    if (!text || typeof text !== 'string') return text;
    if (!Array.isArray(envVals)) return text;
    let out = text;
    for (const v of envVals) {
      if (!v || !v.key) continue;
      const key = v.key;
      const val = v.value == null ? '' : String(v.value);
      // replace all occurrences of {{key}}
      out = out.split(`{{${key}}}`).join(val);
    }
    return out;
  };

  const renderHeaders = (hdrs, envVals) => {
    if (!hdrs) return [];
    if (Array.isArray(hdrs)) {
      return hdrs.map(h => ({ key: h.key || h.name || '', value: substituteVars(h.value || '', envVals) }));
    }
    // if object map
    return Object.entries(hdrs).map(([k, v]) => ({ key: k, value: substituteVars(v, envVals) }));
  };
  
  const prettyBody = (b) => {
    if (!b) return '';
    try {
      return JSON.stringify(typeof b === 'string' ? JSON.parse(b) : b, null, 2);
    } catch (e) {
      return String(b);
    }
  };

  const buildRawRequest = (req) => {
    if (!req) return '';
    try {
      const u = new URL(req.url);
      const start = `${(req.method || 'GET').toUpperCase()} ${u.pathname}${u.search || ''} HTTP/1.1`;
      const hdrs = Array.isArray(req.headers) ? req.headers.map(h => `${h.key || h.name}: ${h.value || ''}`) : [];
      // ensure Host header present
      if (!hdrs.find(h => h.toLowerCase().startsWith('host:'))) hdrs.push(`Host: ${u.host}`);
      // content-length naive
      if (req.body && !hdrs.find(h => h.toLowerCase().startsWith('content-length:'))) hdrs.push(`Content-Length: ${String((req.body || '').length)}`);
      const headerBlock = showReqHeaders ? hdrs.join('\n') : '';
      const bodyBlock = showReqBody ? prettyBody(req.body) : '';
      const parts = [start];
      if (headerBlock) parts.push(headerBlock);
      parts.push('');
      if (bodyBlock) parts.push(bodyBlock);
      return parts.join('\n');
    } catch (e) {
      return `${(req.method || 'GET').toUpperCase()} ${req.url || '-'} HTTP/1.1\n\n${prettyBody(req.body)}`;
    }
  };

  const buildRawResponse = (res) => {
    if (!res || !res.response) return '';
    const code = res.response.code || '-';
    const status = res.response.status || '';
    const start = `HTTP/1.1 ${code} ${status}`.trim();
    const hdrsArr = Array.isArray(res.response.headers) ? res.response.headers.map(h => `${h.key || h.name}: ${h.value || ''}`) : [];
    const headerBlock = showResHeaders ? hdrsArr.join('\n') : '';
    const bodyBlock = showResBody ? prettyBody(res.response?.body) : '';
    const parts = [start];
    if (headerBlock) parts.push(headerBlock);
    parts.push('');
    if (bodyBlock) parts.push(bodyBlock);
    return parts.join('\n');
  };

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

  const payload = { method, url: finalUrl, headers, body, params, environment: { name: selectedEnv, values: environmentVars } };
    if (selectedApi) payload.collectionName = selectedApi;
    if (selectedEndpoint) payload.endpointName = selectedEndpoint;

    // prepare a display payload with environment substitutions for the console
    const displayPayload = {
      ...payload,
      url: substituteVars(payload.url || '', environmentVars),
      headers: renderHeaders(payload.headers || [], environmentVars),
      body: substituteVars(payload.body || '', environmentVars),
    };
    // prepare actual run payload with substitutions so server/newman receives resolved values
    const runPayload = {
      ...payload,
      url: substituteVars(payload.url || '', environmentVars),
      headers: renderHeaders(payload.headers || [], environmentVars),
      body: substituteVars(payload.body || '', environmentVars),
    };

    // record to console
    setLastRequest(displayPayload);
    setLastResponse(null);

    const res = await fetch("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runPayload),
    });
    const data = await res.json();
    setResponse(data);
    setLastResponse(data);
    setActiveTab("response");
  };

  const buildUrlFromRequestUrl = (rUrl) => {
    if (!rUrl) return '';
    if (typeof rUrl === 'string') return rUrl;
    if (rUrl.raw) return rUrl.raw;
    // Try protocol + host + path
    const protocol = rUrl.protocol || '';
    let host = '';
    if (Array.isArray(rUrl.host)) host = rUrl.host.join('.');
    else if (rUrl.host) host = rUrl.host;
    else if (rUrl.hostname) host = rUrl.hostname;

    let path = '';
    if (Array.isArray(rUrl.path)) path = rUrl.path.join('/');
    else if (rUrl.path) path = rUrl.path;

    let url = '';
    if (protocol) url += protocol + '://';
    if (host) url += host;
    if (path) url += (host && !path.startsWith('/') ? '/' : '') + path;

    // append query if present
    const q = rUrl.query || rUrl.rawQuery || rUrl.queryParams || [];
    const qarr = Array.isArray(q) ? q : [];
    if (qarr.length) {
      const qs = qarr.map(p => `${encodeURIComponent(p.key || p.name)}=${encodeURIComponent(p.value || '')}`).join('&');
      url += (url.includes('?') ? '&' : '?') + qs;
    }
    return url || '';
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

  // Load available environments from server
  useEffect(() => {
    let mounted = true;
    const loadEnvs = async () => {
      try {
        const res = await axios.get('/environments');
        if (!mounted) return;
        const list = Array.isArray(res.data) ? res.data : [];
        if (list.length) {
          setEnvironments(list);
          // pick first env if current selection isn't present
          if (!list.includes(selectedEnv)) setSelectedEnv(list[0]);
        } else {
          // keep existing defaults
        }
      } catch (err) {
        console.error('Failed to load environments', err);
      }
    };
    loadEnvs();
    return () => { mounted = false; };
  }, []);

  // When selectedEnv changes, load its variables
  useEffect(() => {
    if (!selectedEnv) return;
    let mounted = true;
    const load = async () => {
      try {
        const res = await axios.get(`/environment/${encodeURIComponent(selectedEnv)}`);
        if (!mounted) return;
        const envObj = res.data;
        setEnvironmentVars(Array.isArray(envObj.values) ? envObj.values : []);
      } catch (err) {
        // not fatal, clear vars
        setEnvironmentVars([]);
      }
    };
    load();
    return () => { mounted = false; };
  }, [selectedEnv]);

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
          const built = buildUrlFromRequestUrl(request.url);
          if (built) setUrl(built);

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
        const built = buildUrlFromRequestUrl(request.url);
        if (built) setUrl(built);

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
    const built = buildUrlFromRequestUrl(request.url);
    if (built) setUrl(built);

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
    <div className="h-screen flex flex-col bg-gray-100 pb-28">
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
        <button
          onClick={() => {
            // open editor popup with a mutable copy of current env vars
            setEnvEditValues((environmentVars || []).map(v => ({ ...v })));
            setEnvEditorOpen(true);
          }}
          className="ml-2 border px-2 py-1 rounded text-sm bg-white hover:bg-gray-100"
          title="Open environment variables editor"
        >
          Vars
        </button>
      </div>

      {/* Environment variables preview panel */}
      {showEnvVars && (
        <div className="bg-white border-b p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold">Environment: {selectedEnv && selectedEnv.toUpperCase()}</div>
            <div className="text-xs text-gray-500">{environmentVars.length} variables</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            {environmentVars.length === 0 && (
              <div className="text-gray-500">No variables for this environment</div>
            )}
            {environmentVars.map((v, i) => (
              <div key={i} className={`p-2 rounded border ${!v.enabled ? 'opacity-60' : ''}`}>
                <div className="font-mono text-xs text-gray-700">{v.key}</div>
                <div className="text-sm text-gray-900 break-words">{String(v.value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Environment editor modal */}
      {envEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black opacity-40" onClick={() => setEnvEditorOpen(false)} />
          <div className="bg-white rounded shadow-lg w-11/12 max-w-2xl z-10 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Edit Environment: {selectedEnv && selectedEnv.toUpperCase()}</div>
              <div className="space-x-2">
                <button onClick={() => setEnvEditorOpen(false)} className="px-3 py-1 rounded border">Cancel</button>
                <button onClick={async () => {
                  try {
                    // send edited values to backend
                    await axios.post(`/environment/${encodeURIComponent(selectedEnv)}`, { values: envEditValues });
                    // reload environment variables from server
                    const res = await axios.get(`/environment/${encodeURIComponent(selectedEnv)}`);
                    setEnvironmentVars(Array.isArray(res.data.values) ? res.data.values : []);
                    setEnvEditorOpen(false);
                    alert('Environment saved');
                  } catch (err) {
                    console.error('Failed to save environment', err);
                    alert('Failed to save environment: ' + (err?.response?.data?.error || err.message || err));
                  }
                }} className="px-3 py-1 rounded bg-blue-600 text-white">Save</button>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-auto">
              {envEditValues.length === 0 && <div className="text-gray-500">No variables. Add one below.</div>}
              {envEditValues.map((v, i) => (
                <div key={i} className="flex items-center space-x-2">
                  <input className="flex-1 border px-2 py-1 rounded" value={v.key || ''} onChange={(e) => {
                    const copy = [...envEditValues]; copy[i].key = e.target.value; setEnvEditValues(copy);
                  }} placeholder="key" />
                  <input className="flex-2 border px-2 py-1 rounded" value={v.value || ''} onChange={(e) => {
                    const copy = [...envEditValues]; copy[i].value = e.target.value; setEnvEditValues(copy);
                  }} placeholder="value" />
                  <label className="flex items-center space-x-1"><input type="checkbox" checked={v.enabled !== false} onChange={(e) => {
                    const copy = [...envEditValues]; copy[i].enabled = e.target.checked; setEnvEditValues(copy);
                  }} /> <span className="text-xs">enabled</span></label>
                  <button className="px-2 py-1 text-red-600" onClick={() => { const copy = [...envEditValues]; copy.splice(i,1); setEnvEditValues(copy); }}>Remove</button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <button className="px-3 py-1 rounded border" onClick={() => setEnvEditValues([...envEditValues, { key: '', value: '', enabled: true }])}>Add Variable</button>
              <div className="text-xs text-gray-500">Changes are saved to server environment JSON file.</div>
            </div>
          </div>
        </div>
  )}

      {/* Fixed bottom Console + bar (enhanced with toggles) */}
      <div className="fixed left-4 right-4 bottom-16 z-50">
        {showConsole && (
          <div className="bg-gray-900 text-white p-3 rounded shadow-lg" style={{ maxHeight: '56vh' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex-1 pr-4">
                <div className="text-sm font-mono break-words"><span className="font-semibold">{(lastRequest?.method || '').toUpperCase()}</span> <span className="ml-2">{lastRequest?.url || '-'}</span></div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="text-sm font-semibold" style={{ padding: '4px 8px', borderRadius: 6, background: (lastResponse?.response?.code >= 200 && lastResponse?.response?.code < 300) ? '#16a34a' : (lastResponse?.response?.code >= 400 ? '#f87171' : '#f59e0b') }}>{lastResponse?.response?.code || '-'}</div>
                <div className="text-sm text-gray-300">{lastResponse?.time ? `${lastResponse.time} ms` : '-'}</div>
                <div className="text-xs bg-gray-800 px-2 py-0.5 rounded">Network</div>
                <div className="space-x-2">
                  <button onClick={() => setShowReqHeaders(!showReqHeaders)} className={`px-2 py-1 text-xs rounded ${showReqHeaders ? 'bg-gray-700' : 'bg-gray-800'}`}>Request Headers</button>
                  <button onClick={() => setShowReqBody(!showReqBody)} className={`px-2 py-1 text-xs rounded ${showReqBody ? 'bg-gray-700' : 'bg-gray-800'}`}>Request Body</button>
                  <button onClick={() => setShowResHeaders(!showResHeaders)} className={`px-2 py-1 text-xs rounded ${showResHeaders ? 'bg-gray-700' : 'bg-gray-800'}`}>Response Headers</button>
                  <button onClick={() => setShowResBody(!showResBody)} className={`px-2 py-1 text-xs rounded ${showResBody ? 'bg-gray-700' : 'bg-gray-800'}`}>Response Body</button>
                  <button onClick={() => setShowConsole(false)} className="px-2 py-1 text-xs rounded bg-red-600 ml-2">Close</button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-300 mb-1">Request</div>
                <div className="bg-gray-800 p-2 rounded">
                  <pre className="text-xs font-mono text-gray-200 bg-gray-900 p-2 rounded max-h-80 overflow-auto whitespace-pre-wrap">{buildRawRequest(lastRequest)}</pre>
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-300 mb-1">Response</div>
                <div className="bg-gray-800 p-2 rounded">
                  <pre className="text-xs font-mono text-gray-200 bg-gray-900 p-2 rounded max-h-80 overflow-auto whitespace-pre-wrap">{buildRawResponse(lastResponse)}</pre>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white border-t p-2 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <button onClick={() => setShowConsole(!showConsole)} className={`px-3 py-1 rounded border flex items-center ${showConsole ? 'bg-gray-200' : ''}`}>
              <Key size={14} className="mr-2" /> Console
            </button>
            <div className="text-sm text-gray-500">Last status: {lastResponse?.response?.code || '-'}</div>
          </div>
          <div className="text-xs text-gray-400">Postman-like Console</div>
        </div>
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
