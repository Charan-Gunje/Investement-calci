const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CURRENCIES = ['INR','USD','EUR','GBP','JPY','CAD','AUD','SGD','AED','CHF'];
const LABELS = {monthlyContribution:'Monthly contribution',principal:'Initial investment',annualRate:'Expected annual return',years:'Time horizon',compoundingFrequency:'Compounding frequency',investment:'Amount invested',finalValue:'Current or final value',targetAmount:'Target amount',currentAmount:'Amount today',inflationRate:'Assumed annual inflation'};
const FIELD = {
  monthlyContribution:{min:.01,max:1e12,step:.01,suffix:'per month'},principal:{min:.01,max:1e12,step:.01},annualRate:{min:0,max:100,step:.01,suffix:'% p.a.'},years:{min:.0833333333333,max:80,step:'any',suffix:'years; SIP and goal terms must resolve to whole months'},
  compoundingFrequency:{select:[['1','Annually'],['2','Half-yearly'],['4','Quarterly'],['12','Monthly'],['365','Daily']]},investment:{min:.01,max:1e12,step:.01},finalValue:{min:0,max:1e12,step:.01},targetAmount:{min:.01,max:1e12,step:.01},currentAmount:{min:.01,max:1e12,step:.01},inflationRate:{min:0,max:100,step:.01,suffix:'% p.a.'}
};
const ICONS = {
  sip:'<path d="M4 16 9 11l4 4 7-8"/><path d="M14 7h6v6"/>',
  'lump-sum':'<circle cx="12" cy="12" r="8"/><path d="M12 8v8m-3-5h6"/>',
  'simple-interest':'<path d="M4 19V5m0 14h16M7 15l4-4 3 2 6-7"/>',
  'compound-interest':'<path d="M5 18V6m0 12h14M8 15l3-3 3 1 5-7"/><path d="M16 6h3v3"/>',
  roi:'<path d="M5 19 19 5"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>',
  goal:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="m12 12 7-7"/>',
  inflation:'<path d="M4 18h16M5 15l4-5 3 3 6-8"/><path d="M15 5h3v3"/>',
  currency:'<path d="M12 3v18m5-14c0-1.1-1.8-2-4-2s-4 .9-4 2 1.8 2 4 2 4 .9 4 2-1.8 2-4 2-4-.9-4-2"/>',
  history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5m4-1v5l3 2"/>',
  shield:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  compare:'<path d="M8 5H4v14h4M16 5h4v14h-4M9 9l3-3 3 3m-3-3v12"/>'
};
const state = { user:null, calculators:[], currency:'INR', lastResult:null, lastType:null, lastInputs:null, savedId:null, adminTab:'users', adminData:null, compareTypes:['sip','lump-sum'], compareResult:null, editRate:null, mobile:false, searchQuery:'' };
const NAV_ICONS = {
  home:'<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/>',
  calculators:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2m4 0h2M8 15h2m4 0h2"/>',
  compare:ICONS.compare, history:ICONS.history, currency:ICONS.currency, admin:ICONS.shield,
  about:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>'
};

async function request(path, options={}) {
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const type=response.headers.get('content-type')||'';
  const payload=type.includes('application/json')?await response.json():null;
  if(!response.ok)throw Object.assign(new Error(payload?.error||'Request failed.'),{status:response.status});
  return payload;
}
const post=(url,data)=>request(url,{method:'POST',body:JSON.stringify(data)});
const patch=(url,data)=>request(url,{method:'PATCH',body:JSON.stringify(data)});
function toast(message,error=false){const el=$('#toast');el.textContent=message;el.classList.toggle('error',error);el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3400);}
function fmt(value,currency=state.currency){const amount=Number(value)||0;try{return new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(amount);}catch{return `${currency} ${amount.toFixed(2)}`;}}
function parsedDate(value){return new Date(value.includes('Z')?value:value.replace(' ','T')+'Z');}
function dateLabel(value){const date=parsedDate(value);return Number.isNaN(date.valueOf())?value:new Intl.DateTimeFormat('en-IN',{dateStyle:'medium'}).format(date);}
function dateTimeLabel(value){const date=parsedDate(value);return Number.isNaN(date.valueOf())?value:new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(date);}
function localDateInput(value){const date=parsedDate(value);return Number.isNaN(date.valueOf())?'':new Date(date.valueOf()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function icon(type){return `<span class="calc-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${ICONS[type]||ICONS.goal}</svg></span>`;}
function navIcon(type){return `<span class="nav-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${NAV_ICONS[type]||ICONS.goal}</svg></span>`;}
function pieItems(result={}){
  if(Array.isArray(result.pie)&&result.pie.length){
    const stored=result.pie.map(item=>({label:String(item.label||'Value'),value:Number(item.value)||0}));
    if(result.type==='goal')return [{...stored[0],label:'Contributions'},{...stored[1],label:'Growth'}];
    if(result.type==='inflation')return [{...stored[0],label:'Amount today'},{...stored[1],label:'Cost increase'}];
    if(result.type==='roi')return [{...stored[0],label:/current/i.test(stored[0].label)?'Current value':'Invested'},{...stored[1],label:/loss/i.test(stored[1].label)?'Loss':'Gain'}];
    return [{...stored[0],label:/current/i.test(stored[0].label)?'Current value':'Invested'},{...stored[1],label:/loss/i.test(stored[1].label)?'Loss':'Gain'}];
  }
  const metrics=result.metrics||{};
  if(result.type==='goal')return [{label:'Contributions',value:Number(metrics.totalContributions)||0},{label:'Growth',value:Number(metrics.estimatedGrowth)||0}];
  if(result.type==='inflation')return [{label:'Amount today',value:Number(metrics.amountToday)||0},{label:'Cost increase',value:Number(metrics.estimatedCostIncrease)||0}];
  if(result.type==='roi'){
    const gain=Number(metrics.gainOrLoss)||0;
    return gain>=0?[{label:'Invested',value:Number(metrics.investedAmount)||0},{label:'Gain',value:gain}]:[{label:'Current value',value:Number(metrics.currentOrFinalValue)||0},{label:'Loss',value:Math.abs(gain)}];
  }
  const principal=Number(result.principal??metrics.investedAmount)||0;
  const returns=Number(result.estimatedReturns??metrics.estimatedReturns)||0;
  const total=Number(result.totalValue??metrics.totalValue)||0;
  return returns>=0?[{label:'Invested',value:principal},{label:'Gain',value:returns}]:[{label:'Current value',value:Math.max(0,total)},{label:'Loss',value:Math.abs(returns)}];
}
function renderDonutBreakdown(result,compact=false){
  const items=pieItems(result).filter(item=>Number.isFinite(item.value)&&item.value>=0);
  const total=items.reduce((sum,item)=>sum+item.value,0);
  if(!items.length||total<=0)return '<div class="pie-empty">No positive values to chart.</div>';
  const colors=['chart-color-invested','chart-color-gain','chart-color-projected','chart-color-other'];
  let offset=0;
  const slices=items.map((item,index)=>{
    if(item.value<=0)return '';
    const share=item.value/total*100,segment=`<circle class="donut-segment ${colors[index%colors.length]}" cx="60" cy="60" r="46" pathLength="100" stroke-dasharray="${share.toFixed(3)} ${(100-share).toFixed(3)}" stroke-dashoffset="${(-offset).toFixed(3)}" transform="rotate(-90 60 60)"/>`;
    offset+=share;
    return segment;
  }).join('');
  const description=items.map(item=>`${item.label}: ${fmt(item.value,result.currency)}`).join('; ');
  const centerLabel=result.type==='inflation'?'FUTURE COST':result.type==='roi'&&Number(result.metrics?.gainOrLoss)<0?'INVESTED':result.type==='goal'?'TARGET':'PROJECTED';
  return `<div class="investment-composition${compact?' compact':''}"><div class="donut-wrap"><svg class="donut-chart" viewBox="0 0 120 120" role="img" aria-label="Investment composition: ${escapeHtml(description)}"><title>Investment composition</title><desc>${escapeHtml(description)}</desc><circle class="donut-base" cx="60" cy="60" r="46"/>${slices}</svg><div class="donut-center"><small>${centerLabel}</small><strong>${fmt(total,result.currency)}</strong></div></div><div class="chart-legend">${items.map((item,index)=>`<div class="chart-legend-row"><span><i class="chart-dot ${colors[index%colors.length]}" aria-hidden="true"></i>${escapeHtml(item.label)}</span><strong>${fmt(item.value,result.currency)}</strong></div>`).join('')}</div></div>`;
}
function comparisonItems(result={}){
  const metrics=result.metrics||{};
  if(result.type==='goal')return [
    {label:'Contributions',value:Number(metrics.totalContributions)||0,color:'chart-color-invested'},
    {label:'Growth',value:Math.max(0,Number(metrics.estimatedGrowth)||0),color:'chart-color-gain'},
    {label:'Goal',value:Number(metrics.targetAmount??result.totalValue)||0,color:'chart-color-projected'}
  ];
  if(result.type==='inflation')return [
    {label:'Today',value:Number(metrics.amountToday)||0,color:'chart-color-invested'},
    {label:'Cost increase',value:Math.max(0,Number(metrics.estimatedCostIncrease)||0),color:'chart-color-gain'},
    {label:'Future cost',value:Number(metrics.estimatedFutureCost??result.totalValue)||0,color:'chart-color-projected'}
  ];
  if(result.type==='roi'){
    const gain=Number(metrics.gainOrLoss)||0;
    return [
      {label:'Invested',value:Number(metrics.investedAmount)||0,color:'chart-color-invested'},
      {label:gain<0?'Loss':'Gain',value:Math.abs(gain),color:'chart-color-gain',negative:gain<0},
      {label:'Current value',value:Number(metrics.currentOrFinalValue??result.totalValue)||0,color:'chart-color-projected'}
    ];
  }
  const returns=Number(result.estimatedReturns??metrics.estimatedReturns)||0;
  return [
    {label:'Invested',value:Number(result.principal??metrics.investedAmount)||0,color:'chart-color-invested'},
    {label:returns<0?'Loss':'Gain',value:Math.abs(returns),color:'chart-color-gain',negative:returns<0},
    {label:'Projected',value:Number(result.totalValue??metrics.totalValue)||0,color:'chart-color-projected'}
  ];
}
function renderValueComparison(result,compact=false){
  const items=comparisonItems(result),max=Math.max(1,...items.map(item=>item.value));
  const description=items.map(item=>`${item.label}: ${fmt(item.negative?-item.value:item.value,result.currency)}`).join('; ');
  return `<div class="value-comparison${compact?' compact':''}" role="img" aria-label="Value comparison: ${escapeHtml(description)}">${items.map(item=>`<div class="comparison-row"><span class="comparison-label">${escapeHtml(item.label)}</span><div class="comparison-track"><span class="comparison-fill ${item.color}" style="width:${Math.max(0,Math.min(100,item.value/max*100)).toFixed(2)}%"></span></div><strong>${fmt(item.negative?-item.value:item.value,result.currency)}</strong></div>`).join('')}<div class="comparison-scale"><span>0</span><span>${fmt(max,result.currency)}</span></div></div>`;
}
function projectionTimeline(output,inputs={}){
  const type=output.type||'',metrics=output.metrics||{},horizon=Number(inputs.years??output.inputs?.years);
  const invested=Number(output.principal??metrics.investedAmount??metrics.totalContributions??metrics.amountToday)||0;
  const projected=Number(output.totalValue??metrics.totalValue??metrics.targetAmount??metrics.estimatedFutureCost)||0;
  if(type==='roi')return {points:[{time:0,value:invested,label:'Invested'},{time:1,value:projected,label:'Current'}],horizon:0,isRoi:true};
  const years=Number.isFinite(horizon)&&horizon>0?horizon:1;
  const annualRate=Number(inputs.annualRate??inputs.inflationRate??0)/100;
  const frequency=Math.max(1,Number(inputs.compoundingFrequency)||12);
  const monthlyPayment=Number(type==='goal'?metrics.requiredMonthlyContribution:inputs.monthlyContribution)||0;
  const valueAt=time=>{
    if(type==='sip'||type==='goal'){
      const months=Math.round(time*12),monthlyRate=annualRate/12;
      return monthlyPayment*(monthlyRate===0?months:((1+monthlyRate)**months-1)/monthlyRate);
    }
    if(type==='simple-interest')return invested*(1+annualRate*time);
    if(type==='compound-interest')return invested*(1+annualRate/frequency)**(frequency*time);
    if(type==='inflation')return invested*(1+annualRate)**time;
    return invested*(1+annualRate)**time;
  };
  const points=Array.from({length:9},(_,index)=>{
    const time=years*index/8;
    return {time,value:index===8?projected:valueAt(time),label:index===0?'Start':`${Number(time.toFixed(2))} years`};
  });
  if(type==='sip'||type==='goal')points[0].value=0;
  return {points,horizon:years,isRoi:false};
}
function compactCurrency(value,currency){
  try{return new Intl.NumberFormat('en-IN',{style:'currency',currency,notation:'compact',maximumFractionDigits:1}).format(value);}
  catch{return fmt(value,currency);}
}
function renderProjectionLine(output,inputs,currency){
  const series=projectionTimeline(output,inputs),points=series.points,plot={left:76,right:632,top:18,bottom:215};
  const max=Math.max(1,...points.map(point=>point.value)),range=plot.bottom-plot.top;
  const coords=points.map((point,index)=>({x:plot.left+(plot.right-plot.left)*index/(points.length-1),y:plot.bottom-range*point.value/max,value:point.value,label:point.label}));
  const linePath=coords.map((point,index)=>`${index?'L':'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const areaPath=`${linePath} L ${plot.right} ${plot.bottom} L ${plot.left} ${plot.bottom} Z`;
  const grid=Array.from({length:5},(_,index)=>{
    const ratio=index/4,y=plot.bottom-range*ratio,value=max*ratio;
    return `<g class="projection-gridline"><line x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}"/><text x="${plot.left-12}" y="${y+3}" text-anchor="end">${escapeHtml(compactCurrency(value,currency))}</text></g>`;
  }).join('');
  const dots=coords.map(point=>`<circle class="projection-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3"><title>${escapeHtml(point.label)}: ${escapeHtml(fmt(point.value,currency))}</title></circle>`).join('');
  const months=Math.round(series.horizon*12),durationLabel=months<12?`${months} ${months===1?'month':'months'}`:`${series.horizon.toLocaleString('en-IN',{maximumFractionDigits:2})} ${series.horizon===1?'year':'years'}`;
  const startLabel=series.isRoi?'Invested':'Today',endLabel=series.isRoi?'Current value':durationLabel;
  const description=`${output.calculatorName||'Investment'} ${series.isRoi?'value comparison':'projection'} from ${fmt(points[0].value,currency)} to ${fmt(points.at(-1).value,currency)}${series.isRoi?'':` over ${endLabel}`}.`;
  return `<svg class="projection-line-chart" viewBox="0 0 660 264" role="img" aria-label="${escapeHtml(description)}"><title>${escapeHtml(description)}</title><defs><linearGradient id="projection-line-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#b7dc82" stop-opacity=".3"/><stop offset="1" stop-color="#b7dc82" stop-opacity=".015"/></linearGradient></defs>${grid}<path class="projection-line-area" d="${areaPath}"/><path class="projection-line-path" d="${linePath}"/>${dots}<text class="projection-axis-label" x="${plot.left}" y="248">${startLabel}</text><text class="projection-axis-label" x="${plot.right}" y="248" text-anchor="end">${escapeHtml(endLabel)}</text></svg><div class="projection-chart-legend"><span><i aria-hidden="true"></i>${series.isRoi?'Saved value':'Estimated value'}</span><strong>${fmt(points.at(-1).value,currency)}</strong></div>`;
}
function currencyOptions(selected=state.currency){return CURRENCIES.map(code=>`<option value="${code}" ${code===selected?'selected':''}>${code}</option>`).join('');}
function calcCard(calc){return `<a class="calc-card" data-search="${escapeHtml(`${calc.name} ${calc.category} ${calc.type}`.toLowerCase())}" href="#calculator/${encodeURIComponent(calc.type)}">${icon(calc.type)}<h3>${escapeHtml(calc.name)}</h3><p>${escapeHtml(calc.description)}</p><span class="card-link">Open calculator <span aria-hidden="true">↗</span></span></a>`;}
function activeRoute(){const route=location.hash.replace(/^#\/?/,'')||'home';const [page,...rest]=route.split('/');return {page,args:rest.map(decodeURIComponent)};}
function workspaceCopy(route){
  const calc=route.page==='calculator'?state.calculators.find(item=>item.type===route.args[0]):null;
  const copy={home:['Workspace','Investment overview'],calculators:['Planning','Calculator library'],compare:['Planning','Compare investment plans'],history:['Insights','Calculation history'],currency:['Insights','Currency converter'],profile:['Account','Account profile'],admin:['Administration','System administration'],about:['Account','About Investly']};
  return route.page==='calculator'?[calc?.category||'Planning',calc?`${calc.name} calculator`:'Investment calculator']:copy[route.page]||copy.home;
}
function applyCalculatorSearch(query=state.searchQuery){
  const cards=$$('.calculator-grid .calc-card');if(!cards.length)return;
  const term=String(query||'').trim().toLowerCase();let visible=0;
  cards.forEach(card=>{const match=!term||card.dataset.search.includes(term);card.classList.toggle('search-hidden',!match);if(match)visible++;});
  const status=$('#calculator-search-status');if(status)status.textContent=term?(visible?`${visible} calculator${visible===1?'':'s'} found`:'No calculators match that search.'):'';
}
function renderHeader(){
  const r=activeRoute(),isSignedIn=Boolean(state.user);document.body.classList.toggle('app-layout',isSignedIn);document.body.classList.toggle('nav-open',isSignedIn&&state.mobile);$$('[data-nav]').forEach(a=>{a.classList.toggle('active',a.dataset.nav===r.page||(r.page==='calculator'&&a.dataset.nav==='calculators'));if(isSignedIn&&!a.querySelector('.nav-icon'))a.insertAdjacentHTML('afterbegin',navIcon(a.dataset.nav));else if(!isSignedIn)a.querySelector('.nav-icon')?.remove();});
  const actions=$('#header-actions');
  if(state.user){actions.innerHTML=`<a class="user-chip" href="#profile"><span class="user-avatar">${escapeHtml(state.user.name.slice(0,1).toUpperCase())}</span><span>${escapeHtml(state.user.name.split(' ')[0])}</span></a><button class="button button-secondary button-small" data-action="logout">Log out</button>`;$$('.auth-only').forEach(el=>el.classList.remove('hide'));}
  else{actions.innerHTML='<button class="button button-quiet button-small" data-action="auth" data-mode="login">Log in</button><button class="button button-primary button-small" data-action="auth" data-mode="register">Get started</button>';$$('.auth-only').forEach(el=>el.classList.add('hide'));}
  $$('.admin-only').forEach(link=>link.classList.toggle('hide',state.user?.role!=='admin'));
  $$('.top-nav').forEach(nav=>nav.classList.toggle('open',state.mobile));const menu=$('#mobile-menu');menu.setAttribute('aria-expanded',String(state.mobile));menu.setAttribute('aria-label',state.mobile?'Close navigation':'Open navigation');
  const [section,title]=workspaceCopy(r);$('#workspace-section').textContent=section;$('#workspace-title').textContent=title;
}
function renderField(name,values={},prefix=''){
  const meta=FIELD[name]||{};const id=`${prefix}${name}`;const label=LABELS[name]||name;
  if(meta.select)return `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${name}">${meta.select.map(([v,l])=>`<option value="${v}" ${String(values[name]??12)===v?'selected':''}>${l}</option>`).join('')}</select></div>`;
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="number" inputmode="decimal" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${escapeHtml(values[name]??'')}" placeholder="${meta.suffix?'e.g. 8':'Enter amount'}" required><small>${meta.suffix||'Enter an amount in your selected currency.'}</small></div>`;
}
function renderResult(result,savedId=state.savedId){
  const metrics=result.metrics||{};let entries;
  if(result.type==='goal')entries=[['Monthly contribution',metrics.requiredMonthlyContribution],['Planned contributions',metrics.totalContributions],['Estimated growth',metrics.estimatedGrowth]];
  else if(result.type==='inflation')entries=[['Amount today',metrics.amountToday],['Estimated cost increase',metrics.estimatedCostIncrease]];
  else if(result.type==='roi')entries=[['Amount invested',metrics.investedAmount],['Gain / loss',metrics.gainOrLoss],['Return on investment',`${metrics.roiPercent}%`]];
  else entries=[['Total invested',metrics.investedAmount],['Estimated gain',metrics.estimatedReturns]];
  const horizon=Number(state.lastInputs?.years),periodText=Number.isFinite(horizon)&&horizon>0?` after ${horizon.toLocaleString('en-US',{maximumFractionDigits:2})} ${horizon===1?'year':'years'}`:'';
  const totalLabel=result.type==='inflation'?`Estimated future cost${periodText}`:result.type==='goal'?'Target amount':result.type==='roi'?'Current or final value':`Projected value${periodText}`;
  return `<div class="result-shell"><div class="result-kicker">YOUR PLAN <span>ESTIMATE</span></div><div class="panel-heading"><div><h2>Your projection</h2><p>${escapeHtml(result.calculatorName||'Calculation')} · ${escapeHtml(result.currency)}</p></div></div>
    <div class="result-total"><small>${escapeHtml(totalLabel)}</small><strong>${fmt(result.totalValue,result.currency)}</strong></div>
    <div class="result-metrics">${entries.map(([label,value])=>`<div class="metric"><small>${escapeHtml(label)}</small><strong>${typeof value==='string'?escapeHtml(value):fmt(value,result.currency)}</strong></div>`).join('')}</div>
    <div class="result-charts"><section class="chart-panel"><div class="chart-heading"><div><h3>Investment composition</h3><p>How the projected value is made up</p></div><span class="chart-badge">Pie chart</span></div>${renderDonutBreakdown(result)}</section><section class="chart-panel"><div class="chart-heading"><div><h3>Value comparison</h3><p>Invested amount and projected value</p></div><span class="chart-badge">Bar chart</span></div>${renderValueComparison(result)}</section></div>
    <div class="assumptions"><strong>Assumptions</strong><ul>${(result.assumptions||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>
    <p class="result-disclaimer">${escapeHtml(result.disclaimer||'Estimate only. Actual outcomes can differ.')}</p>
    <div class="result-actions">${state.user?(savedId?`<a class="button button-result-secondary button-small" href="#history">Saved to history</a><button class="button button-result-secondary button-small" data-action="report" data-format="pdf" data-id="${savedId}">Download PDF</button><button class="button button-result-secondary button-small" data-action="report" data-format="xlsx" data-id="${savedId}">Download Excel</button>`:'<button class="button button-result-primary button-small" data-action="save">Save this result</button>'):'<button class="button button-result-primary button-small" data-action="auth" data-mode="login">Sign in to save</button>'}</div></div>`;
}
function homePage(){
  if(state.user)return dashboardPage();
  const cards=state.calculators.map(calcCard).join('');
  return `<section class="hero"><div><span class="eyebrow">A clearer way to plan</span><h1>Invest with <em>clarity.</em></h1><p class="hero-copy">Plan better. Calculate smarter. Understand your returns.</p><div class="hero-buttons"><a href="#calculators" class="button button-primary">Explore calculators <span aria-hidden="true">↗</span></a><button class="button button-secondary" data-action="auth" data-mode="register">Create your free account</button></div><p class="hero-note">Thoughtful tools for your next financial decision.</p></div><div class="hero-visual" aria-hidden="true"><div class="hero-orbit"></div><div class="hero-card"><div class="hero-card-head"><span><i class="status-dot"></i>Plan with your assumptions</span><span>↗</span></div><div class="hero-card-skeleton"><div class="skeleton-line"></div><div class="skeleton-title"></div><div class="skeleton-chart"><i></i><i></i><i></i><i></i><i></i></div><div class="hero-card-foot"><span>Investment scenarios</span><strong>Clear. Considered.</strong></div></div></div><div class="floating-note"><strong>7 focused tools</strong>One decision at a time</div></div></section>
  <div class="trust-strip"><span><i class="trust-icon">✓</i>Transparent assumptions</span><span><i class="trust-icon">↗</i>Compare scenarios</span><span><i class="trust-icon">⌁</i>Your private history</span><span><i class="trust-icon">◌</i>No fabricated rates</span></div>
  <section class="section wrap"><div class="section-head"><div><span class="eyebrow">Find the right starting point</span><h2>Tools for every stage</h2><p>From your first contribution to your next milestone.</p></div><a class="text-button" href="#calculators">View all tools ↗</a></div><div class="calculator-grid">${cards}</div><div class="insight-band"><div><span class="eyebrow">Designed around your decisions</span><h3>See the assumptions behind every number.</h3><p>Investly keeps the method visible, so you can explore a scenario with context and decide what to consider next.</p></div><div class="insight-points"><div class="insight-point"><span class="insight-check">✓</span>Use your own inputs and return assumptions</div><div class="insight-point"><span class="insight-check">✓</span>Save projections for a clearer comparison</div><div class="insight-point"><span class="insight-check">✓</span>Export reports you can revisit</div></div></div></section>`;
}
function dashboardPage(){
  return `<div class="wrap dashboard-wrap"><section class="dashboard-stats" aria-label="Investment summary"><article class="dashboard-stat"><span class="dashboard-stat-icon">${icon('history')}</span><div><strong id="dashboard-stat-count">—</strong><span>Saved calculations</span></div></article><article class="dashboard-stat"><span class="dashboard-stat-icon">${icon('lump-sum')}</span><div><strong id="dashboard-stat-total">—</strong><span>Latest projected value</span></div></article><article class="dashboard-stat"><span class="dashboard-stat-icon">${icon('sip')}</span><div><strong id="dashboard-stat-gain">—</strong><span>Latest estimated gain</span></div></article></section>
    <section class="dashboard-overview-grid" aria-label="Investment overview">
      <article class="panel dashboard-projection-panel"><div class="panel-heading"><div><h2 id="dashboard-growth-title">Projection over time</h2><p id="dashboard-growth-note">Save a calculation to see its estimated value trend.</p></div><span class="chart-badge projection-chart-badge">Line chart</span></div><div id="dashboard-growth-chart"><div class="dashboard-empty"><strong>No calculation saved yet</strong><span>Run a calculator and save the result to build your overview.</span><a class="button button-secondary button-small" href="#calculators">Browse calculators</a></div></div></article>
      <article class="panel dashboard-pie-panel"><div class="panel-heading"><div><h2>Investment breakdown</h2><p id="dashboard-breakdown-note">Your latest result, by component.</p></div></div><div id="dashboard-breakdown"><div class="dashboard-empty compact"><span>Save a projection to see its pie graph here.</span></div></div></article>
    </section>
    <section class="panel dashboard-tools-panel"><div class="panel-heading"><div><h2>Start with a tool</h2><p>Choose a calculator or open one of your planning tools.</p></div><a class="dashboard-panel-link" href="#calculators">All calculators&nbsp; →</a></div><div class="dashboard-quick">${state.calculators.map(c=>`<a class="quick-link" href="#calculator/${encodeURIComponent(c.type)}">${icon(c.type)}<span><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.category)}</small></span></a>`).join('')}<a class="quick-link" href="#currency">${icon('currency')}<span><strong>Currency converter</strong><small>Sourced exchange rates</small></span></a></div><div class="dashboard-actions"><a class="button button-secondary button-small" href="#compare">Compare plans</a><a class="button button-secondary button-small" href="#history">View calculation history</a></div></section>
    <section class="panel dashboard-history-panel"><div class="panel-heading"><div><h2>Recent calculations</h2><p>Your last saved plans.</p></div><a class="dashboard-panel-link" href="#history">View history&nbsp; →</a></div><div id="dashboard-recent"><div class="empty-state"><strong>No saved calculations yet</strong>Save a result from any calculator to see it here.</div></div></section>
  </div>`;
}
function calculatorsPage(){return `<div class="wrap"><div class="page-top"><span class="eyebrow">The calculator collection</span><h1>Choose your next question.</h1><p>Each tool focuses on one part of your plan and explains the assumptions behind its projection.</p></div><p class="search-status" id="calculator-search-status" aria-live="polite"></p><div class="calculator-grid section">${state.calculators.map(calcCard).join('')}</div><div class="insight-band"><div><span class="eyebrow">One currency at a time</span><h3>Understand local values. Convert with sourced rates.</h3><p>Currency conversion is available when an administrator has entered a current, sourced exchange rate.</p></div><div class="insight-points"><a class="insight-point" href="#currency"><span class="insight-check">↗</span>Open the currency converter</a><span class="insight-point"><span class="insight-check">✓</span>No exchange rate is guessed or invented</span></div></div></div>`;}
function calculatorPage(type){
  const calc=state.calculators.find(c=>c.type===type);if(!calc)return `<div class="wrap"><div class="page-top"><h1>Calculator unavailable</h1><a href="#calculators" class="button button-secondary">Browse calculators</a></div></div>`;
  state.currency=state.user?.preferredCurrency||state.currency||'INR';
  const currentInputs=state.lastType===type?state.lastInputs||{}:{};
  return `<div class="wrap calculator-wrap"><div class="page-top"><div class="breadcrumb"><a href="#calculators">Calculators</a> / ${escapeHtml(calc.name)}</div><span class="eyebrow">${escapeHtml(calc.category)}</span><h1>${escapeHtml(calc.name)} calculator</h1><p>${escapeHtml(calc.description)}</p></div><div class="calculator-layout"><section class="panel calculator-input-panel"><div class="panel-heading"><span class="eyebrow">YOUR PLAN</span><h2>Set your assumptions</h2><p>Enter values in ${state.currency}. Projections are estimates.</p></div><form id="calculator-form" data-type="${escapeHtml(type)}"><div class="form-grid">${calc.fields.map(name=>renderField(name,{...currentInputs,compoundingFrequency:currentInputs.compoundingFrequency??12})).join('')}</div><div class="currency-row"><label for="calc-currency">Display currency</label><select id="calc-currency" name="currency">${currencyOptions(state.lastResult?.currency||state.currency)}</select></div><p class="error-message hide" id="calc-error"></p><div class="form-actions"><button class="button button-primary" type="submit">Calculate estimate <span aria-hidden="true">→</span></button><button class="button button-secondary" type="reset">Reset</button></div><p class="privacy-note">Your assumptions are used for this estimate. Save it to keep it in your history.</p></form></section><section class="panel result-panel" id="result-panel">${state.lastType===type&&state.lastResult?renderResult(state.lastResult):'<div class="result-empty"><div><div class="result-empty-icon">↗</div><strong>Your results will appear here</strong><span>Enter your assumptions and calculate a projection.</span></div></div>'}</section></div><div class="section"><div class="insight-band"><div><span class="eyebrow">A note on projections</span><h3>Use the result as a planning input.</h3><p>Real outcomes can vary due to market performance, fees, taxes, contribution timing, and other factors not included in this estimate.</p></div><div class="insight-points"><span class="insight-point"><span class="insight-check">✓</span>Formula version 1.0.0</span><span class="insight-point"><span class="insight-check">✓</span>Amounts rounded to two decimals</span></div></div></div></div>`;
}
function historyPage(){return `<div class="wrap"><div class="page-top"><span class="eyebrow">Your saved work</span><h1>Calculation history</h1><p>Open a saved snapshot, revisit its assumptions, or download a report.</p></div><section class="panel"><div class="panel-heading"><h2>Saved calculations</h2><p>Only you can view and manage your history.</p></div><div id="history-list"><div class="empty-state">Loading your history…</div></div></section></div>`;}
function profilePage(){return `<div class="wrap narrow"><div class="page-top"><span class="eyebrow">Your account</span><h1>Profile & preferences</h1><p>Update your display name and preferred currency. Calculations keep the currency used when they were saved.</p></div><section class="panel"><form id="profile-form"><div class="form-grid"><div class="field"><label for="profile-name">Display name</label><input id="profile-name" name="name" required minlength="2" maxlength="80" value="${escapeHtml(state.user.name)}"></div><div class="field"><label for="profile-email">Email address</label><input id="profile-email" value="${escapeHtml(state.user.email)}" disabled><small>Email is used to sign in.</small></div><div class="field"><label for="profile-currency">Preferred currency</label><select id="profile-currency" name="preferredCurrency">${currencyOptions(state.user.preferredCurrency)}</select></div></div><p class="error-message hide" id="profile-error"></p><div class="form-actions"><button class="button button-primary" type="submit">Save changes</button></div></form></section></div>`;}
function comparePage(){
  return `<div class="wrap"><div class="page-top"><span class="eyebrow">Compare scenarios</span><h1>Put plans side by side.</h1><p>Compare up to five plans using their own calculator assumptions. The best option is identified by the highest projected total value.</p></div><form id="compare-form"><div class="compare-plans" id="compare-plans">${state.compareTypes.map((type,i)=>compareCard(type,i)).join('')}</div><div class="form-actions"><button class="button button-secondary" type="button" data-action="add-plan" ${state.compareTypes.length>=5?'disabled':''}>＋ Add a plan</button><button class="button button-primary" type="submit">Compare projections →</button></div></form><div id="compare-results"></div><p class="result-disclaimer">Highest projected value is a mathematical comparison, not investment advice. Confirm that time horizons and cash flows are comparable.</p></div>`;
}
function compareCard(type,index){const calc=state.calculators.find(c=>c.type===type)||state.calculators[0];const saved=state.compareValues?.[index]||{};const values={annualRate:8,years:10,compoundingFrequency:12,...saved.inputs};return `<section class="compare-plan"><div class="compare-plan-head"><strong>Plan ${index+1}</strong>${index>1?`<button class="text-button" type="button" data-action="remove-plan" data-index="${index}">Remove</button>`:''}</div><div class="field"><label for="plan-${index}-type">Calculator type</label><select id="plan-${index}-type" name="type" data-plan-type="${index}">${state.calculators.map(c=>`<option value="${c.type}" ${c.type===calc.type?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select></div><div class="field compare-name-field"><label for="plan-${index}-name">Plan name</label><input id="plan-${index}-name" name="planName" maxlength="60" value="${escapeHtml(saved.name||'')}" placeholder="e.g. Monthly plan"></div><div class="form-grid compare-values">${calc.fields.map(f=>renderField(f,values,`plan-${index}-`)).join('')}</div></section>`;}
function currencyPage(){return `<div class="wrap narrow"><div class="page-top"><span class="eyebrow">Currency tools</span><h1>Convert with context.</h1><p>Use an administrator-managed rate when available; otherwise Investly requests a published reference rate and shows its source and date.</p></div><div class="currency-layout"><section class="panel"><div class="panel-heading"><h2>Currency converter</h2><p>Results include the rate source and effective date.</p></div><form id="currency-form"><div class="form-grid"><div class="field full"><label for="convert-amount">Amount</label><input id="convert-amount" name="amount" type="number" min="0" max="1000000000000" step=".01" value="100" required></div><div class="field"><label for="convert-from">From</label><select id="convert-from" name="from">${currencyOptions()}</select></div><div class="field"><label for="convert-to">To</label><select id="convert-to" name="to">${currencyOptions('USD')}</select></div></div><p class="error-message hide" id="currency-error"></p><div class="form-actions"><button class="button button-primary" type="submit">Convert amount →</button></div></form><div id="conversion-result"></div></section><section class="panel"><div class="panel-heading"><h2>How rates are handled</h2><p>Clear sourcing, no guessed values.</p></div><div class="insight-points"><span class="insight-point"><span class="insight-check">✓</span>Configured admin rates take priority</span><span class="insight-point"><span class="insight-check">✓</span>Published rates show their effective date</span><span class="insight-point"><span class="insight-check">✓</span>Unavailable quotes show a clear message</span></div><div class="assumptions"><strong>Reference rates</strong><p class="modal-copy">Frankfurter publishes reference rates collected from central banks and official sources. These are not live market quotes.</p></div></section></div></div>`;}
function aboutPage(){return `<div class="wrap"><div class="page-top"><span class="eyebrow">About Investly</span><h1>Clarity starts with the method.</h1><p>Investly is a planning tool for exploring financial scenarios with visible assumptions and user-owned history.</p></div><div class="about-grid"><article class="about-card"><h3>Purposeful calculations</h3><p>Each calculator answers one question, using a documented formula and a consistent two-decimal display convention.</p></article><article class="about-card"><h3>Private by design</h3><p>Saved calculations belong to the account that created them. Server-side session checks protect history, reports, and admin actions.</p></article><article class="about-card"><h3>Transparent estimates</h3><p>Projections do not account for taxes, fees, market volatility, or other real-world factors unless stated in the assumptions.</p></article><article class="about-card"><h3>Currency conversion</h3><p>Investly uses an administrator-managed rate when available, then falls back to sourced published reference rates with an effective date.</p></article></div></div>`;}

function adminPage(){
  const tabs=[['users','Users'],['modules','Calculator modules'],['rates','Exchange rates'],['reports','Reports'],['activity','Activity']];
  return `<div class="wrap"><div class="page-top"><span class="eyebrow">Administration</span><h1>System management</h1><p>Manage access, calculator availability, sourced exchange rates, reports, and activity.</p></div><div class="admin-tabs" role="tablist">${tabs.map(([id,label])=>`<button type="button" role="tab" aria-selected="${state.adminTab===id}" class="${state.adminTab===id?'active':''}" data-action="admin-tab" data-tab="${id}">${label}</button>`).join('')}</div><div id="admin-content"><div class="empty-state">Loading administration data…</div></div></div>`;
}

function authContent(mode='login'){
  const register=mode==='register';
  return `<div class="auth-box"><span class="eyebrow">${register?'Start planning':'Welcome back'}</span><h2 id="auth-title">${register?'Create your account':'Sign in to Investly'}</h2><p class="modal-copy">${register?'Save your scenarios and keep your planning in one place.':'Continue to your private planning space.'}</p><form id="auth-form" data-mode="${register?'register':'login'}">${register?'<div class="field"><label for="auth-name">Name</label><input id="auth-name" name="name" required minlength="2" maxlength="80" autocomplete="name"></div>':''}<div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" required maxlength="254" autocomplete="email"></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" required minlength="10" maxlength="200" autocomplete="${register?'new-password':'current-password'}"><small>${register?'Use at least 10 characters.':'Your password is never shown or logged.'}</small></div><p class="error-message hide" id="auth-error"></p><button class="button button-primary" type="submit">${register?'Create account':'Sign in'} →</button></form><p class="auth-toggle">${register?'Already have an account?':'New to Investly?'} <button type="button" class="text-button" data-action="auth-toggle" data-mode="${register?'login':'register'}">${register?'Sign in':'Create an account'}</button></p></div>`;
}
function showAuth(mode='login'){$('#auth-content').innerHTML=authContent(mode);const dialog=$('#auth-dialog');if(!dialog.open)dialog.showModal();setTimeout(()=>$('#auth-email')?.focus(),0);}
function showError(id,message){const node=$(`#${id}`);if(node){node.textContent=message;node.classList.remove('hide');}}

async function loadHistory(){
  try{
    const {calculations}=await request('/api/history');
    const list=$('#history-list');if(!list)return;
    if(!calculations.length){list.innerHTML='<div class="empty-state"><strong>No saved calculations yet</strong>Save a result from any calculator and it will appear here.</div>';return;}
    list.innerHTML=`<div class="history-list">${calculations.map(item=>`<article class="history-row"><div class="history-main">${icon(item.calculatorType)}<div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.calculatorName)} · ${dateLabel(item.createdAt)} · ${escapeHtml(item.currency)}</small></div></div><div class="history-value"><strong>${fmt(item.outputs.totalValue,item.currency)}</strong><small>Projected total</small></div><div class="history-actions"><button class="button button-secondary button-small" data-action="open-history" data-id="${item.id}">Open</button><button class="button button-secondary button-small" data-action="report" data-id="${item.id}" data-format="pdf">PDF</button><button class="button button-secondary button-small" data-action="report" data-id="${item.id}" data-format="xlsx">Excel</button><button class="button button-danger button-small" data-action="delete-history" data-id="${item.id}">Delete</button></div></article>`).join('')}</div>`;
  }catch(e){const list=$('#history-list');if(list)list.innerHTML=`<p class="error-message">${escapeHtml(e.message)}</p>`;}
}
async function loadDashboardHistory(){
  try{
    const {calculations}=await request('/api/history');
    const recent=$('#dashboard-recent'),growth=$('#dashboard-growth-chart'),breakdown=$('#dashboard-breakdown');
    if(!recent||!growth||!breakdown)return;
    const countStat=$('#dashboard-stat-count'),totalStat=$('#dashboard-stat-total'),gainStat=$('#dashboard-stat-gain');
    if(countStat)countStat.textContent=String(calculations.length);
    if(!calculations.length){if(totalStat)totalStat.textContent='—';if(gainStat)gainStat.textContent='—';recent.innerHTML='<div class="empty-state"><strong>No saved calculations yet</strong>Save a result from any calculator to see it here.</div>';return;}
    const latest=calculations[0],out=latest.outputs||{},currency=latest.currency||out.currency||state.currency;
    if(totalStat)totalStat.textContent=fmt(out.totalValue,currency);
    if(gainStat)gainStat.textContent=fmt(out.estimatedReturns??out.metrics?.estimatedReturns??out.metrics?.estimatedGrowth??out.metrics?.gainOrLoss,currency);
    const growthTitle=$('#dashboard-growth-title'),growthNote=$('#dashboard-growth-note'),breakdownNote=$('#dashboard-breakdown-note');
    if(growthTitle)growthTitle.textContent=({roi:'Value comparison',inflation:'Estimated cost over time',goal:'Progress to your target'})[out.type]||'Projection over time';
    if(growthNote)growthNote.textContent=`${latest.name||latest.calculatorName||'Calculation'} · ${dateLabel(latest.createdAt)}`;
    if(breakdownNote)breakdownNote.textContent=`${latest.calculatorName||'Calculation'} · ${dateLabel(latest.createdAt)}`;
    growth.innerHTML=renderProjectionLine(out,latest.inputs||out.inputs||{},currency);
    breakdown.innerHTML=renderDonutBreakdown(out,true);
    recent.innerHTML=`<div class="dashboard-plan-grid">${calculations.slice(0,4).map(item=>{const savedOutput=item.outputs||{};return `<article class="dashboard-plan-card"><div class="plan-card-top"><span class="plan-card-icon">${icon(item.calculatorType)}</span><span class="plan-date">${dateLabel(item.createdAt)}</span></div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.calculatorName||item.calculatorType)} · ${escapeHtml(item.currency)}</p><div class="plan-total"><small>Projected value</small><strong>${fmt(savedOutput.totalValue,item.currency)}</strong></div><div class="plan-metrics"><span>Invested<strong>${fmt(savedOutput.principal??savedOutput.metrics?.investedAmount,item.currency)}</strong></span><span>Est. gain<strong>${fmt(savedOutput.estimatedReturns??savedOutput.metrics?.estimatedReturns??savedOutput.metrics?.estimatedGrowth??savedOutput.metrics?.gainOrLoss,item.currency)}</strong></span></div><div class="plan-actions"><button class="button button-secondary button-small" data-action="open-history" data-id="${item.id}">Open plan</button><button class="button button-secondary button-small" data-action="report" data-id="${item.id}" data-format="pdf">PDF</button></div></article>`;}).join('')}</div>`;
  }catch(e){const recent=$('#dashboard-recent');if(recent)recent.innerHTML=`<p class="error-message">${escapeHtml(e.message)}</p>`;}
}

function adminUsers(users){
  return `<div class="admin-section-title"><div><h2>Accounts</h2><p class="modal-copy">Disable or change roles with server-side protections.</p></div><span class="pill">${users.length} accounts</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${users.map(u=>`<tr data-user-row="${u.id}"><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td><select name="role"><option value="user" ${u.role==='user'?'selected':''}>User</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select></td><td><label><input type="checkbox" name="disabled" ${u.disabled?'checked':''}> Disabled</label></td><td>${dateLabel(u.created_at)}</td><td><button class="button button-secondary button-small" data-action="save-user" data-id="${u.id}">Save</button> <button class="button button-danger button-small" data-action="delete-user" data-id="${u.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
}
function adminModules(modules){return `<div class="admin-section-title"><div><h2>Calculator modules</h2><p class="modal-copy">Control names, visibility, and descriptions for the supported calculation engines.</p></div><span class="pill">${modules.filter(m=>m.enabled).length} active</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Module</th><th>Display name</th><th>Category</th><th>Description</th><th>Status</th><th></th></tr></thead><tbody>${modules.map(m=>`<tr data-module-row="${escapeHtml(m.type)}"><td><small>${escapeHtml(m.type)}</small></td><td><input name="name" value="${escapeHtml(m.name)}" maxlength="80"></td><td><input name="category" value="${escapeHtml(m.category)}" maxlength="80"></td><td><input name="description" value="${escapeHtml(m.description)}" maxlength="240" class="module-description-input"></td><td><label><input name="enabled" type="checkbox" ${m.enabled?'checked':''}> Enabled</label></td><td><button class="button button-secondary button-small" data-action="save-module" data-type="${escapeHtml(m.type)}">Save</button> <button class="button button-danger button-small" data-action="disable-module" data-type="${escapeHtml(m.type)}">Disable</button></td></tr>`).join('')}</tbody></table></div>`;}
function adminRates(rates){
  const editing=state.editRate?rates.find(r=>r.id===state.editRate):null;
  const nowValue=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  return `<div class="admin-section-title"><div><h2>${editing?'Update exchange rate':'Add an exchange rate'}</h2><p class="modal-copy">A source and effective date are required. Expired or future rates are ignored.</p></div></div><form id="admin-rate-form" data-edit-id="${editing?.id||''}"><div class="admin-rate-form"><div class="field"><label for="rate-base">From currency</label><select id="rate-base" name="baseCurrency">${currencyOptions(editing?.base_currency||'USD')}</select></div><div class="field"><label for="rate-quote">To currency</label><select id="rate-quote" name="quoteCurrency">${currencyOptions(editing?.quote_currency||'INR')}</select></div><div class="field"><label for="rate-value">Rate</label><input id="rate-value" name="rate" type="number" min="0.00000001" step="any" value="${editing?.rate||''}" required></div><div class="field"><label for="rate-source">Source</label><input id="rate-source" name="source" maxlength="120" value="${escapeHtml(editing?.source||'')}" placeholder="e.g. Treasury published rate" required></div><div class="field"><label for="rate-effective">Effective date & time (local)</label><input id="rate-effective" name="effectiveAt" type="datetime-local" value="${editing?localDateInput(editing.effective_at):nowValue}" required></div><div class="field"><label for="rate-expiry">Valid until (optional, local)</label><input id="rate-expiry" name="validUntil" type="datetime-local" value="${editing?.valid_until?localDateInput(editing.valid_until):''}"></div></div><div class="form-actions"><button class="button button-primary" type="submit">${editing?'Save rate':'Add rate'}</button>${editing?'<button class="button button-secondary" type="button" data-action="cancel-rate-edit">Cancel</button>':''}</div><p id="rate-error" class="error-message hide"></p></form><div class="admin-section-title rate-list-head"><h2>Configured rates</h2><span class="pill">${rates.length} records</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Pair</th><th>Rate</th><th>Source</th><th>Effective</th><th>Valid until</th><th></th></tr></thead><tbody>${rates.length?rates.map(r=>`<tr><td>${escapeHtml(r.base_currency)} → ${escapeHtml(r.quote_currency)}</td><td>${r.rate}</td><td>${escapeHtml(r.source)}</td><td>${dateTimeLabel(r.effective_at)}</td><td>${r.valid_until?dateTimeLabel(r.valid_until):'No expiry'}</td><td><button class="button button-secondary button-small" data-action="edit-rate" data-id="${r.id}">Edit</button> <button class="button button-danger button-small" data-action="delete-rate" data-id="${r.id}">Delete</button></td></tr>`).join(''):'<tr><td colspan="6">No exchange rates have been configured.</td></tr>'}</tbody></table></div>`;
}
function adminReports(reports){return `<div class="admin-section-title"><div><h2>Generated reports</h2><p class="modal-copy">Reports are tied to the calculation snapshot and owner account.</p></div><span class="pill">${reports.length} reports</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Owner</th><th>Calculation</th><th>Format</th><th>Date</th><th></th></tr></thead><tbody>${reports.length?reports.map(r=>`<tr><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.calculation_name)}</td><td>${escapeHtml(r.format.toUpperCase())}</td><td>${dateLabel(r.created_at)}</td><td><a class="button button-secondary button-small" href="/api/reports/${r.id}/download">Download</a></td></tr>`).join(''):'<tr><td colspan="5">No reports generated.</td></tr>'}</tbody></table></div>`;}
function adminActivity(rows){return `<div class="admin-section-title"><div><h2>Recent system activity</h2><p class="modal-copy">Passwords and session tokens are never included in activity records.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Action</th><th>Account</th><th>Details</th><th>Time</th></tr></thead><tbody>${rows.length?rows.map(a=>`<tr><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.email||'System')}</td><td>${escapeHtml(JSON.stringify(a.details))}</td><td>${dateLabel(a.created_at)}</td></tr>`).join(''):'<tr><td colspan="4">No activity recorded.</td></tr>'}</tbody></table></div>`;}

async function loadAdmin(){
  const target=$('#admin-content');if(!target)return;
  try{
    const path={users:'/api/admin/users',modules:'/api/admin/modules',rates:'/api/admin/rates',reports:'/api/admin/reports',activity:'/api/admin/activity'}[state.adminTab];
    const payload=await request(path);state.adminData=payload;
    target.innerHTML={users:()=>adminUsers(payload.users),modules:()=>adminModules(payload.modules),rates:()=>adminRates(payload.rates),reports:()=>adminReports(payload.reports),activity:()=>adminActivity(payload.activity)}[state.adminTab]();
  }catch(e){target.innerHTML=`<p class="error-message">${escapeHtml(e.message)}</p>`;}
}

async function render(){
  renderHeader();const {page,args}=activeRoute();const view=$('#view');
  if(page==='history'&&!state.user){showAuth('login');location.hash='#home';return;}
  if(page==='profile'&&!state.user){showAuth('login');location.hash='#home';return;}
  if((page==='compare'||page==='currency')&&!state.user){showAuth('login');location.hash='#home';return;}
  if(page==='admin'&&state.user?.role!=='admin'){location.hash=state.user?'home':'home';toast('Admin access is required.',true);return;}
  state.mobile=false;renderHeader();
  switch(page){
    case 'home':view.innerHTML=homePage();if(state.user)loadDashboardHistory();break;
    case 'calculators':view.innerHTML=calculatorsPage();applyCalculatorSearch();break;
    case 'calculator':view.innerHTML=calculatorPage(args[0]);break;
    case 'history':view.innerHTML=historyPage();loadHistory();break;
    case 'compare':view.innerHTML=comparePage();break;
    case 'currency':view.innerHTML=currencyPage();break;
    case 'profile':view.innerHTML=profilePage();break;
    case 'about':view.innerHTML=aboutPage();break;
    case 'admin':view.innerHTML=adminPage();loadAdmin();break;
    default:view.innerHTML=homePage();
  }
  $('#year').textContent=new Date().getFullYear();
}

function formValues(form){return Object.fromEntries(new FormData(form).entries());}
function numericInputs(form){const values=formValues(form);return Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v===''?v:(Number.isFinite(Number(v))?Number(v):v)]));}
function collectCompareValues(){return $$('.compare-plan').map((card,index)=>({type:$('[data-plan-type]',card).value,name:$('[name=planName]',card).value,inputs:Object.fromEntries($$('.form-grid input,.form-grid select',card).map(el=>[el.name,el.value===''?el.value:Number(el.value)]))}));}
function renderCompareResult(payload){
  state.compareResult=payload;
  $('#compare-results').innerHTML=`<section class="panel compare-results"><div class="panel-heading"><h2>Comparison result</h2><p>Metric: ${escapeHtml(payload.metric)}</p></div><div class="compare-winner"><strong>${escapeHtml(payload.bestPlan)}</strong> has the highest projected total value under the assumptions entered.</div><div class="compare-results-grid">${payload.plans.map(plan=>`<article class="compare-result ${plan.name===payload.bestPlan?'best':''}"><strong>${escapeHtml(plan.name)} · ${escapeHtml(plan.result.calculatorName)}</strong><b>${fmt(plan.result.totalValue,plan.result.currency)}</b><small>Invested ${fmt(plan.result.principal,plan.result.currency)} · estimated returns ${fmt(plan.result.estimatedReturns,plan.result.currency)}</small></article>`).join('')}</div><ul class="assumptions">${payload.assumptions.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></section>`;
}

async function submitAuth(form){
  const mode=form.dataset.mode,values=formValues(form);
  try{
    const data=await post(`/api/${mode}`,values);state.user=data.user;state.currency=state.user.preferredCurrency;$('#auth-dialog').close();toast(mode==='register'?'Your account is ready.':'You are signed in.');await render();
  }catch(error){showError('auth-error',error.message);}
}
async function handleAction(button){
  const action=button.dataset.action;
  if(action==='auth'){showAuth(button.dataset.mode||'login');return;}
  if(action==='auth-toggle'){showAuth(button.dataset.mode);return;}
  if(action==='logout'){
    try{await post('/api/logout',{});}catch{}
    state.user=null;state.lastResult=null;state.savedId=null;state.lastInputs=null;location.hash='#home';toast('You are signed out.');await render();return;
  }
  if(action==='save'){
    if(!state.user){showAuth('login');return;}
    if(!state.lastType||!state.lastInputs)return;
    try{const data=await post('/api/history',{type:state.lastType,inputs:state.lastInputs,currency:state.lastResult.currency});state.savedId=data.calculation.id;toast('Calculation saved to your history.');await render();}
    catch(e){toast(e.message,true);}return;
  }
  if(action==='report'){
    const id=Number(button.dataset.id),format=button.dataset.format;
    try{const data=await post(`/api/history/${id}/report`,{format,includeGraph:true});const link=document.createElement('a');link.href=data.report.downloadUrl;link.download=data.report.filename;document.body.append(link);link.click();link.remove();toast(`${format.toUpperCase()} report generated.`);}
    catch(e){if(e.status===401)showAuth('login');else toast(e.message,true);}return;
  }
  if(action==='open-history'){
    try{const {calculation}=await request(`/api/history/${button.dataset.id}`);state.lastType=calculation.calculatorType;state.lastInputs=calculation.inputs;state.lastResult=calculation.outputs;state.savedId=calculation.id;state.currency=calculation.currency;location.hash=`#calculator/${encodeURIComponent(calculation.calculatorType)}`;}
    catch(e){toast(e.message,true);}return;
  }
  if(action==='delete-history'){
    try{await request(`/api/history/${button.dataset.id}`,{method:'DELETE'});toast('Saved calculation deleted.');await loadHistory();}
    catch(e){toast(e.message,true);}return;
  }
  if(action==='add-plan'){
    if(state.compareTypes.length>=5)return;
    state.compareValues=collectCompareValues();state.compareTypes.push('sip');await render();return;
  }
  if(action==='remove-plan'){
    const index=Number(button.dataset.index);state.compareValues=collectCompareValues();state.compareTypes.splice(index,1);state.compareValues.splice(index,1);await render();return;
  }
  if(action==='admin-tab'){state.adminTab=button.dataset.tab;$$('.admin-tabs [role="tab"]').forEach(tab=>{const active=tab.dataset.tab===state.adminTab;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});await loadAdmin();return;}
  if(action==='save-user'){
    const row=$(`[data-user-row="${button.dataset.id}"]`);try{await patch(`/api/admin/users/${button.dataset.id}`,{role:$('[name=role]',row).value,disabled:$('[name=disabled]',row).checked});toast('Account updated.');await loadAdmin();}catch(e){toast(e.message,true);}return;
  }
  if(action==='delete-user'){
    if(!window.confirm('Delete this account and its saved calculations?'))return;
    try{await request(`/api/admin/users/${button.dataset.id}`,{method:'DELETE'});toast('Account deleted.');await loadAdmin();}catch(e){toast(e.message,true);}return;
  }
  if(action==='save-module'){
    const row=$(`[data-module-row="${button.dataset.type}"]`);try{await patch(`/api/admin/modules/${button.dataset.type}`,{name:$('[name=name]',row).value,category:$('[name=category]',row).value,description:$('[name=description]',row).value,enabled:$('[name=enabled]',row).checked});toast('Calculator module updated.');await loadAdmin();}catch(e){toast(e.message,true);}return;
  }
  if(action==='disable-module'){
    try{await request(`/api/admin/modules/${button.dataset.type}`,{method:'DELETE'});toast('Calculator module disabled.');await loadAdmin();}catch(e){toast(e.message,true);}return;
  }
  if(action==='edit-rate'){state.editRate=Number(button.dataset.id);await loadAdmin();return;}
  if(action==='cancel-rate-edit'){state.editRate=null;await loadAdmin();return;}
  if(action==='delete-rate'){
    if(!window.confirm('Delete this exchange rate?'))return;
    try{await request(`/api/admin/rates/${button.dataset.id}`,{method:'DELETE'});toast('Exchange rate deleted.');await loadAdmin();}catch(e){toast(e.message,true);}return;
  }
}

document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');
  if(button){event.preventDefault();await handleAction(button);return;}
  const navLink=event.target.closest('.top-nav a');if(navLink){state.mobile=false;renderHeader();return;}
  if(event.target.closest('#sidebar-backdrop')){state.mobile=false;renderHeader();}
});
$('#mobile-menu').addEventListener('click',()=>{state.mobile=!state.mobile;renderHeader();});
$('#auth-dialog').addEventListener('click',event=>{if(event.target===event.currentTarget)event.currentTarget.close();});
document.addEventListener('click',event=>{if(event.target.closest('[data-close-dialog]'))$('#auth-dialog').close();});
window.addEventListener('hashchange',()=>{state.compareResult=null;render();});

document.addEventListener('submit',async event=>{
  const form=event.target;
  if(form.id==='workspace-search'){
    event.preventDefault();const query=$('#workspace-search-input').value.trim().toLowerCase();if(!query)return;
    const matches=state.calculators.filter(calc=>`${calc.name} ${calc.category} ${calc.type} ${calc.description}`.toLowerCase().includes(query));
    if(matches.length===1){state.searchQuery='';$('#workspace-search-input').value='';location.hash=`#calculator/${encodeURIComponent(matches[0].type)}`;}
    else if(matches.length>1){state.searchQuery=query;if(activeRoute().page==='calculators')applyCalculatorSearch(query);else location.hash='#calculators';}
    else{state.searchQuery='';if(activeRoute().page==='calculators')applyCalculatorSearch('');toast('No calculator matched that search.',true);}
    return;
  }
  if(form.id==='auth-form'){event.preventDefault();await submitAuth(form);return;}
  if(form.id==='calculator-form'){
    event.preventDefault();const type=form.dataset.type,values=numericInputs(form),currency=$('[name=currency]',form).value;
    $('#calc-error').classList.add('hide');
    try{const data=await post('/api/calculate',{type,inputs:values,currency});state.lastType=type;state.lastInputs=Object.fromEntries(state.calculators.find(c=>c.type===type).fields.map(k=>[k,values[k]]));state.lastResult=data.result;state.savedId=null;state.currency=currency;$('#result-panel').innerHTML=renderResult(data.result,null);}
    catch(e){if(e.status===401){showAuth('login');toast('Sign in to calculate and save your plan.',true);}else showError('calc-error',e.message);}return;
  }
  if(form.id==='profile-form'){
    event.preventDefault();$('#profile-error').classList.add('hide');try{const data=await patch('/api/profile',formValues(form));state.user=data.user;state.currency=data.user.preferredCurrency;toast('Profile preferences saved.');await render();}catch(e){showError('profile-error',e.message);}return;
  }
  if(form.id==='compare-form'){
    event.preventDefault();try{const plans=collectCompareValues();const data=await post('/api/compare',{plans,currency:state.user.preferredCurrency});renderCompareResult(data);}catch(e){if(e.status===401)showAuth('login');else toast(e.message,true);}return;
  }
  if(form.id==='currency-form'){
    event.preventDefault();$('#currency-error').classList.add('hide');$('#conversion-result').innerHTML='';try{const values=formValues(form),data=await post('/api/currency/convert',values);$('#conversion-result').innerHTML=`<div class="conversion-result"><small>${fmt(data.amount,data.from)} converted using ${Number(data.rate).toPrecision(7)} ${escapeHtml(data.to)} per ${escapeHtml(data.from)}</small><strong>${fmt(data.converted,data.to)}</strong><small>Source: ${escapeHtml(data.source)}${data.effectiveAt?` · Effective ${dateLabel(data.effectiveAt)}`:''}</small></div>`;}catch(e){showError('currency-error',e.status?e.message:'Investly could not reach the conversion service. Check your connection and retry.');}return;
  }
  if(form.id==='admin-rate-form'){
    event.preventDefault();const values=formValues(form),editId=form.dataset.editId;values.rate=Number(values.rate);if(values.effectiveAt)values.effectiveAt=new Date(values.effectiveAt).toISOString();if(values.validUntil)values.validUntil=new Date(values.validUntil).toISOString();else values.validUntil=null;
    try{if(editId)await patch(`/api/admin/rates/${editId}`,values);else await post('/api/admin/rates',values);state.editRate=null;toast(editId?'Exchange rate updated.':'Exchange rate added.');await loadAdmin();}catch(e){showError('rate-error',e.message);}return;
  }
});
document.addEventListener('change',event=>{
  const select=event.target.closest('[data-plan-type]');if(!select)return;
  const index=Number(select.dataset.planType),values=collectCompareValues();values[index].type=select.value;state.compareValues=values;state.compareTypes=values.map(x=>x.type);render().then(()=>{});
});
document.addEventListener('reset',event=>{if(event.target.id==='calculator-form'){setTimeout(()=>{state.lastResult=null;state.lastType=null;state.lastInputs=null;state.savedId=null;const result=$('#result-panel');if(result)result.innerHTML='<div class="result-empty"><div><div class="result-empty-icon">↗</div><strong>Your results will appear here</strong><span>Enter your assumptions and calculate a projection.</span></div></div>';},0);}});

async function init(){
  try{const {calculators}=await request('/api/calculators');state.calculators=calculators;}catch{}
  try{const {user}=await request('/api/session');state.user=user;state.currency=user.preferredCurrency;}catch{}
  if(!state.calculators.length)$('#view').innerHTML='<div class="wrap"><div class="page-top"><h1>Investly could not load.</h1><p>Refresh the page to try again.</p></div></div>';
  else await render();
}
init();
