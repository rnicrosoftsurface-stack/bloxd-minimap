// ==UserScript==
// @name         Bloxd XYZ Internet-Test (nur sichtbare Koordinaten)
// @namespace    bloxd-readonly-xyz
// @version      1.0.0
// @description  Liest die sichtbare XYZ-Anzeige und sendet sie an die eigene Test-Webseite
// @match        https://bloxd.io/*
// @match        https://bloxd.dev/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
  "use strict";

  // GitHub Pages zeigt nur an. Der Internet-Transport nutzt einen
  // oeffentlichen MQTT-Testbroker. Der Kanal ist nicht privat authentifiziert.
  const KEY = "c50fde7aff8f4331a9b39ccafa1a24fc5c362757933a868d";
  const TOPIC = "bloxd/coords/" + KEY;
  const PAGE = "https://rnicrosoftsurface-stack.github.io/bloxd-minimap/xyz-test.html#" + KEY;
  const BROKER = "wss://broker.emqx.io:8084/mqtt";
  const NAME = "bloxd-xyz-test-panel";
  const encoder = new TextEncoder();
  let ws = null, mqttReady = false, mqttLabel = "Verbinde...";
  let retryTimer = 0, messageCount = 0, lastPublish = 0;
  let last = {x:null,y:null,z:null};
  let error = "Warte auf Koordinaten";
  let seen = {x:0,y:0,z:0};
  let jump = {x:null,y:null,z:null};
  let ocrOK = 0, ocrReads = 0, txOK = 0;
  let panel = null, info = null, state = null, body = null, toggle = null;
  const encStr = value => {
    const b=encoder.encode(value);
    return Uint8Array.from([b.length>>>8,b.length&255,...b]);
  };
  function frame(header,...items){
    const data=Uint8Array.from(items.flatMap(v=>Array.from(v)));
    let length=data.length;const prefix=[];
    do{
      let b=length%128;length=Math.floor(length/128);
      if(length)b|=128;
      prefix.push(b);
    }while(length);
    return Uint8Array.from([header,...prefix,...data]);
  }
  function emit(header,...data){
    if(ws?.readyState!==1)return false;
    ws.send(frame(header,...data));
    return true;
  }
  function brokerConnect(){
    clearTimeout(retryTimer);
    mqttReady=false;
    mqttLabel="Verbinde...";
    let socket;
    try {
      socket=new WebSocket(BROKER,"mqtt");
      socket.binaryType="arraybuffer";
    }catch(ex){
      mqttLabel="WebSocket nicht erlaubt";
      retryTimer=setTimeout(brokerConnect,5000);
      return;
    }
    ws=socket;
    socket.onopen=()=>{
      const id="bloxd-xyz-"+Math.random().toString(16).slice(2,12);
      emit(0x10,encStr("MQTT"),[4,2,0,45],encStr(id));
    };
    socket.onmessage=ev=>{
      const b=new Uint8Array(ev.data);
      if(b.length<4)return;
      if((b[0]>>4)===2){
        if(b[3]===0){mqttReady=true;mqttLabel="INTERNET VERBUNDEN";}
        else mqttLabel="Broker-Antwort "+b[3];
      }
    };
    socket.onerror=()=>{mqttLabel="Verbindungsfehler";};
    socket.onclose=()=>{
      if(ws!==socket)return;
      mqttReady=false;mqttLabel="Internet getrennt";
      retryTimer=setTimeout(brokerConnect,3000);
    };
  }
  function sendPayload(payload,retained){
    if(!mqttReady)return false;
    try{
      emit(retained?0x31:0x30,encStr(TOPIC),encoder.encode(JSON.stringify(payload)));
      txOK++;
      return true;
    }catch(e){mqttLabel="Senden fehlgeschlagen";return false;}
  }
  function testSignal(){
    const ok=sendPayload({type:"test",t:Date.now()},false);
    if(!ok)error="TEST nicht gesendet: Broker nicht verbunden";
    updatePanel();
  }

  const T = {
    "1": [[6,[63,511,511,31,31,31,31,31,31,31,31,31]],[4,[31,511,31,31,31,31,31,31,31,31,31,31]],[5,[28,508,28,28,12,12,12,12,12,12,12,12]]],
    "0": [[8,[126,255,455,455,387,387,387,387,455,455,510,252]],[9,[124,254,462,454,455,391,391,455,454,462,254,124]],[9,[124,254,231,455,455,455,455,455,455,231,254,124]],[9,[60,126,198,195,387,387,387,387,195,198,254,60]],[9,[60,126,198,199,387,387,387,387,455,198,254,124]],[7,[62,238,455,455,455,455,455,455,455,455,254,56]],[7,[62,239,455,455,455,455,455,455,199,199,254,56]]],
    "3": [[8,[252,510,7,7,30,252,254,7,7,7,510,508]],[8,[254,254,7,7,30,252,254,7,7,7,511,508]],[6,[508,28,7,7,28,248,28,7,7,7,508,504]]],
    "8": [[8,[254,511,455,455,455,254,511,455,387,455,511,254]],[9,[124,254,231,199,238,124,254,455,455,455,254,124]],[6,[252,455,455,455,455,252,455,451,451,451,511,60]]],
    "9": [[8,[254,511,455,455,451,455,511,255,7,7,510,508]],[9,[124,254,462,454,455,463,511,254,14,14,252,248]],[9,[124,254,454,391,391,455,127,7,6,14,252,248]],[8,[124,510,387,387,387,387,255,3,3,6,508,248]]],
    ".": [[3,[0,0,0,0,0,0,0,0,0,0,511,511]],[2,[0,0,0,0,0,0,0,0,0,0,511,511]],[2,[0,0,0,0,0,0,0,0,0,0,511,480]]],
    "-": [[5,[0,0,0,0,0,0,0,511,511,0,0,0]],[5,[0,0,0,0,0,0,511,124,0,0,0,0]],[5,[0,0,0,0,0,0,511,127,0,0,0,0]]],
    "2": [[9,[124,254,143,7,14,14,28,120,240,224,511,511]],[8,[252,510,262,2,6,6,60,224,192,384,511,511]]],
    "5": [[8,[510,510,448,448,448,508,510,31,7,30,510,508]],[8,[255,255,224,192,192,254,255,7,7,7,511,508]]],
    "4": [[9,[14,30,62,62,126,238,238,462,511,511,14,14]],[10,[28,28,28,60,124,124,252,476,511,511,28,28]],[10,[12,28,28,28,60,108,204,511,255,12,12,12]],[10,[28,28,28,60,60,108,396,511,511,12,12,12]],[10,[28,28,28,60,44,108,396,511,511,12,12,12]],[7,[14,30,30,30,62,238,462,511,511,511,14,6]]],
    "6": [[9,[62,126,224,192,384,508,455,387,387,198,254,60]]],
    "7": [[7,[511,15,14,14,14,24,24,16,48,48,48,32]]]
  };
  function readXYZ() {
    const c = document.querySelector("canvas.CoordinateCanvas");

    if (!c) {
      error = "Koordinaten-Canvas fehlt";
      return null;
    }

    let img;
    try {
      img = c.getContext("2d")?.getImageData(0, 0, c.width, c.height);
    } catch (_) {
      error = "Pixel nicht lesbar";
      return null;
    }

    if (!img || img.width < 40 || img.width > 1600 ||
        img.height < 12 || img.height > 150) {
      error = "Unbekannte Canvas-Groesse";
      return null;
    }

    const {width:w, height:h, data:d} = img;
    const bright = (x, y) => {
      const i = (y * w + x) * 4;
      return d[i+3] > 100 && d[i] > 175 &&
             d[i+1] > 175 && d[i+2] > 175;
    };

    const rows = [];
    for (let y=0; y<h; y++) {
      let count=0;
      for (let x=0; x<w; x++) if (bright(x,y)) count++;
      if (count>=2) rows.push(y);
    }

    if (!rows.length) {
      error = "Keine Schriftpixel";
      return null;
    }

    const y0 = rows[0];
    const ink = rows.at(-1) - y0 + 1;

    if (ink < 8 || ink > 40) {
      error = "Schriftgroesse nicht erkannt";
      return null;
    }

    const cols = Array(w).fill(false);
    for (let x=0; x<w; x++) {
      for (let y=y0; y<y0+ink; y++) {
        if (bright(x,y)) {
          cols[x] = true;
          break;
        }
      }
    }

    const pieces = [];
    for (let x=0; x<w;) {
      if (!cols[x]) {
        x++;
        continue;
      }

      let end=x;
      while (end+1<w && cols[end+1]) end++;

      const width=end-x+1;
      const parts=width>12 ? Math.max(2,Math.round(width/9)) : 1;

      for (let k=0; k<parts; k++) {
        let l=x+Math.round(width*k/parts);
        let r=x+Math.round(width*(k+1)/parts)-1;
        while (l<=r && !cols[l]) l++;
        while (r>=l && !cols[r]) r--;
        if (l<=r) pieces.push([l,r]);
      }

      x=end+1;
    }

    const groups=[];
    for (const p of pieces) {
      if (!groups.length || p[0]-groups.at(-1).at(-1)[1]>12) {
        groups.push([p]);
      } else {
        groups.at(-1).push(p);
      }
    }

    if (groups.length!==3) {
      error = "XYZ-Gruppen nicht erkannt";
      return null;
    }

    function letter(l,r) {
      const len=r-l+1;
      const bits=[];

      for (let v=0; v<12; v++) {
        const y=y0+Math.min(ink-1,Math.floor((v+0.5)*ink/12));
        let row=0;
        for (let u=0; u<9; u++) {
          const x=l+Math.min(len-1,Math.floor((u+0.5)*len/9));
          row=(row<<1)+Number(bright(x,y));
        }
        bits.push(row);
      }

      let result="?",best=Infinity;
      for (const [symbol,variants] of Object.entries(T)) {
        for (const [width,pattern] of variants) {
          let distance=1.5*Math.abs(len-width);
          for (let i=0;i<12;i++) {
            let mask=bits[i]^pattern[i];
            while (mask) {
              mask&=mask-1;
              distance++;
            }
          }
          if (distance<best) {
            best=distance;
            result=symbol;
          }
        }
      }
      return best<=17 ? result : "?";
    }

    const values=groups.map(g=>
      g.map(([l,r])=>letter(l,r)).join("")
    );

    if (values.some(s=>!/^-?\d+\.\d{2}$/.test(s))) {
      error = "Ziffer nicht sicher erkannt";
      return null;
    }

    const [x,y,z]=values.map(Number);
    if (![x,y,z].every(Number.isFinite) ||
        Math.abs(y)>2048 || Math.abs(x)>1e9 || Math.abs(z)>1e9) {
      error = "XYZ unplausibel";
      return null;
    }

    error="";
    return {x,y,z};
  }

  function mergeSample(next,now){
    if(!next)return;
    ocrOK++;
    for(const axis of ["x","y","z"]){
      const value=next[axis];
      if(!Number.isFinite(value))continue;
      if(Number.isFinite(last[axis]) && Math.abs(value-last[axis])>24){
        const candidate=jump[axis];
        if(!candidate || Math.abs(candidate.value-value)>2.5 ||
           now-candidate.t>2200){
          jump[axis]={value,t:now};
          continue;
        }
      }
      jump[axis]=null;last[axis]=value;seen[axis]=now;
    }
  }
  function fresh(now){
    return ["x","y","z"].every(axis=>
      Number.isFinite(last[axis]) && now-seen[axis]<(axis==="y"?18000:4500)
    );
  }
  function openPage(){
    const tab=window.open(PAGE,"BloxdXYZInternetTest");
    if(tab)tab.focus();
    else error="Popup blockiert";
  }
  function updatePanel(){
    if(!panel)return;
    const now=performance.now(),good=fresh(now);
    const pct=ocrReads?Math.round(100*ocrOK/ocrReads):0;
    state.textContent=mqttReady?"● "+mqttLabel:"● "+mqttLabel;
    state.style.color=mqttReady?"#63f9af":"#ffca76";
    info.textContent=
      "OCR: "+pct+"% · Gesendet: "+txOK+
      "\nX "+(Number.isFinite(last.x)?last.x.toFixed(2):"—")+
      "  Y "+(Number.isFinite(last.y)?last.y.toFixed(2):"—")+
      "  Z "+(Number.isFinite(last.z)?last.z.toFixed(2):"—")+
      "\n"+(good?"XYZ vollständig":"XYZ unvollständig / alt")+
      " · "+(error||"Erkennung ok");
  }
  function makePanel(){
    if(!document.body || document.getElementById(NAME))return;
    panel=document.createElement("div");
    panel.id=NAME;
    panel.style.cssText="position:fixed;right:12px;bottom:15px;width:290px;max-width:calc(100vw - 24px);z-index:2147483647;border:1px solid #3b6077;border-radius:12px;background:#0a1b27f5;color:#e8f5ff;font:12px Arial,sans-serif;padding:11px;box-shadow:0 10px 30px #000a";
    const head=document.createElement("div");
    head.style.cssText="display:flex;gap:7px;align-items:center;justify-content:space-between";
    const title=document.createElement("b");title.textContent="XYZ INTERNET-TEST";
    state=document.createElement("span");state.style.cssText="font:700 10px Consolas";
    toggle=document.createElement("button");
    toggle.textContent="−";
    toggle.style.cssText="background:#1b3142;color:white;border:1px solid #466477;border-radius:6px;cursor:pointer;padding:3px 8px";
    head.append(title,state,toggle);
    body=document.createElement("div");body.style.marginTop="9px";
    const open=document.createElement("button");open.textContent="WEBSITE ÖFFNEN";
    open.style.cssText="width:100%;background:#17684b;border:1px solid #319775;color:white;border-radius:6px;padding:10px;cursor:pointer;font-weight:bold";
    open.onclick=openPage;
    const test=document.createElement("button");test.textContent="TEST-SIGNAL SENDEN";
    test.style.cssText="width:100%;background:#17334a;border:1px solid #416e87;color:#e4faff;border-radius:6px;padding:8px;cursor:pointer;margin-top:6px;font-weight:bold";
    test.onclick=testSignal;
    info=document.createElement("div");info.style.cssText="white-space:pre-wrap;margin-top:9px;color:#b5d2e0;font:10px/1.6 Consolas";
    body.append(open,test,info);panel.append(head,body);
    toggle.onclick=()=>{body.hidden=!body.hidden;toggle.textContent=body.hidden?"+":"−";};
    document.body.append(panel);updatePanel();
  }
  if(typeof GM_registerMenuCommand==="function"){
    GM_registerMenuCommand("XYZ-Testseite öffnen",openPage);
  }
  window.addEventListener("keydown",e=>{
    if(e.altKey&&e.shiftKey&&e.code==="KeyM"&&!e.repeat)openPage();
  },true);
  brokerConnect();
  setInterval(()=>{
    const now=performance.now();
    ocrReads++;
    const sample=readXYZ();
    mergeSample(sample,now);
    if(fresh(now)&&mqttReady&&now-lastPublish>=400){
      const changed=!lastSent ||
        ["x","y","z"].some(a=>Math.abs(last[a]-lastSent[a])>=.01);
      if(changed||now-lastPublish>6000){
        if(sendPayload({type:"xyz",t:Date.now(),x:last.x,y:last.y,z:last.z},true)){
          lastSent={...last};lastPublish=now;
        }
      }
    }
  },170);
  let lastSent=null;
  setInterval(updatePanel,450);
  setInterval(()=>{if(mqttReady)emit(0xc0);},19000);
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",makePanel,{once:true});
  }else makePanel();
})();
