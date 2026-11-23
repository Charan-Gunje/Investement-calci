import './src/config.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, logActivity, transaction } from './src/db.js';
import { calculatorCatalog, calculate, compare, FORMULA_VERSION } from './src/calculators.js';
import { hashPassword, verifyPassword, createSession, userForToken, destroySession, cookie, clearCookie, parseCookies } from './src/security.js';
import { buildReport } from './src/reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const secureCookie = process.env.COOKIE_SECURE === 'true';
const loginAttempts = new Map();
const reportRequests = new Map();
const liveRateCache = new Map();
const MAX_BODY = 1024 * 1024;
const CURRENCIES = ['INR','USD','EUR','GBP','JPY','CAD','AUD','SGD','AED','CHF'];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (status, message) => { throw new HttpError(status, message); };
const json = (res, status, data, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(data));
};
const userView = row => row ? ({ id: row.id, name: row.name, email: row.email, role: row.role, preferredCurrency: row.preferred_currency, createdAt: row.created_at }) : null;
const safeName = value => String(value ?? '').trim().slice(0, 80);
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim()) && String(value).length <= 254;

async function readBody(req) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > MAX_BODY) bad(413, 'Request is too large.'); chunks.push(chunk); }
  if (!length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { bad(400, 'Request body must be valid JSON.'); }
}

function auth(req, res, role) {
  const token = parseCookies(req.headers.cookie).investly_session;
  const user = userForToken(token);
  if (!user) { json(res, 401, { error: 'Please sign in to continue.' }); return null; }
  if (role === 'admin' && user.role !== 'admin') { json(res, 403, { error: 'Admin access is required.' }); return null; }
  return { ...user, token };
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = req.headers.host;
    return parsed.host === host && (parsed.protocol === 'https:' || parsed.protocol === 'http:');
  } catch { return false; }
}

function activity(user, action, details, req) {
  logActivity(user?.id ?? null, action, details, req.socket.remoteAddress ?? '');
}

function enabledCalculator(type) {
  const row = db.prepare('SELECT enabled FROM calculator_types WHERE type=?').get(type);
  if (!row || !row.enabled || !calculatorCatalog.some(item => item.type === type)) bad(404, 'That calculator is unavailable.');
}

function parseCalculation(row) {
  return { id: row.id, calculatorType: row.calculator_type, name: row.name, currency: row.currency, inputs: JSON.parse(row.inputs_json), outputs: JSON.parse(row.outputs_json), assumptions: JSON.parse(row.assumptions_json), formulaVersion: row.formula_version, createdAt: row.created_at };
}

function validCurrency(code) { return CURRENCIES.includes(String(code).toUpperCase()); }
function isoDate(value,label){const parsed=new Date(value);if(!value||Number.isNaN(parsed.valueOf()))bad(400,`${label} must be a valid date and time.`);return parsed.toISOString();}
function currentRates() {
  const now = new Date().toISOString();
  const rows = db.prepare('SELECT * FROM exchange_rates WHERE effective_at<=? AND (valid_until IS NULL OR valid_until>=?) ORDER BY effective_at DESC,id DESC').all(now, now);
  const pairs = new Map();
  for (const row of rows) {
    const key = `${row.base_currency}:${row.quote_currency}`;
    if (!pairs.has(key)) pairs.set(key, row);
  }
  return pairs;
}

function findRate(from, to) {
  if (from === to) return { rate: 1, description: 'Same currency', effectiveAt: null, source: 'No conversion needed' };
  const pairs = currentRates();
  const get = (a,b) => {
    const direct = pairs.get(`${a}:${b}`);
    if (direct) return { rate: direct.rate, effectiveAt: direct.effective_at, source: direct.source };
    const inverse = pairs.get(`${b}:${a}`);
    if (inverse) return { rate: 1 / inverse.rate, effectiveAt: inverse.effective_at, source: `${inverse.source} (inverse rate)` };
    return null;
  };
  const direct = get(from,to); if (direct) return direct;
  for (const pivot of ['USD','EUR']) {
    if (pivot === from || pivot === to) continue;
    const left = get(from,pivot), right = get(pivot,to);
    if (left && right) return { rate: left.rate * right.rate, effectiveAt: [left.effectiveAt,right.effectiveAt].filter(Boolean).sort()[0], source: `${left.source}; ${right.source} via ${pivot}` };
  }
  return null;
}

async function publishedRate(from, to) {
  if (from === to) return { rate: 1, effectiveAt: null, source: 'No conversion needed' };
  const key = `${from}:${to}`, cached = liveRateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.quote;
  try {
    const response = await fetch(`https://api.frankfurter.dev/v2/rate/${from.toLowerCase()}/${to.toLowerCase()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Rate provider returned ${response.status}.`);
    const data = await response.json();
    const rate = Number(data.rate);
    if (!Number.isFinite(rate) || rate <= 0 || String(data.base).toUpperCase() !== from || String(data.quote).toUpperCase() !== to) throw new Error('Rate provider returned an invalid quote.');
    const quote = { rate, source: 'Frankfurter reference rates', effectiveAt: data.date || null };
    liveRateCache.set(key, { quote, expiresAt: Date.now() + 30 * 60 * 1000 });
    return quote;
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.cause?.code === 'ETIMEDOUT') {
      bad(503, 'The reference rate service timed out. Try again shortly.');
    }
    bad(503, 'The reference rate service is temporarily unavailable. Try again shortly.');
  }
}

async function api(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;
  const body = ['POST','PUT','PATCH','DELETE'].includes(method) ? await readBody(req) : {};
  if (['POST','PUT','PATCH','DELETE'].includes(method) && !sameOrigin(req)) bad(403, 'Request origin could not be verified.');

  if (method === 'GET' && pathname === '/api/session') {
    const found = auth(req, res); if (!found) return;
    return json(res, 200, { user: userView(found) });
  }
  if (method === 'POST' && pathname === '/api/register') {
    const name = safeName(body.name), email = String(body.email ?? '').trim().toLowerCase(), password = String(body.password ?? '');
    if (name.length < 2) bad(400, 'Name must be at least 2 characters.');
    if (!validEmail(email)) bad(400, 'Enter a valid email address.');
    if (password.length < 10 || password.length > 200) bad(400, 'Password must be between 10 and 200 characters.');
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) bad(409, 'An account with that email already exists.');
    const pw = await hashPassword(password);
    const insert = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name,email,pw);
    const session = createSession(Number(insert.lastInsertRowid));
    const created = db.prepare('SELECT id,name,email,role,preferred_currency,created_at FROM users WHERE id=?').get(Number(insert.lastInsertRowid));
    activity(created,'account.registered',{},req);
    return json(res,201,{ user:userView(created) },{ 'Set-Cookie':cookie(session.token,secureCookie) });
  }
  if (method === 'POST' && pathname === '/api/login') {
    const key = `${req.socket.remoteAddress}:${String(body.email ?? '').toLowerCase()}`;
    const attempt = loginAttempts.get(key) ?? { count:0, until:0 };
    if (attempt.until > Date.now()) bad(429,'Too many sign-in attempts. Try again in a few minutes.');
    const row = db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(String(body.email ?? '').trim());
    const good = row && !row.disabled ? await verifyPassword(String(body.password ?? ''),row.password_hash) : false;
    if (!good) {
      attempt.count++; if (attempt.count >= 8) { attempt.count=0; attempt.until=Date.now()+5*60_000; }
      loginAttempts.set(key,attempt); activity(null,'auth.login_failed',{},req);
      bad(401,'Email or password is incorrect.');
    }
    loginAttempts.delete(key);
    const session = createSession(row.id);
    activity(row,'auth.login',{},req);
    return json(res,200,{ user:userView(row) },{ 'Set-Cookie':cookie(session.token,secureCookie) });
  }
  if (method === 'POST' && pathname === '/api/logout') {
    const token = parseCookies(req.headers.cookie).investly_session;
    const user = userForToken(token); destroySession(token);
    if (user) activity(user,'auth.logout',{},req);
    return json(res,200,{ ok:true },{ 'Set-Cookie':clearCookie(secureCookie) });
  }
  if (method === 'GET' && pathname === '/api/calculators') {
    const rows = db.prepare('SELECT type,name,description,category,fields_json AS fields_json FROM calculator_types WHERE enabled=1 ORDER BY rowid').all();
    return json(res,200,{ calculators:rows.map(row=>({...row,fields:JSON.parse(row.fields_json),fields_json:undefined})) });
  }
  if (method === 'GET' && pathname === '/api/currencies') {
    const user = auth(req,res); if (!user) return;
    return json(res,200,{ currencies:CURRENCIES, availablePairs:[...currentRates().values()].map(r=>({from:r.base_currency,to:r.quote_currency,source:r.source,effectiveAt:r.effective_at,validUntil:r.valid_until})), preferredCurrency:user.preferred_currency });
  }
  if (method === 'POST' && pathname === '/api/currency/convert') {
    const user = auth(req,res); if (!user) return;
    const from=String(body.from??'').toUpperCase(), to=String(body.to??'').toUpperCase(), amount=Number(body.amount);
    if (!validCurrency(from)||!validCurrency(to)) bad(400,'Choose supported currencies.');
    if (!Number.isFinite(amount)||amount<0||amount>1e12) bad(400,'Enter an amount between 0 and 1,000,000,000,000.');
    const quote=findRate(from,to) ?? await publishedRate(from,to); if (!quote) bad(404,'No published reference rate is available for this currency pair.');
    const converted=Math.round(amount*quote.rate*100)/100;
    activity(user,'currency.converted',{from,to},req);
    return json(res,200,{from,to,amount,converted,rate:quote.rate,source:quote.source,effectiveAt:quote.effectiveAt});
  }
  if (method === 'PATCH' && pathname === '/api/profile') {
    const user=auth(req,res); if (!user) return;
    const name=safeName(body.name), currency=String(body.preferredCurrency??'').toUpperCase();
    if(name.length<2) bad(400,'Name must be at least 2 characters.');
    if(!validCurrency(currency)) bad(400,'Choose a supported currency.');
    db.prepare('UPDATE users SET name=?,preferred_currency=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name,currency,user.id);
    const updated=db.prepare('SELECT id,name,email,role,preferred_currency,created_at FROM users WHERE id=?').get(user.id);
    activity(user,'account.profile_updated',{currency},req);
    return json(res,200,{user:userView(updated)});
  }
  if (method === 'POST' && pathname === '/api/calculate') {
    const user=auth(req,res); if(!user)return;
    const type=String(body.type??''); enabledCalculator(type);
    const currency=String(body.currency??user.preferred_currency).toUpperCase(); if(!validCurrency(currency)) bad(400,'Choose a supported currency.');
    const result=calculate(type,body.inputs,currency);result.calculatorName=getCatalogRow(type).name;
    activity(user,'calculation.run',{type},req);
    return json(res,200,{result});
  }
  if (method === 'POST' && pathname === '/api/history') {
    const user=auth(req,res); if(!user)return;
    const type=String(body.type??''); enabledCalculator(type);
    const currency=String(body.currency??user.preferred_currency).toUpperCase(); if(!validCurrency(currency)) bad(400,'Choose a supported currency.');
    const output=calculate(type,body.inputs,currency);output.calculatorName=getCatalogRow(type).name;
    const catalog=getCatalogRow(type);
    const name=safeName(body.name)||`${catalog.name} calculation`;
    const item=transaction(()=>{
      const saved=db.prepare(`INSERT INTO calculations(user_id,calculator_type,name,currency,inputs_json,outputs_json,assumptions_json,formula_version)
        VALUES(?,?,?,?,?,?,?,?)`).run(user.id,type,name,currency,JSON.stringify(output.inputs),JSON.stringify(output),JSON.stringify(output.assumptions),FORMULA_VERSION);
      return Number(saved.lastInsertRowid);
    });
    activity(user,'history.saved',{calculationId:item,type},req);
    return json(res,201,{calculation:parseCalculation(db.prepare('SELECT * FROM calculations WHERE id=? AND user_id=?').get(item,user.id))});
  }
  if (method === 'GET' && pathname === '/api/history') {
    const user=auth(req,res); if(!user)return;
    const rows=db.prepare(`SELECT c.*,t.name AS type_name FROM calculations c JOIN calculator_types t ON t.type=c.calculator_type WHERE c.user_id=? ORDER BY c.created_at DESC LIMIT 200`).all(user.id);
    return json(res,200,{calculations:rows.map(row=>({...parseCalculation(row),calculatorName:row.type_name}))});
  }
  let match=pathname.match(/^\/api\/history\/(\d+)$/);
  if(match&&method==='GET'){
    const user=auth(req,res);if(!user)return;
    const row=db.prepare('SELECT * FROM calculations WHERE id=? AND user_id=?').get(Number(match[1]),user.id);
    if(!row)bad(404,'Saved calculation not found.');
    return json(res,200,{calculation:parseCalculation(row)});
  }
  if(match&&method==='DELETE'){
    const user=auth(req,res);if(!user)return;
    const row=db.prepare('SELECT id FROM calculations WHERE id=? AND user_id=?').get(Number(match[1]),user.id);
    if(!row)bad(404,'Saved calculation not found.');
    db.prepare('DELETE FROM calculations WHERE id=? AND user_id=?').run(Number(match[1]),user.id);
    activity(user,'history.deleted',{calculationId:Number(match[1])},req);
    return json(res,200,{ok:true});
  }
  if(method==='POST'&&pathname==='/api/compare'){
    const user=auth(req,res);if(!user)return;
    const currency=String(body.currency??user.preferred_currency).toUpperCase();if(!validCurrency(currency))bad(400,'Choose a supported currency.');
    if(Array.isArray(body.plans))for(const plan of body.plans)enabledCalculator(String(plan.type??''));
    const result=compare(body.plans,currency);
    for(const plan of result.plans)plan.result.calculatorName=getCatalogRow(plan.type).name;
    const id=transaction(()=>{
      const inserted=db.prepare('INSERT INTO comparisons(user_id,metric,best_plan,assumptions_json) VALUES(?,?,?,?)').run(user.id,result.metric,result.bestPlan,JSON.stringify(result.assumptions));
      const comparisonId=Number(inserted.lastInsertRowid);
      const add=db.prepare('INSERT INTO comparison_plans(comparison_id,name,calculator_type,inputs_json,outputs_json) VALUES(?,?,?,?,?)');
      for(const plan of result.plans)add.run(comparisonId,plan.name,plan.type,JSON.stringify(plan.inputs),JSON.stringify(plan.result));
      return comparisonId;
    });
    activity(user,'comparison.created',{comparisonId:id},req);
    return json(res,201,{comparisonId:id,...result});
  }
  if(method==='POST'&&(match=pathname.match(/^\/api\/history\/(\d+)\/report$/))){
    const user=auth(req,res);if(!user)return;
    const recent=reportRequests.get(user.id)??[];const filtered=recent.filter(t=>Date.now()-t<60_000);if(filtered.length>=6)bad(429,'Please wait before generating more reports.');filtered.push(Date.now());reportRequests.set(user.id,filtered);
    const row=db.prepare('SELECT * FROM calculations WHERE id=? AND user_id=?').get(Number(match[1]),user.id);if(!row)bad(404,'Saved calculation not found.');
    const format=String(body.format??'').toLowerCase();const includeGraph=body.includeGraph!==false;
    const calc=parseCalculation(row);const built=buildReport({outputs:calc.outputs,inputs:calc.inputs,name:calc.name,currency:calc.currency,createdAt:calc.createdAt},format,includeGraph);
    const fileName=`investly-${calc.calculatorType}-${calc.id}.${built.extension}`;
    const reportId=transaction(()=>Number(db.prepare('INSERT INTO reports(user_id,calculation_id,format,include_graph,filename,content_type,file_data) VALUES(?,?,?,?,?,?,?)').run(user.id,calc.id,format,includeGraph?1:0,fileName,built.contentType,built.data).lastInsertRowid));
    activity(user,'report.generated',{reportId,format},req);
    return json(res,201,{report:{id:reportId,format,filename:fileName,downloadUrl:`/api/reports/${reportId}/download`}});
  }
  if((match=pathname.match(/^\/api\/reports\/(\d+)\/download$/))&&method==='GET'){
    const user=auth(req,res);if(!user)return;
    const row=user.role==='admin'?db.prepare('SELECT * FROM reports WHERE id=?').get(Number(match[1])):db.prepare('SELECT * FROM reports WHERE id=? AND user_id=?').get(Number(match[1]),user.id);
    if(!row)bad(404,'Report not found.');
    res.writeHead(200,{'Content-Type':row.content_type,'Content-Length':row.file_data.length,'Content-Disposition':`attachment; filename="${row.filename}"`,'Cache-Control':'no-store'});res.end(row.file_data);return;
  }
  if(method==='GET'&&pathname==='/api/history/reports'){
    const user=auth(req,res);if(!user)return;
    const rows=user.role==='admin'?db.prepare('SELECT r.id,r.user_id,r.calculation_id,r.format,r.include_graph,r.filename,r.created_at,u.email FROM reports r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 200').all():db.prepare('SELECT id,calculation_id,format,include_graph,filename,created_at FROM reports WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(user.id);
    return json(res,200,{reports:rows});
  }

  // Admin routes are checked on the server before any management action.
  if(pathname.startsWith('/api/admin/')){
    const admin=auth(req,res,'admin');if(!admin)return;
    if(method==='GET'&&pathname==='/api/admin/users')return json(res,200,{users:db.prepare('SELECT id,name,email,role,preferred_currency,disabled,created_at FROM users ORDER BY created_at DESC LIMIT 500').all()});
    if((match=pathname.match(/^\/api\/admin\/users\/(\d+)$/))&&method==='PATCH'){
      const id=Number(match[1]);const current=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!current)bad(404,'User not found.');
      const role=body.role??current.role,disabled=body.disabled===undefined?current.disabled:(body.disabled?1:0),name=body.name===undefined?current.name:safeName(body.name);
      if(!['user','admin'].includes(role))bad(400,'Choose a valid role.');if(name.length<2)bad(400,'Name must be at least 2 characters.');
      if((current.role==='admin'&&current.disabled===0&&(role!=='admin'||disabled))){const count=db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0").get().n;if(count<=1)bad(409,'The last active administrator cannot be disabled or demoted.');}
      db.prepare('UPDATE users SET name=?,role=?,disabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name,role,disabled,id);activity(admin,'admin.user_updated',{targetUserId:id},req);
      return json(res,200,{user:db.prepare('SELECT id,name,email,role,preferred_currency,disabled,created_at FROM users WHERE id=?').get(id)});
    }
    if((match=pathname.match(/^\/api\/admin\/users\/(\d+)$/))&&method==='DELETE'){
      const id=Number(match[1]);if(id===admin.id)bad(400,'You cannot delete your own account.');const target=db.prepare('SELECT role,disabled FROM users WHERE id=?').get(id);if(!target)bad(404,'User not found.');
      if(target.role==='admin'&&!target.disabled&&db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0").get().n<=1)bad(409,'The last active administrator cannot be deleted.');
      db.prepare('DELETE FROM users WHERE id=?').run(id);activity(admin,'admin.user_deleted',{targetUserId:id},req);return json(res,200,{ok:true});
    }
    if(method==='GET'&&pathname==='/api/admin/modules')return json(res,200,{modules:db.prepare('SELECT * FROM calculator_types ORDER BY rowid').all().map(r=>({...r,fields:JSON.parse(r.fields_json)}))});
    if((match=pathname.match(/^\/api\/admin\/modules\/([a-z-]+)$/))&&(method==='PATCH'||method==='PUT')){
      const type=match[1],existing=db.prepare('SELECT * FROM calculator_types WHERE type=?').get(type);if(!existing)bad(404,'Calculator module not found.');
      const name=safeName(body.name??existing.name),description=String(body.description??existing.description).trim().slice(0,240),category=safeName(body.category??existing.category),enabled=body.enabled===undefined?existing.enabled:(body.enabled?1:0);
      if(name.length<2||!description||category.length<2)bad(400,'Provide a module name, description, and category.');
      db.prepare('UPDATE calculator_types SET name=?,description=?,category=?,enabled=?,updated_at=CURRENT_TIMESTAMP WHERE type=?').run(name,description,category,enabled,type);activity(admin,'admin.module_updated',{type,enabled},req);return json(res,200,{module:db.prepare('SELECT * FROM calculator_types WHERE type=?').get(type)});
    }
    if((match=pathname.match(/^\/api\/admin\/modules\/([a-z-]+)$/))&&method==='DELETE'){
      const type=match[1];if(!db.prepare('SELECT type FROM calculator_types WHERE type=?').get(type))bad(404,'Calculator module not found.');
      db.prepare('UPDATE calculator_types SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE type=?').run(type);activity(admin,'admin.module_disabled',{type},req);return json(res,200,{ok:true});
    }
    if(method==='GET'&&pathname==='/api/admin/rates')return json(res,200,{rates:db.prepare('SELECT r.*,u.email AS created_by_email FROM exchange_rates r LEFT JOIN users u ON u.id=r.created_by ORDER BY effective_at DESC LIMIT 500').all()});
    if(method==='POST'&&pathname==='/api/admin/rates'){
      const base=String(body.baseCurrency??'').toUpperCase(),quote=String(body.quoteCurrency??'').toUpperCase(),rate=Number(body.rate),source=String(body.source??'').trim().slice(0,120),effectiveAt=isoDate(body.effectiveAt,'Effective date'),validUntil=body.validUntil?isoDate(body.validUntil,'Expiry date'):null;
      if(!validCurrency(base)||!validCurrency(quote)||base===quote)bad(400,'Choose two different supported currencies.');if(!Number.isFinite(rate)||rate<=0||rate>1e9)bad(400,'Rate must be a positive number.');if(source.length<2)bad(400,'Enter the rate source.');if(validUntil&&validUntil<effectiveAt)bad(400,'Expiry must be later than the effective time.');
      const added=db.prepare('INSERT INTO exchange_rates(base_currency,quote_currency,rate,source,effective_at,valid_until,created_by) VALUES(?,?,?,?,?,?,?)').run(base,quote,rate,source,effectiveAt,validUntil,admin.id);activity(admin,'admin.rate_created',{rateId:Number(added.lastInsertRowid),base,quote},req);return json(res,201,{rate:db.prepare('SELECT * FROM exchange_rates WHERE id=?').get(Number(added.lastInsertRowid))});
    }
    if((match=pathname.match(/^\/api\/admin\/rates\/(\d+)$/))&&method==='PATCH'){
      const id=Number(match[1]),old=db.prepare('SELECT * FROM exchange_rates WHERE id=?').get(id);if(!old)bad(404,'Exchange rate not found.');
      const base=String(body.baseCurrency??old.base_currency).toUpperCase(),quote=String(body.quoteCurrency??old.quote_currency).toUpperCase(),rate=Number(body.rate??old.rate),source=String(body.source??old.source).trim().slice(0,120),effectiveAt=isoDate(body.effectiveAt??old.effective_at,'Effective date'),validUntil=body.validUntil===undefined?old.valid_until:(body.validUntil?isoDate(body.validUntil,'Expiry date'):null);
      if(!validCurrency(base)||!validCurrency(quote)||base===quote||!Number.isFinite(rate)||rate<=0||rate>1e9||source.length<2)bad(400,'Rate details are invalid.');if(validUntil&&validUntil<effectiveAt)bad(400,'Expiry must be later than the effective time.');
      db.prepare('UPDATE exchange_rates SET base_currency=?,quote_currency=?,rate=?,source=?,effective_at=?,valid_until=? WHERE id=?').run(base,quote,rate,source,effectiveAt,validUntil,id);activity(admin,'admin.rate_updated',{rateId:id},req);return json(res,200,{rate:db.prepare('SELECT * FROM exchange_rates WHERE id=?').get(id)});
    }
    if((match=pathname.match(/^\/api\/admin\/rates\/(\d+)$/))&&method==='DELETE'){
      const id=Number(match[1]);if(!db.prepare('SELECT id FROM exchange_rates WHERE id=?').get(id))bad(404,'Exchange rate not found.');db.prepare('DELETE FROM exchange_rates WHERE id=?').run(id);activity(admin,'admin.rate_deleted',{rateId:id},req);return json(res,200,{ok:true});
    }
    if(method==='GET'&&pathname==='/api/admin/reports')return json(res,200,{reports:db.prepare('SELECT r.id,r.user_id,r.calculation_id,r.format,r.include_graph,r.filename,r.created_at,u.email,c.name AS calculation_name FROM reports r JOIN users u ON u.id=r.user_id JOIN calculations c ON c.id=r.calculation_id ORDER BY r.created_at DESC LIMIT 500').all()});
    if(method==='GET'&&pathname==='/api/admin/activity')return json(res,200,{activity:db.prepare('SELECT a.id,a.action,a.details_json,a.ip,a.created_at,u.email FROM system_activity a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 500').all().map(a=>({...a,details:JSON.parse(a.details_json)}))});
    return bad(404,'Admin endpoint not found.');
  }
  bad(404,'API endpoint not found.');
}

function getCatalogRow(type){return db.prepare('SELECT name FROM calculator_types WHERE type=?').get(type);}

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
function staticFile(req,res,url){
  let relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
  const target=path.resolve(__dirname,'public',`.${relative}`);
  const root=path.resolve(__dirname,'public');
  if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403);res.end();return;}
  fs.readFile(target,(err,data)=>{
    if(err){fs.readFile(path.join(root,'index.html'),(fallbackError,html)=>{if(fallbackError){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':MIME['.html'],'Cache-Control':'no-cache'});res.end(html);});return;}
    const extension=path.extname(target);
    res.writeHead(200,{'Content-Type':MIME[extension]??'application/octet-stream','Cache-Control':['.html','.js','.css'].includes(extension)?'no-cache':'public, max-age=300'});res.end(data);
  });
}

async function bootstrapAdmin(){
  const email=String(process.env.BOOTSTRAP_ADMIN_EMAIL??'').trim().toLowerCase(),password=String(process.env.BOOTSTRAP_ADMIN_PASSWORD??'');
  if(!email&&!password)return;
  if(!validEmail(email)||password.length<14)throw new Error('Admin bootstrap requires a valid BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD with at least 14 characters.');
  if(db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get())return;
  if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw new Error('The bootstrap email already belongs to a non-admin account; set a different BOOTSTRAP_ADMIN_EMAIL.');
  const hash=await hashPassword(password),name=safeName(process.env.BOOTSTRAP_ADMIN_NAME||'Investly Admin');
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run(name,email,hash);
  logActivity(null,'admin.bootstrap',{email});
  console.info(`Investly admin bootstrap completed for ${email}. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment after setup.`);
}

await bootstrapAdmin();
delete process.env.BOOTSTRAP_ADMIN_EMAIL;
delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
delete process.env.BOOTSTRAP_ADMIN_NAME;
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/'))await api(req,res,url);
    else if(req.method==='GET'||req.method==='HEAD')staticFile(req,res,url);
    else bad(405,'Method not allowed.');
  }catch(error){
    if(res.headersSent){res.destroy();return;}
    if(error instanceof HttpError){json(res,error.status,{error:error.message});return;}
    console.error('Request failed:',error.message);
    json(res,500,{error:'Something went wrong. Please try again.'});
  }
});
server.listen(PORT,'127.0.0.1',()=>console.info(`Investly is running at http://127.0.0.1:${server.address().port}`));
process.on('SIGINT',()=>{server.close(()=>{db.close();process.exit(0);});});
process.on('SIGTERM',()=>{server.close(()=>{db.close();process.exit(0);});});
