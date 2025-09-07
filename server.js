// server.js
const express = require('express');
const fetch = require('node-fetch'); // v2
const cheerio = require('cheerio');   // para scrapeo si es necesario
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('.'));

const PORT = process.env.PORT || 3000;

// ENV-configurable sources
const NEWSAPI_KEY = process.env.NEWSAPI_KEY || ''; // required for real news
const TRENES_API_URL = process.env.TRENES_API_URL || ''; // if you have a proxy for Trenes Argentinos
const SUBTE_SOURCE_URL = process.env.SUBTE_SOURCE_URL || ''; // ex: subte.ar status url or proxy
const GCBA_TRANSITO_API = process.env.GCBA_TRANSITO_API || ''; // GCBA endpoint

// in-memory state for change detection
let lastState = {
  trenes: null,
  subtes: null,
  transito: null,
  noticias: null
};

// generic: if remote JSON endpoint exists use it, else fallback to mock
async function getTrenes(){
  if(TRENES_API_URL){
    try{
      const r = await fetch(TRENES_API_URL);
      if(r.ok) return await r.json();
    }catch(e){}
  }
  // mock fallback
  return [
    { texto: "Ramal Sarmiento → Demora 10 min", alerta: true },
    { texto: "Ramal Mitre → Normal", alerta: false },
    { texto: "Ramal Roca → Interrumpido", alerta: true }
  ];
}

async function getSubtes(){
  if(SUBTE_SOURCE_URL){
    try{
      const r = await fetch(SUBTE_SOURCE_URL);
      const ct = r.headers.get('content-type') || '';
      if(ct.includes('application/json')){
        return await r.json();
      } else {
        // intentar parsear HTML con cheerio (ejemplo básico - depende del site)
        const text = await r.text();
        const $ = cheerio.load(text);
        const lines = [];
        // este scraping es ejemplo: adaptar según HTML real del sitio
        $('.line-status, .linea').each((i,el)=>{
          const name = $(el).find('.name').text().trim() || $(el).find('h3').text().trim();
          const status = $(el).find('.status').text().trim() || $(el).find('.estado').text().trim();
          if(name) lines.push({ texto:`${name} → ${status}`, alerta: /interrump|demor/i.test(status) });
        });
        if(lines.length) return lines;
      }
    }catch(e){}
  }
  // fallback mock
  return [
    { texto: "Línea B → Normal", alerta: false },
    { texto: "Línea C → Demora 5 min", alerta: true },
    { texto: "Premetro → Normal", alerta: false }
  ];
}

async function getTransito(){
  if(GCBA_TRANSITO_API){
    try{
      const r = await fetch(GCBA_TRANSITO_API);
      if(r.ok) return await r.json();
    }catch(e){}
  }
  return [
    { texto: "Av. 9 de Julio → Cortada", alerta: true },
    { texto: "Autopista Illia → Fluido", alerta: false }
  ];
}

async function getNoticias(){
  if(NEWSAPI_KEY){
    try{
      const url = `https://newsapi.org/v2/top-headlines?country=ar&pageSize=8&apiKey=${NEWSAPI_KEY}`;
      const r = await fetch(url);
      if(r.ok){
        const j = await r.json();
        if(j.articles && j.articles.length){
          return j.articles.map(a=>({
            texto: `[URGENTE] ${a.title}`,
            alerta: /urgente|rompe|explota|muert|herid/i.test(a.title + ' ' + (a.description||'')) ? true : true // treat as urgent
          }));
        }
      }
    }catch(e){
      console.error('newsapi error', e.message);
    }
  }
  return [
    { texto: "[URGENTE] Demo: noticia de prueba", alerta: true }
  ];
}

// API endpoints
app.get('/api/trenes', async (req,res) => {
  const data = await getTrenes();
  res.json(normalizeArray(data));
});
app.get('/api/subtes', async (req,res) => {
  const data = await getSubtes();
  res.json(normalizeArray(data));
});
app.get('/api/transito', async (req,res) => {
  const data = await getTransito();
  res.json(normalizeArray(data));
});
app.get('/api/noticias', async (req,res) => {
  const data = await getNoticias();
  res.json(normalizeArray(data));
});

// simple normalization: if object, convert to array with text
function normalizeArray(d){
  if(!d) return [];
  if(Array.isArray(d)) return d.map(item => {
    if(typeof item === 'string') return { texto: item, alerta: false };
    return { texto: item.texto || item.title || JSON.stringify(item), alerta: !!item.alerta };
  });
  // if single object
  return [{ texto: JSON.stringify(d), alerta:false }];
}

// SSE for realtime pushes
const clients = [];
app.get('/events', (req,res) => {
  res.set({
    'Content-Type':'text/event-stream',
    'Cache-Control':'no-cache',
    'Connection':'keep-alive'
  });
  res.flushHeaders();
  const id = Date.now();
  clients.push(res);

  // send initial ping
  res.write(`data: ${JSON.stringify({type:'connected', ts:Date.now()})}\n\n`);

  req.on('close', () => {
    const idx = clients.indexOf(res);
    if(idx !== -1) clients.splice(idx,1);
  });
});

// function to broadcast updates
function broadcast(obj){
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  clients.forEach(c => {
    try{ c.write(payload); }catch(e){}
  });
}

// polling loop: check every 20s for changes and broadcast 'update' if changed
async function pollLoop(){
  try{
    const [trenes, subtes, transito, noticias] = await Promise.all([getTrenes(), getSubtes(), getTransito(), getNoticias()]);
    const newState = { trenes, subtes, transito, noticias, ts: Date.now() };
    const newHash = JSON.stringify(newState);
    const oldHash = JSON.stringify(lastState);
    if(oldHash !== newHash){
      lastState = newState;
      // broadcast update event
      broadcast({ type:'update', payload: { ts: Date.now() } });
    }
  }catch(e){
    console.error('poll error', e.message);
  }finally{
    setTimeout(pollLoop, 20000); // 20s
  }
}

// start server and poll
app.listen(PORT, ()=> {
  console.log(`Server listening on ${PORT}`);
  pollLoop();
});
