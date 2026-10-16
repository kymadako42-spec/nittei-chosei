// 日程調整 - Render + Supabase 版(依存パッケージなし / Node.js 18+)
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const PORT=process.env.PORT||3000;
const SB=(process.env.SUPABASE_URL||"").replace(/\/$/,""),KEY=process.env.SUPABASE_SERVICE_KEY||"";
if(!SB||!KEY){console.error("環境変数 SUPABASE_URL と SUPABASE_SERVICE_KEY を設定してください");process.exit(1)}
const hdr={apikey:KEY,"Content-Type":"application/json"};
if(KEY.startsWith("eyJ"))hdr.Authorization="Bearer "+KEY; // 旧形式(service_role)のキー
async function sb(method,q,body,prefer){
  const r=await fetch(SB+"/rest/v1/"+q,{method,headers:{...hdr,...(prefer?{Prefer:prefer}:{})},body:body?JSON.stringify(body):undefined});
  const t=await r.text();if(!r.ok)throw new Error(r.status+" "+t);return t?JSON.parse(t):null;
}
const eq=v=>"eq."+encodeURIComponent(v);
const getEvent=async id=>(await sb("GET","events?id="+eq(id)+"&select=id,title,slots,admin_key"))[0];
const rid=n=>crypto.randomBytes(n).toString("base64url");
const send=(res,c,o)=>{res.writeHead(c,{"Content-Type":"application/json"});res.end(JSON.stringify(o))};
const body=req=>new Promise(r=>{let b="";req.on("data",c=>{b+=c;if(b.length>1e6)req.destroy()});req.on("end",()=>{try{r(JSON.parse(b||"{}"))}catch{r({})}})});
const clean=(s,n=100)=>String(s||"").slice(0,n);
const slotsOf=a=>Array.isArray(a)?a.slice(0,300).filter(s=>s&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(~\d\d:\d\d)?$/.test(s.label)).map(s=>({id:String(s.id).replace(/[^\w-]/g,"").slice(0,30),label:s.label})):[];
const html=fs.readFileSync(path.join(__dirname,"index.html"));
http.createServer(async(req,res)=>{
  const p=new URL(req.url,"http://x").pathname;let m;
  try{
    if(p==="/healthz")return send(res,200,{ok:true});
    if(p==="/api/events"&&req.method==="POST"){
      const b=await body(req),slots=slotsOf(b.slots);
      if(!clean(b.title).trim()||!slots.length)return send(res,400,{});
      const id=rid(6),adminKey=rid(16);
      await sb("POST","events",{id,title:clean(b.title),slots,admin_key:adminKey},"return=minimal");
      return send(res,200,{id,adminKey});
    }
    if(m=p.match(/^\/api\/events\/([\w-]+)(\/votes)?$/)){
      const id=m[1],e=await getEvent(id);if(!e)return send(res,404,{});
      if(!m[2]&&req.method==="GET"){
        const rows=await sb("GET","votes?event_id="+eq(id)+"&select=id,name,answers,updated_at&order=updated_at.asc");
        return send(res,200,{title:e.title,slots:e.slots,votes:rows.map(v=>({id:v.id,name:v.name,answers:v.answers,updatedAt:Date.parse(v.updated_at)}))});
      }
      if(!m[2]&&req.method==="PUT"){
        const b=await body(req),slots=slotsOf(b.slots);
        if(b.adminKey!==e.admin_key)return send(res,403,{});
        if(!slots.length)return send(res,400,{});
        await sb("PATCH","events?id="+eq(id),{title:clean(b.title)||e.title,slots},"return=minimal");
        return send(res,200,{});
      }
      if(m[2]&&req.method==="POST"){
        const b=await body(req),vid=clean(b.id,50).replace(/[^\w-]/g,""),name=clean(b.name,30).trim();
        if(!vid||!name)return send(res,400,{});
        const ex=await sb("GET","votes?event_id="+eq(id)+"&select=id&limit=300");
        if(ex.length>=200&&!ex.some(v=>v.id===vid))return send(res,400,{});
        const ok=new Set(e.slots.map(s=>s.id)),a={};
        for(const[k,v]of Object.entries(b.answers||{}))if(ok.has(k)&&(v==="o"||v==="t"))a[k]=v;
        await sb("POST","votes?on_conflict=event_id,id",{event_id:id,id:vid,name,answers:a,updated_at:new Date().toISOString()},"resolution=merge-duplicates,return=minimal");
        return send(res,200,{});
      }
    }
    if(req.method==="GET"&&(p==="/"||p.startsWith("/e/"))){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});return res.end(html)}
    res.writeHead(404);res.end();
  }catch(err){console.error(err.message);send(res,500,{})}
}).listen(PORT,()=>console.log("http://localhost:"+PORT));
