// Bedieningspaneel (statische HTML, wordt door bot-admin geserveerd op GET).
export const HTML = String.raw`<!DOCTYPE html>
<html lang="nl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Assistent — Rotterdam Keukenmontage</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--navy:#1A2B3C;--copper:#B87333;--copper-dark:#9A5E25;--bg:#FDF8F0;--white:#fff;--line:#e8e0d4;--muted:#7a726a;--radius:10px}
*{box-sizing:border-box}
body{margin:0;font-family:Montserrat,Arial,sans-serif;background:var(--bg);color:var(--navy);font-size:14px}
header{background:var(--navy);color:#fff;padding:16px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
header h1{font-size:17px;margin:0;font-weight:800;letter-spacing:.2px}
header .sub{font-size:10px;color:var(--copper);letter-spacing:2px;font-weight:700;text-transform:uppercase}
header .spacer{flex:1}
nav{display:flex;gap:4px;padding:0 16px;background:var(--navy);flex-wrap:wrap}
nav button{background:none;border:0;color:#c9d3dd;padding:12px 16px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid transparent}
nav button.actief{color:#fff;border-bottom-color:var(--copper)}
main{padding:24px;max-width:1180px;margin:0 auto}
.kaart{background:var(--white);border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin-bottom:16px}
.kaart h2{margin:0 0 12px;font-size:15px;font-weight:800}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);padding:8px;border-bottom:2px solid var(--line)}
td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
tr:hover td{background:#fdfaf5}
button.knop{background:var(--copper);color:#fff;border:0;border-radius:8px;padding:9px 16px;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer}
button.knop:hover{background:var(--copper-dark)}
button.knop.grijs{background:#e5ded4;color:var(--navy)}
button.knop.klein{padding:5px 10px;font-size:12px}
input,select,textarea{font-family:inherit;font-size:13px;padding:8px;border:1px solid var(--line);border-radius:8px;background:#fff;width:100%;color:var(--navy)}
textarea{min-height:64px;resize:vertical}
label{display:block;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:0 0 4px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700}
.badge.actief{background:#e4f3e7;color:#276b36}
.badge.voorstel{background:#fdf0dd;color:#8a5a12}
.badge.afgewezen,.badge.gearchiveerd{background:#eee;color:#777}
.login{max-width:340px;margin:80px auto;text-align:center}
.chat{max-height:460px;overflow-y:auto;padding:8px;background:#f6f1e9;border-radius:var(--radius)}
.bubble{max-width:78%;padding:9px 13px;border-radius:14px;margin:6px 0;line-height:1.5;white-space:pre-wrap;font-size:13px}
.bubble.uit{background:var(--navy);color:#fff;margin-left:auto;border-bottom-right-radius:4px}
.bubble.in{background:#fff;border:1px solid var(--line);border-bottom-left-radius:4px}
.muted{color:var(--muted);font-size:12px}
.rij{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
dialog{border:0;border-radius:var(--radius);padding:20px;max-width:640px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,.25)}
dialog::backdrop{background:rgba(26,43,60,.55)}
.verborgen{display:none}
</style></head><body>

<div id="login" class="login">
  <h1 style="font-size:20px">Assistent-paneel</h1>
  <p class="muted">Rotterdam Keukenmontage</p>
  <input id="pw" type="password" placeholder="Wachtwoord" onkeydown="if(event.key==='Enter')inloggen()">
  <p><button class="knop" onclick="inloggen()">Inloggen</button></p>
  <p id="loginfout" class="muted"></p>
</div>

<div id="app" class="verborgen">
<header>
  <div><h1>Assistent</h1><div class="sub">Rotterdam Keukenmontage</div></div>
  <div class="spacer"></div>
  <div class="rij"><span id="statusbol" class="badge actief">aan</span>
  <button class="knop klein grijs" onclick="zetBot()">aan/uit</button>
  <button class="knop klein grijs" onclick="laden()">ververs</button></div>
</header>
<nav>
  <button class="actief" onclick="tab('prijzen',this)">Prijzenlijst</button>
  <button onclick="tab('voorstellen',this)">Voorstellen <span id="telVoorstellen"></span></button>
  <button onclick="tab('gesprekken',this)">Gesprekken</button>
  <button onclick="tab('test',this)">Test-chat</button>
  <button onclick="tab('acties',this)">Acties</button>
  <button onclick="tab('instellingen',this)">Instellingen</button>
</nav>
<main>

<section id="tab-prijzen">
  <div class="kaart"><div class="rij" style="justify-content:space-between">
    <h2 style="margin:0">Prijzenlijst</h2><button class="knop" onclick="bewerkPrijs(null)">+ Dienst toevoegen</button></div>
    <p class="muted">Alles wat op <b>actief</b> staat mag de assistent zelf aan klanten noemen. Bedragen zijn excl. btw.</p>
    <table><thead><tr><th>Dienst</th><th>Status</th><th>Prijs</th><th>Eenheid</th><th></th></tr></thead>
    <tbody id="prijzenBody"></tbody></table>
  </div>
</section>

<section id="tab-voorstellen" class="verborgen">
  <div class="kaart"><h2>Prijsvoorstellen</h2>
  <p class="muted">Nieuwe klussen die nog niet in de lijst staan. Keur je goed, dan komt de prijs in de lijst en krijgt de klant automatisch antwoord.</p>
  <div id="voorstellenLijst"></div></div>
</section>

<section id="tab-gesprekken" class="verborgen">
  <div class="kaart"><h2>Gesprekken</h2>
  <table><thead><tr><th>Klant</th><th>Dienst</th><th>Status</th><th>Laatst</th><th></th></tr></thead>
  <tbody id="gesprekkenBody"></tbody></table></div>
  <div class="kaart verborgen" id="gesprekKaart"><h2 id="gesprekTitel">Gesprek</h2><div id="gesprekChat" class="chat"></div></div>
</section>

<section id="tab-test" class="verborgen">
  <div class="kaart"><div class="rij" style="justify-content:space-between"><h2 style="margin:0">Test-chat</h2>
  <button class="knop grijs klein" onclick="testReset()">Gesprek wissen</button></div>
  <p class="muted">Praat met de assistent alsof je een klant bent. Er wordt niets naar WhatsApp gestuurd.</p>
  <div id="testChat" class="chat"></div>
  <div class="rij" style="margin-top:10px"><input id="testInput" placeholder="Typ een klantvraag..." onkeydown="if(event.key==='Enter')testStuur()" style="flex:1">
  <button class="knop" onclick="testStuur()">Stuur</button></div></div>
</section>

<section id="tab-acties" class="verborgen">
  <div class="kaart"><h2>Lopende acties</h2>
  <p class="muted">Alleen acties die aan staan mag de assistent noemen.</p>
  <div id="actiesLijst"></div></div>
</section>

<section id="tab-instellingen" class="verborgen">
  <div class="kaart"><h2>Instellingen</h2><div id="instellingenLijst"></div></div>
</section>

</main></div>

<dialog id="prijsDialoog"><h2 id="prijsTitel" style="margin-top:0">Dienst</h2>
<div class="grid">
  <div><label>Slug (uniek)</label><input id="f_slug"></div>
  <div><label>Naam</label><input id="f_naam"></div>
  <div><label>Status</label><select id="f_status"><option value="actief">actief</option><option value="voorstel">voorstel</option><option value="gearchiveerd">gearchiveerd</option></select></div>
  <div><label>Prijsmodel</label><select id="f_prijsmodel"><option>vast</option><option>vanaf</option><option>bandbreedte</option><option>per_uur</option><option>per_stuk</option><option>per_meter</option><option>per_m2</option><option>calculator</option><option>pm</option></select></div>
  <div><label>Prijs min (excl. btw)</label><input id="f_min" type="number" step="0.01"></div>
  <div><label>Prijs max (excl. btw)</label><input id="f_max" type="number" step="0.01"></div>
  <div><label>Eenheid</label><input id="f_eenheid" placeholder="per klus / per uur / per meter"></div>
  <div><label>Uurtarief</label><input id="f_uur" type="number" step="0.01"></div>
  <div><label>Minimumbedrag</label><input id="f_minimum" type="number" step="0.01"></div>
  <div><label>Geschatte tijd (min)</label><input id="f_tijd" type="number"></div>
  <div><label>Calculator dienst_type</label><input id="f_calc" placeholder="alleen bij prijsmodel calculator"></div>
  <div><label>Categorie</label><input id="f_cat"></div>
</div>
<p><label>Zoekwoorden van klanten (komma's)</label><input id="f_alias"></p>
<p><label>Toelichting voor de assistent</label><textarea id="f_toel"></textarea></p>
<p><label>Vragen die de assistent moet stellen (één per regel)</label><textarea id="f_vragen"></textarea></p>
<div class="rij" style="justify-content:flex-end"><button class="knop grijs" onclick="prijsDialoog.close()">Annuleren</button><button class="knop" onclick="prijsOpslaan()">Opslaan</button></div>
</dialog>

<script>
var PW='', DATA={};
function api(actie, extra){
  var body = Object.assign({actie:actie}, extra||{});
  return fetch(location.pathname, {method:'POST', headers:{'Content-Type':'application/json','x-admin-wachtwoord':PW}, body:JSON.stringify(body)})
    .then(function(r){ return r.json(); });
}
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function eur(n){ return n==null?'':'€ ' + Number(n).toLocaleString('nl-NL',{minimumFractionDigits:0,maximumFractionDigits:2}); }

function inloggen(){
  PW = document.getElementById('pw').value;
  api('overzicht').then(function(d){
    if(d.fout){ document.getElementById('loginfout').textContent = d.fout; return; }
    document.getElementById('login').classList.add('verborgen');
    document.getElementById('app').classList.remove('verborgen');
    try{ localStorage; }catch(e){}
    toon(d);
  });
}
function laden(){ api('overzicht').then(toon); }

function toon(d){
  DATA = d;
  var actief = true;
  (d.instellingen||[]).forEach(function(i){ if(i.key==='actief') actief = (i.waarde===true||i.waarde==='true'); });
  var bol = document.getElementById('statusbol');
  bol.textContent = actief ? 'aan' : 'uit';
  bol.className = 'badge ' + (actief?'actief':'afgewezen');

  var body = document.getElementById('prijzenBody'); body.innerHTML='';
  (d.prijzen||[]).forEach(function(p){
    var prijs = p.prijsmodel==='calculator' ? '<span class="muted">via calculator</span>'
      : (p.prijs_min!=null ? eur(p.prijs_min) + (p.prijs_max!=null && p.prijs_max!==p.prijs_min ? ' - ' + eur(p.prijs_max) : '') : (p.uurtarief? eur(p.uurtarief)+' /uur' : '-'));
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><b>'+esc(p.naam)+'</b><br><span class="muted">'+esc(p.slug)+'</span></td>'
      + '<td><span class="badge '+esc(p.status)+'">'+esc(p.status)+'</span></td>'
      + '<td>'+prijs+(p.minimumbedrag?'<br><span class="muted">min. '+eur(p.minimumbedrag)+'</span>':'')+'</td>'
      + '<td>'+esc(p.eenheid||'')+'</td>'
      + '<td style="text-align:right"><button class="knop klein grijs">Bewerken</button></td>';
    tr.querySelector('button').onclick = function(){ bewerkPrijs(p); };
    body.appendChild(tr);
  });

  var open = (d.voorstellen||[]).filter(function(v){ return v.status==='open'; });
  document.getElementById('telVoorstellen').textContent = open.length ? '('+open.length+')' : '';
  var vl = document.getElementById('voorstellenLijst'); vl.innerHTML='';
  (d.voorstellen||[]).forEach(function(v){
    var div = document.createElement('div');
    div.style.cssText = 'border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px';
    var knoppen = v.status==='open'
      ? '<div class="rij" style="margin-top:8px"><input class="vmin" type="number" step="1" placeholder="min" value="'+(v.voorstel_prijs_min||'')+'" style="width:100px">'
        + '<input class="vmax" type="number" step="1" placeholder="max" value="'+(v.voorstel_prijs_max||'')+'" style="width:100px">'
        + '<button class="knop klein ja">Goedkeuren</button><button class="knop klein grijs nee">Afwijzen</button></div>'
      : '<p class="muted" style="margin:6px 0 0">Afgehandeld: '+esc(v.status)+(v.definitieve_prijs_min?' — '+eur(v.definitieve_prijs_min)+(v.definitieve_prijs_max&&v.definitieve_prijs_max!==v.definitieve_prijs_min?' - '+eur(v.definitieve_prijs_max):''):'')+'</p>';
    div.innerHTML = '<div class="rij" style="justify-content:space-between"><b>#'+v.id+' '+esc(v.dienst_naam)+'</b>'
      + '<span class="badge '+(v.status==='open'?'voorstel':'gearchiveerd')+'">'+esc(v.status)+'</span></div>'
      + (v.klant_vraag?'<p class="muted" style="margin:6px 0">Klant +'+esc(v.customer_phone)+': "'+esc(v.klant_vraag)+'"</p>':'')
      + '<p style="margin:6px 0">Voorstel: <b>'+eur(v.voorstel_prijs_min)+' - '+eur(v.voorstel_prijs_max)+'</b> excl. btw '+esc(v.voorstel_eenheid||'')+'</p>'
      + '<p class="muted" style="margin:6px 0;white-space:pre-wrap">'+esc(v.onderbouwing||'')+'</p>' + knoppen;
    if(v.status==='open'){
      div.querySelector('.ja').onclick = function(){
        var mn = div.querySelector('.vmin').value, mx = div.querySelector('.vmax').value;
        this.disabled=true; this.textContent='Bezig...';
        api('voorstel_afhandelen',{id:v.id, akkoord:true, prijs_min:mn?Number(mn):null, prijs_max:mx?Number(mx):null}).then(laden);
      };
      div.querySelector('.nee').onclick = function(){
        var reden = prompt('Reden (optioneel)')||'';
        this.disabled=true; api('voorstel_afhandelen',{id:v.id, akkoord:false, reden:reden}).then(laden);
      };
    }
    vl.appendChild(div);
  });

  var gb = document.getElementById('gesprekkenBody'); gb.innerHTML='';
  (d.gesprekken||[]).forEach(function(g){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><b>'+esc(g.naam||'onbekend')+'</b><br><span class="muted">+'+esc(g.customer_phone)+'</span></td>'
      + '<td>'+esc(g.dienst_focus||'')+'<br><span class="muted">'+esc((g.samenvatting||'').slice(0,90))+'</span></td>'
      + '<td><span class="badge '+(g.status==='bot'?'actief':'voorstel')+'">'+esc(g.status)+'</span></td>'
      + '<td class="muted">'+ (g.updated_at? new Date(g.updated_at).toLocaleString('nl-NL') : '') +'</td>'
      + '<td style="text-align:right"><button class="knop klein grijs lees">Lees mee</button> <button class="knop klein grijs over">'+(g.status==='overgenomen'?'Terug naar bot':'Zelf overnemen')+'</button></td>';
    tr.querySelector('.lees').onclick = function(){ opengesprek(g); };
    tr.querySelector('.over').onclick = function(){ api('gesprek_overnemen',{telefoon:g.customer_phone, terug: g.status==='overgenomen'}).then(laden); };
    gb.appendChild(tr);
  });

  var al = document.getElementById('actiesLijst'); al.innerHTML='';
  (d.acties||[]).forEach(function(a){
    var div=document.createElement('div');
    div.style.cssText='border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px';
    div.innerHTML='<div class="rij" style="justify-content:space-between"><b>'+esc(a.title)+'</b>'
      +'<label class="rij" style="text-transform:none;font-size:13px"><input type="checkbox" style="width:auto" '+(a.active?'checked':'')+'> aan</label></div>'
      +'<p class="muted" style="margin:6px 0">'+esc(a.description)+'</p>'
      +(a.conditions?'<p class="muted" style="margin:0">Voorwaarden: '+esc(a.conditions)+'</p>':'');
    div.querySelector('input').onchange = function(){
      api('actie_opslaan',{rij:{slug:a.slug,title:a.title,description:a.description,conditions:a.conditions,active:this.checked,valid_until:a.valid_until}}).then(laden);
    };
    al.appendChild(div);
  });

  var il = document.getElementById('instellingenLijst'); il.innerHTML='';
  (d.instellingen||[]).forEach(function(i){
    var div=document.createElement('div'); div.className='rij'; div.style.margin='0 0 10px';
    var waarde = typeof i.waarde==='string'? i.waarde : JSON.stringify(i.waarde);
    div.innerHTML='<div style="min-width:180px"><b>'+esc(i.key)+'</b><br><span class="muted">'+esc(i.toelichting||'')+'</span></div>'
      +'<input value="'+esc(waarde)+'" style="flex:1"><button class="knop klein">Opslaan</button>';
    div.querySelector('button').onclick=function(){
      var v = div.querySelector('input').value;
      var parsed; try{ parsed = JSON.parse(v); }catch(e){ parsed = v; }
      api('instelling_opslaan',{key:i.key, waarde:parsed}).then(laden);
    };
    il.appendChild(div);
  });
}

function opengesprek(g){
  document.getElementById('gesprekKaart').classList.remove('verborgen');
  document.getElementById('gesprekTitel').textContent = (g.naam||'Onbekend') + ' — +' + g.customer_phone;
  api('gesprek',{telefoon:g.customer_phone}).then(function(d){
    var c = document.getElementById('gesprekChat'); c.innerHTML='';
    (d.berichten||[]).forEach(function(m){
      var b=document.createElement('div'); b.className='bubble '+(m.direction==='inbound'?'in':'uit'); b.textContent=m.body; c.appendChild(b);
    });
    c.scrollTop = c.scrollHeight;
  });
}

function bewerkPrijs(p){
  document.getElementById('prijsTitel').textContent = p? 'Dienst bewerken' : 'Nieuwe dienst';
  var v = p||{};
  f_slug.value=v.slug||''; f_slug.readOnly=!!p; f_naam.value=v.naam||''; f_status.value=v.status||'actief';
  f_prijsmodel.value=v.prijsmodel||'bandbreedte'; f_min.value=v.prijs_min==null?'':v.prijs_min; f_max.value=v.prijs_max==null?'':v.prijs_max;
  f_eenheid.value=v.eenheid||''; f_uur.value=v.uurtarief==null?'':v.uurtarief; f_minimum.value=v.minimumbedrag==null?'':v.minimumbedrag;
  f_tijd.value=v.geschatte_tijd_minuten==null?'':v.geschatte_tijd_minuten; f_calc.value=v.calculator_dienst_type||''; f_cat.value=v.categorie||'';
  f_alias.value=(v.aliassen||[]).join(', '); f_toel.value=v.toelichting||''; f_vragen.value=(v.vragen||[]).join('\n');
  prijsDialoog.showModal();
}
function prijsOpslaan(){
  var rij = {
    slug: f_slug.value.trim(), naam: f_naam.value.trim(), status: f_status.value, prijsmodel: f_prijsmodel.value,
    prijs_min: f_min.value===''?null:Number(f_min.value), prijs_max: f_max.value===''?null:Number(f_max.value),
    eenheid: f_eenheid.value.trim()||null, uurtarief: f_uur.value===''?null:Number(f_uur.value),
    minimumbedrag: f_minimum.value===''?null:Number(f_minimum.value),
    geschatte_tijd_minuten: f_tijd.value===''?null:Number(f_tijd.value),
    calculator_dienst_type: f_calc.value.trim()||null, categorie: f_cat.value.trim()||null,
    aliassen: f_alias.value.split(',').map(function(s){return s.trim();}).filter(Boolean),
    vragen: f_vragen.value.split('\n').map(function(s){return s.trim();}).filter(Boolean)
  };
  api('prijs_opslaan',{rij:rij}).then(function(d){ if(d.fout){alert(d.fout);return;} prijsDialoog.close(); laden(); });
}

function tab(naam, btn){
  ['prijzen','voorstellen','gesprekken','test','acties','instellingen'].forEach(function(t){
    document.getElementById('tab-'+t).classList.toggle('verborgen', t!==naam);
  });
  Array.prototype.forEach.call(document.querySelectorAll('nav button'), function(b){ b.classList.remove('actief'); });
  btn.classList.add('actief');
}

function zetBot(){
  var huidig = document.getElementById('statusbol').textContent==='aan';
  api('instelling_opslaan',{key:'actief', waarde: !huidig}).then(laden);
}

function bubbel(tekst, richting){
  var c=document.getElementById('testChat');
  var b=document.createElement('div'); b.className='bubble '+richting; b.textContent=tekst; c.appendChild(b); c.scrollTop=c.scrollHeight;
}
function testStuur(){
  var inp=document.getElementById('testInput'); var t=inp.value.trim(); if(!t) return;
  inp.value=''; bubbel(t,'in'); bubbel('...','uit');
  var c=document.getElementById('testChat'); var laatste=c.lastChild;
  api('test_chat',{tekst:t}).then(function(d){ laatste.textContent = d.antwoord || d.fout || '(geen antwoord)'; c.scrollTop=c.scrollHeight; });
}
function testReset(){ document.getElementById('testChat').innerHTML=''; api('test_chat',{reset:true, tekst:''}); }
</script>
</body></html>`;
