const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const rooms = new Map();
let nextId = 1;

function send(ws, obj){ if(ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj){ for(const p of room.players.values()) send(p.ws,obj); }
function cleanName(v){ return String(v||'Operador').replace(/[^\wÀ-ÿ _-]/g,'').trim().slice(0,16) || 'Operador'; }
function cleanRoom(v){ return String(v||'PUBLIC').replace(/[^A-Za-z0-9_-]/g,'').slice(0,12).toUpperCase() || 'PUBLIC'; }
function finite(n,d=0){ return Number.isFinite(Number(n)) ? Number(n) : d; }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }

const server = http.createServer((req,res)=>{
  let u;
  try{ u = new URL(req.url, `http://${req.headers.host||'localhost'}`); }catch{ res.writeHead(400); return res.end('Bad request'); }
  if(u.pathname === '/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size}));}
  let file = u.pathname === '/' ? '/index.html' : u.pathname;
  file = path.normalize(file).replace(/^([.][.][\\/])+/, '');
  const full = path.join(ROOT,file);
  if(!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()){res.writeHead(404);return res.end('Not found');}
  const ext=path.extname(full);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
  res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(full).pipe(res);
});

const wss = new WebSocketServer({server});
function snapshot(room){return [...room.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,z:p.z,yaw:p.yaw,hp:p.hp,variant:p.variant}));}
function removePlayer(ws){
  const p=ws.player;if(!p)return;const room=rooms.get(p.room);if(room){room.players.delete(p.id);broadcast(room,{type:'snapshot',players:snapshot(room)});if(room.players.size===0)rooms.delete(p.room);}ws.player=null;
}
function raySphere(origin,dir,center,radius){
  const ox=origin.x-center.x, oy=origin.y-1.0, oz=origin.z-center.z;
  const b=2*(ox*dir.x+oy*dir.y+oz*dir.z), c=ox*ox+oy*oy+oz*oz-radius*radius, disc=b*b-4*c;
  if(disc<0)return Infinity;const t=(-b-Math.sqrt(disc))/2;return t>=0?t:Infinity;
}

wss.on('connection',ws=>{
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw.toString())}catch{return;}
    if(m.type==='join'){
      if(ws.player) return;
      const roomId=cleanRoom(m.room);let room=rooms.get(roomId);
      if(!room){room={players:new Map()};rooms.set(roomId,room)}
      if(room.players.size>=8){send(ws,{type:'error',message:'Sala cheia (máximo 8 jogadores).'});return;}
      const id='p'+(nextId++);const p={ws,id,room:roomId,name:cleanName(m.name),x:0,z:8,yaw:0,pitch:0,hp:100,lastShot:0,variant:clamp(Math.floor(finite(m.variant,0)),0,4)};
      room.players.set(id,p);ws.player=p;
      send(ws,{type:'welcome',id,room:roomId,count:room.players.size});broadcast(room,{type:'snapshot',players:snapshot(room)});return;
    }
    const p=ws.player;if(!p)return;const room=rooms.get(p.room);if(!room)return;
    if(m.type==='state'){
      p.x=clamp(finite(m.x,p.x),-112,112);p.z=clamp(finite(m.z,p.z),-112,112);p.yaw=finite(m.yaw,p.yaw);p.pitch=clamp(finite(m.pitch,p.pitch),-1.5,1.5);return;
    }
    if(m.type==='shoot'){
      const now=Date.now();if(now-p.lastShot<70)return;p.lastShot=now;
      const o=m.origin||{},d=m.dir||{};let dx=finite(d.x),dy=finite(d.y),dz=finite(d.z);const len=Math.hypot(dx,dy,dz)||1;dx/=len;dy/=len;dz/=len;
      // Prevent clients from shooting from arbitrary distant coordinates.
      const ox=finite(o.x,p.x),oy=finite(o.y,1.65),oz=finite(o.z,p.z);if(Math.hypot(ox-p.x,oz-p.z)>3)return;
      let best=null,bestT=Infinity;
      for(const q of room.players.values()){
        if(q.id===p.id||q.hp<=0)continue;const t=raySphere({x:ox,y:oy,z:oz},{x:dx,y:dy,z:dz},{x:q.x,y:0,z:q.z},.65);if(t<bestT&&t<140){best=q;bestT=t;}
      }
      if(best){best.hp=Math.max(0,best.hp-34);broadcast(room,{type:'hit',targetId:best.id,hp:best.hp,killerId:p.id,damage:34});if(best.hp<=0){broadcast(room,{type:'kill',killerId:p.id,targetId:best.id});setTimeout(()=>{if(best.hp<=0&&room.players.has(best.id)){best.hp=100;best.x=clamp((Math.random()-.5)*180,-100,100);best.z=clamp((Math.random()-.5)*180,-100,100);broadcast(room,{type:'snapshot',players:snapshot(room)});}},1800)}}
    }
  });
  ws.on('close',()=>removePlayer(ws));ws.on('error',()=>removePlayer(ws));
});
setInterval(()=>{for(const room of rooms.values())broadcast(room,{type:'snapshot',players:snapshot(room)})},50);
server.listen(PORT,()=>console.log(`BattleZone 3D Online: http://localhost:${PORT}`));
