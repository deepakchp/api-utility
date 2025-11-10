
import express from "express";
import cors from "cors";
import newman from "newman";
import fs from "fs";
import path from "path";
import XLSX from "xlsx";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/run", async (req, res) => {
  const { method, url, headers, body, collectionName, endpointName } = req.body;

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

    tmpCollection = {
      info: collection.info || { name: `${collectionName} - single`, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [found],
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
    // keep url as raw string; also include query array if params provided
    const urlRaw = reqObj.url || '';
    const query = (reqObj.params || []).filter(p => p.key).map(p => ({ key: p.key, value: p.value }));
    const urlObj = { raw: urlRaw };
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
const EXCEL_PATH = path.join(process.cwd(), "api_master.xlsx");
const COLLECTIONS_DIR = path.join(process.cwd(), "collections");

// Helper to read API names from Excel (first sheet)
function readApiNamesFromExcel() {
  if (!fs.existsSync(EXCEL_PATH)) return [];
  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  // Try common column names
  const candidates = ["APIName", "ApiName", "apiName", "name", "Name"];
  return data.map(row => {
    for (const c of candidates) if (row[c]) return String(row[c]);
    // fallback to first column value
    const keys = Object.keys(row);
    return keys.length ? String(row[keys[0]]) : null;
  }).filter(Boolean);
}

// GET /apis and GET /api - return list of API names from Excel
app.get(["/apis", "/api"], (req, res) => {
  try {
    const names = readApiNamesFromExcel();
    res.json(names);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
