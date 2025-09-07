// Frontend: polling + SSE client
const endpoints = {
  trenes: '/api/trenes',
  subtes: '/api/subtes',
  transito: '/api/transito',
  noticias: '/api/noticias'
};

const audio = document.getElementById('alert-sound');
let alertsPaused = false;
let lastStateHash = null;

// render helpers
function renderList(elId, arr){
  const el = document.getElementById(elId);
  if(!arr || !arr.length){ el.innerHTML = '<div class="item">Sin datos.</div>'; return; }
  el.innerHTML = arr.map(i => `<div class="item ${i.alerta ? 'alerta' : ''}">${i.texto}</div>`).join('');
}

function buildGuion(trenes, subtes, transito, noticias){
  const parts = [];
  const trenesAlert = trenes.filter(t=>t.alerta).slice(0,4).map(t=>t.texto);
  const subtesAlert = subtes.filter(s=>s.alerta).slice(0,4).map(s=>s.texto);
  const transitoAlert = transito.filter(t=>t.alerta).slice(0,3).map(t=>t.texto);
  const noticiasAlert = noticias.slice(0,3).map(n=>n.texto);

  if(trenesAlert.length) parts.push(`Trenes: ${trenesAlert.join(' — ')}.`);
  if(subtesAlert.length) parts.push(`Subte: ${subtesAlert.join(' — ')}.`);
  if(transitoAlert.length) parts.push(`Tránsito: ${transitoAlert.join(' — ')}.`);
  if(noticiasAlert.length) parts.push(`Último momento: ${noticiasAlert.join(' — ')}.`);

  const txt = parts.length ? parts.join(' ') : 'Tránsito y transporte sin novedades relevantes por el momento.';
  document.getElementById('guion-text').innerText = txt;
}

// fetch wrapper
async function fetchJSON(url, fallback=[]){
  try{
    const r = await fetch(url, {cache:'no-cache'});
    if(!r.ok) throw new Error('network');
    return await r.json();
  }catch(e){
    return fallback;
  }
}

// main update
async function actualizarAll(publishChange=true){
  const [trenes, subtes, transito, noticias] = await Promise.all([
    fetchJSON(endpoints.trenes, []),
    fetchJSON(endpoints.subtes, []),
    fetchJSON(endpoints.transito, []),
    fetchJSON(endpoints.noticias, [])
  ]);

  renderList('trenes-data', trenes);
  renderList('subtes-data', subtes);
  renderList('transito-data', transito);
  renderList('noticias-data', noticias);

  buildGuion(trenes, subtes, transito, noticias);

  const now = new Date();
  document.getElementById('last-update').innerText = `Última actualización: ${now.toLocaleTimeString()}`;

  // compute simple hash to detect changes (JSON string)
  const hash = JSON.stringify({trenes,subtes,transito,noticias});
  if(hash !== lastStateHash){
    // play alert if any new alerta and not paused
    const anyAlert = [...trenes, ...subtes, ...transito, ...noticias].some(i=>i.alerta);
    if(anyAlert && !alertsPaused) {
      try{ audio.currentTime = 0; audio.play(); }catch(e){}
    }
    lastStateHash = hash;
  }
}

// SSE listener (server pushes changes)
function startSSE(){
  if(typeof EventSource === 'undefined') return;
  try{
    const es = new EventSource('/events');
    es.onmessage = (ev) => {
      try{
        const d = JSON.parse(ev.data);
        // server can send {type:'update'} or {type:'alert', payload:...}
        if(d.type === 'update'){
          actualizarAll(false);
        } else if(d.type === 'alert'){
          if(!alertsPaused) try{ audio.play(); }catch(e){}
          actualizarAll(false);
        }
      }catch(err){}
    };
    es.onerror = ()=>{ /* fail silently, client still polls */ };
  }catch(e){}
}

// controls
document.getElementById('copy-guion').addEventListener('click', async ()=>{
  const text = document.getElementById('guion-text').innerText;
  try{ await navigator.clipboard.writeText(text); alert('Guion copiado'); }catch(e){ alert('No se pudo copiar'); }
});
document.getElementById('pause-alerts').addEventListener('click', (e)=>{
  alertsPaused = !alertsPaused;
  e.target.innerText = alertsPaused ? 'Reanudar alertas' : 'Pausar alertas';
});

// boot
actualizarAll();
startSSE();
// polling as backup
setInterval(actual
