
import express from "express";
import cors from "cors";
import newman from "newman";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/run", async (req, res) => {
  const { method, url, headers, body, collectionName, endpointName } = req.body;
  const environment = req.body && req.body.environment ? req.body.environment : null;

  // helper to substitute {{var}} occurrences using environment values array [{key, value}]
  const substituteVars = (text, envVals) => {
    if (text === undefined || text === null) return text;
    if (!envVals || !Array.isArray(envVals)) return text;
    let out = String(text);
    for (const v of envVals) {
      if (!v || !v.key) continue;
      const key = v.key;
      const val = v.value == null ? '' : String(v.value);
      out = out.split(`{{${key}}}`).join(val);
    }
    return out;
  };

  // resolve environment values: prefer environment.values passed in request, otherwise try to read by name
  let envValues = [];
  if (environment) {
    if (Array.isArray(environment.values)) envValues = environment.values;
    else if (environment.name) {
      const loaded = readEnvironment(environment.name);
      envValues = Array.isArray(loaded?.values) ? loaded.values : [];
    }
  }

  const applySubstitutionToRequest = (reqObj) => {
    if (!reqObj) return reqObj;
    // url may be string or object with raw
    try {
      // Handle string URL values by substituting and attempting to parse into a Postman-style URL object
      if (typeof reqObj.url === 'string') {
        const substituted = substituteVars(reqObj.url, envValues);
        // If substituted looks like a full URL, parse into components so Newman can execute
        try {
          const parsed = new URL(substituted);
          reqObj.url = {
            raw: substituted,
            protocol: parsed.protocol.replace(':', ''),
            host: parsed.hostname ? parsed.hostname.split('.') : [],
            path: parsed.pathname ? parsed.pathname.split('/').filter(Boolean) : [],
            port: parsed.port || undefined,
          };
        } catch (e) {
          // not a fully qualified URL - keep as raw string
          reqObj.url = substituted;
        }
      } else if (reqObj.url && typeof reqObj.url === 'object') {
        if (reqObj.url.raw) {
          reqObj.url.raw = substituteVars(reqObj.url.raw, envValues);
          // if raw now contains a full URL, populate protocol/host/path if missing
          try {
            if (typeof reqObj.url.raw === 'string' && /^https?:\/\//i.test(reqObj.url.raw)) {
              const parsed = new URL(reqObj.url.raw);
              if (!reqObj.url.protocol) reqObj.url.protocol = parsed.protocol.replace(':', '');
              if (!reqObj.url.host) reqObj.url.host = parsed.hostname ? parsed.hostname.split('.') : [];
              if (!reqObj.url.path) reqObj.url.path = parsed.pathname ? parsed.pathname.split('/').filter(Boolean) : [];
              if (!reqObj.url.port && parsed.port) reqObj.url.port = parsed.port;
            }
          } catch (e) {
            // ignore parse errors
          }
        }
        // also try query params
        if (Array.isArray(reqObj.url.query)) {
          for (const q of reqObj.url.query) {
            if (q && q.value !== undefined) q.value = substituteVars(q.value, envValues);
          }
        }
      }

      // headers
      const hdrs = reqObj.header || reqObj.headers || [];
      if (Array.isArray(hdrs)) {
        for (const h of hdrs) {
          if (h && h.value !== undefined) h.value = substituteVars(h.value, envValues);
        }
      }

      // body (Postman raw)
      if (reqObj.body && reqObj.body.raw) {
        reqObj.body.raw = substituteVars(reqObj.body.raw, envValues);
      }
    } catch (e) {
      // ignore substitution errors
    }
    return reqObj;
  };

  // If collectionName + endpointName provided, load collection and run only that item
  let tmpCollection;
  if (collectionName && endpointName) {
    const safeName = path.basename(collectionName);
    const filePath = path.join(COLLECTIONS_DIR, `${safeName}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Collection not found' });
    const collection = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // find the first item matching endpointName (recursive)
    const findItem = (items, name) => {
      if (!items) return null;
      for (const it of items) {
        if (it.name === name && it.request) return it;
        if (it.item) {
          const found = findItem(it.item, name);
          if (found) return found;
        }
      }
      return null;
    };

    const found = findItem(collection.item || [], endpointName);
    if (!found) return res.status(404).json({ error: 'Endpoint not found in collection' });

    // clone the found item to avoid mutating on-disk collection
    const cloned = JSON.parse(JSON.stringify(found));
    // apply environment substitutions to the request inside the found item
    applySubstitutionToRequest(cloned.request);

    tmpCollection = {
      info: collection.info || { name: `${collectionName} - single`, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [cloned],
    };
  } else {
    // fallback to dynamic single-request collection built from posted method/url/body
      tmpCollection = {
          info: { name: 'Dynamic Run', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
          item: [
              {
                  name: 'Temp Request',
                  request: {
                      method,
                      header: headers?.map(h => ({ key: h.key, value: h.value, type: 'text' })) || [],
                      url,
                      body: body ? { mode: 'raw', raw: body, options: { raw: { language: 'json' } } } : undefined,
                  },
              },
          ],
      };
  }
      // apply substitution for dynamic run as well (if environment provided)
      if (envValues && envValues.length) {
          applySubstitutionToRequest(tmpCollection.item[0].request);
      }

  const tmpPath = path.join(process.cwd(), `temp_request_${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(tmpCollection, null, 2));

  newman.run({ collection: tmpPath, reporters: 'json' }, (err, summary) => {
    // remove temp file
    try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
    if (err) return res.status(500).json({ error: err.message });
    const exec = summary.run.executions[0];
    res.json({
      request: {
        method: exec.request.method,
        url: exec.request.url.toString(),
        headers: exec.request.headers.members,
        body: exec.request.body?.toString(),
      },
      response: {
        code: exec.response?.code,
        status: exec.response?.status,
        headers: exec.response?.headers?.members,
        body: exec.response?.stream?.toString(),
      },
    });
  });
});

// Save or update an item inside a stored collection
app.post('/save', (req, res) => {
  const { collectionName, endpointName, request } = req.body || {};
  if (!collectionName) return res.status(400).json({ error: 'collectionName required' });

  const safeName = path.basename(collectionName);
  const filePath = path.join(COLLECTIONS_DIR, `${safeName}.json`);

  let collection = null;
  if (fs.existsSync(filePath)) {
    try { collection = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return res.status(500).json({ error: 'Failed to read collection' }); }
  } else {
    // create a minimal collection
    collection = { info: { name: safeName, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] };
  }

  // Build a Postman-style request object from the provided request
  const buildRequest = (reqObj) => {
    const reqHeaders = (reqObj.headers || []).map(h => ({ key: h.key || h.name, value: h.value }));
    const body = reqObj.body ? { mode: 'raw', raw: reqObj.body } : undefined;

    // Build a Postman-style URL object. If frontend provided an object, use it.
    let urlObj = null;
    if (!reqObj.url) {
      urlObj = { raw: '' };
    } else if (typeof reqObj.url === 'object') {
      // clone basic object
      urlObj = { ...reqObj.url };
      if (reqObj.url.raw === undefined) urlObj.raw = (reqObj.url.protocol ? (reqObj.url.protocol + '://') : '') + ((Array.isArray(reqObj.url.host) ? reqObj.url.host.join('.') : reqObj.url.host) || '') + (Array.isArray(reqObj.url.path) ? ('/' + reqObj.url.path.join('/')) : (reqObj.url.path || ''));
    } else {
      // try to parse string URL into components
      const urlRaw = String(reqObj.url);
      try {
        const parsed = new URL(urlRaw);
        urlObj = {
          raw: urlRaw,
          protocol: parsed.protocol.replace(':', ''),
          host: parsed.hostname ? parsed.hostname.split('.') : [],
          path: parsed.pathname ? parsed.pathname.split('/').filter(Boolean) : [],
        };
      } catch (e) {
        // not a full URL, just save raw
        urlObj = { raw: urlRaw };
      }
    }

    // include query params if provided
    const query = (reqObj.params || []).filter(p => p.key).map(p => ({ key: p.key, value: p.value }));
    if (query.length) urlObj.query = query;

    return { method: reqObj.method || 'GET', header: reqHeaders, body, url: urlObj };
  };

  const newReq = buildRequest(request || {});

  // recursive search for item by name
  const findItemAndParent = (items, name, parent = null) => {
    if (!items) return null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if ((it.name || '') === name && it.request) return { item: it, parent: items, index: i };
      if (it.item) {
        const found = findItemAndParent(it.item, name, it);
        if (found) return found;
      }
    }
    return null;
  };

  const nameToUse = endpointName || (`Saved Request ${Date.now()}`);
  const found = findItemAndParent(collection.item || [], nameToUse);

  if (found) {
    // update existing
    found.item.request = newReq;
  } else {
    // append at root
    collection.item = collection.item || [];
    collection.item.push({ name: nameToUse, request: newReq });
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(collection, null, 2), 'utf8');
    res.json({ ok: true, collection: safeName, savedName: nameToUse });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write collection' });
  }
});

// Excel and collections config

// Collections directory: prefer environment variable COLLECTIONS_DIR if provided
// otherwise default to ./data/collections inside the project root
const COLLECTIONS_DIR = process.env.COLLECTIONS_DIR
  ? path.resolve(process.env.COLLECTIONS_DIR)
  : path.join(process.cwd(), "data", "collections");

// Environments directory (Postman environment files). Prefer ENV_DIR env var
// otherwise default to ./data/environments inside the project root
const ENV_DIR = process.env.ENV_DIR ? path.resolve(process.env.ENV_DIR) : path.join(process.cwd(), "data", "environments");
// Ensure collections directory exists (create if missing)
try {
  if (!fs.existsSync(COLLECTIONS_DIR)) {
    fs.mkdirSync(COLLECTIONS_DIR, { recursive: true });
    console.log(`Created collections directory at ${COLLECTIONS_DIR}`);
  }
  // ensure env dir exists too (do not fail if it can't be created)
  try {
    if (!fs.existsSync(ENV_DIR)) {
      fs.mkdirSync(ENV_DIR, { recursive: true });
      console.log(`Created environments directory at ${ENV_DIR}`);
    }
  } catch (e) {
    console.warn(`Could not create environments dir ${ENV_DIR}:`, e.message || e);
  }
} catch (err) {
  console.error(`Failed to ensure collections directory ${COLLECTIONS_DIR}:`, err);
}

// Helper to read API names from Excel (first sheet)
// Helper to list API names from files in COLLECTIONS_DIR
function listApiNamesFromDir() {
  try {
    if (!fs.existsSync(COLLECTIONS_DIR)) return [];
    const entries = fs.readdirSync(COLLECTIONS_DIR, { withFileTypes: true });
    // Consider regular files only, ignore directories and hidden files
    const names = entries
      .filter(e => e.isFile())
      .map(e => e.name)
      .filter(n => !n.startsWith('.'))
      .map(n => path.parse(n).name);
    // remove duplicates and sort
    return Array.from(new Set(names)).sort();
  } catch (err) {
    console.error('Failed to list collections dir:', err);
    return [];
  }
}

// GET /apis and GET /api - return list of API names derived from files in COLLECTIONS_DIR
app.get(["/apis", "/api"], (req, res) => {
  try {
    const names = listApiNamesFromDir();
    res.json(names);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper to list Postman-like environment files from ENV_DIR
function listEnvironmentsFromDir() {
  try {
    // Only gather environment files from ENV_DIR (do not inspect COLLECTIONS_DIR)
    if (!fs.existsSync(ENV_DIR)) return [];
    const entries = fs.readdirSync(ENV_DIR, { withFileTypes: true });
    const names = entries
      .filter(e => e.isFile())
      .map(e => e.name)
      .filter(n => !n.startsWith('.'))
      .filter(n => {
        const ln = n.toLowerCase();
        return ln.endsWith('.json') || ln.endsWith('.postman_environment') || ln.endsWith('.postman_environment.json');
      })
      .map(n => path.parse(n).name);
    return Array.from(new Set(names)).sort();
  } catch (err) {
    console.error('Failed to list environments dir:', err);
    return [];
  }
}

// Parse environment file and return variables array
function readEnvironment(name) {
  try {
    const safe = path.basename(name);
    // try common filename extensions in ENV_DIR only
    const candidates = [
      path.join(ENV_DIR, `${safe}.json`),
      path.join(ENV_DIR, `${safe}.postman_environment`),
      path.join(ENV_DIR, `${safe}.postman_environment.json`),
    ];
    let filePath = candidates.find(p => fs.existsSync(p));
    if (!filePath) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(raw);
    // Postman environment formats vary: look for 'values' or 'variables' or 'environment.values'
    let vars = [];
    if (Array.isArray(obj.values)) vars = obj.values;
    else if (Array.isArray(obj.variables)) vars = obj.variables;
    else if (obj.environment && Array.isArray(obj.environment.values)) vars = obj.environment.values;
    // normalize to { key, value, enabled }
    const out = vars.map(v => ({ key: v.key || v.name || v.variable || v.var || '', value: v.value || v.current || v.default || '', enabled: v.enabled === undefined ? true : !!v.enabled }));
    return { name: obj.name || safe, values: out };
  } catch (err) {
    console.error('Failed to read environment', name, err.message || err);
    return null;
  }
}

// GET /environments - list available environment names
app.get('/environments', (req, res) => {
  try {
    const list = listEnvironmentsFromDir();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /environment/:name - return parsed environment variables
app.get('/environment/:name', (req, res) => {
  const name = req.params.name;
  if (!name) return res.status(400).json({ error: 'name required' });
  const env = readEnvironment(name);
  if (!env) return res.status(404).json({ error: 'Environment not found or failed to parse' });
  res.json(env);
});

// POST /environment/:name - save environment variables to ENV_DIR
app.post('/environment/:name', (req, res) => {
  const name = req.params.name;
  if (!name) return res.status(400).json({ error: 'name required' });
  const body = req.body || {};
  const values = Array.isArray(body.values) ? body.values : [];
  // normalize values to objects with key, value, enabled
  const normalized = values.map(v => ({ key: v.key || v.name || '', value: v.value || '', enabled: v.enabled === undefined ? true : !!v.enabled }));
  const out = {
    id: `${name}-env`,
    name: name,
    values: normalized,
    _postman_variable_scope: 'environment',
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: 'newman-api-runner-pro'
  };
  try {
    if (!fs.existsSync(ENV_DIR)) fs.mkdirSync(ENV_DIR, { recursive: true });
    const filePath = path.join(ENV_DIR, `${path.basename(name)}.json`);
    fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
    res.json({ ok: true, name, file: filePath });
  } catch (err) {
    console.error('Failed to write environment', name, err);
    res.status(500).json({ error: 'Failed to write environment' });
  }
});

// GET /collection/:apiName and GET /collection?apiName=... - return collection JSON
app.get(["/collection/:apiName", "/collection"], (req, res) => {
  try {
    const apiName = req.params.apiName || req.query.apiName;
    if (!apiName) return res.status(400).json({ error: "apiName required" });
  // prevent directory traversal by using basename
  const safeName = path.basename(apiName);
  const filePath = path.join(COLLECTIONS_DIR, `${safeName}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Collection not found" });
    const collection = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json(collection);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => console.log("✅ Newman server running on http://localhost:5000"));
