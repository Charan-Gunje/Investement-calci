import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

async function unusedPort(){
  const socket=net.createServer();
  await new Promise((resolve,reject)=>socket.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const {port}=socket.address();await new Promise(resolve=>socket.close(resolve));return port;
}
const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

test('server enforces sessions and history ownership, manages sourced rates, and persists downloadable reports',{timeout:60000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'investly-test-'));
  const port=await unusedPort();
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve('.'),env:{...process.env,PORT:String(port),DATABASE_PATH:path.join(dir,'test.sqlite'),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',BOOTSTRAP_ADMIN_PASSWORD:'correct-horse-battery-staple',BOOTSTRAP_ADMIN_NAME:'Test Admin',COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk.toString());child.stderr.on('data',chunk=>output+=chunk.toString());
  t.after(async()=>{child.kill();await wait(150);fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<100&&!output.includes(`:${port}`);i++){if(child.exitCode!==null)break;await wait(100);}
  assert.match(output,new RegExp(`http:\\/\\/127\\.0\\.0\\.1:${port}`),output);
  const call=async(url,{cookie,method='GET',body}={})=>{
    const response=await fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const contentType=response.headers.get('content-type')||'';
    const data=contentType.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
    return {response,data};
  };
  const register=async(name,email)=>{
    const {response,data}=await call('/api/register',{method:'POST',body:{name,email,password:'long-enough-test-password'}});
    assert.equal(response.status,201,data.error);
    const setCookie=response.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Lax/);
    return `investly_session=${setCookie.match(/investly_session=([^;]+)/)[1]}`;
  };
  const owner=await register('Owner One','owner@example.test');
  const profile=await call('/api/profile',{cookie:owner,method:'PATCH',body:{name:'Owner Updated',preferredCurrency:'EUR'}});
  assert.equal(profile.response.status,200);assert.equal(profile.data.user.preferredCurrency,'EUR');
  assert.equal((await call('/api/session',{cookie:owner})).data.user.name,'Owner Updated');
  const calculation=await call('/api/calculate',{cookie:owner,method:'POST',body:{type:'sip',inputs:{monthlyContribution:100,annualRate:0,years:1},currency:'EUR'}});
  assert.equal(calculation.response.status,200);assert.equal(calculation.data.result.totalValue,1200);
  const comparison=await call('/api/compare',{cookie:owner,method:'POST',body:{currency:'EUR',plans:[
    {name:'Monthly',type:'sip',inputs:{monthlyContribution:100,annualRate:0,years:1}},
    {name:'Starting capital',type:'lump-sum',inputs:{principal:1500,annualRate:0,years:1}}
  ]}});
  assert.equal(comparison.response.status,201);assert.equal(comparison.data.bestPlan,'Starting capital');
  let saved=await call('/api/history',{cookie:owner,method:'POST',body:{type:'lump-sum',inputs:{principal:10000,annualRate:8,years:5},currency:'INR'}});
  assert.equal(saved.response.status,201,saved.data.error);const id=saved.data.calculation.id;
  const reportPdf=await call(`/api/history/${id}/report`,{cookie:owner,method:'POST',body:{format:'pdf',includeGraph:true}});
  assert.equal(reportPdf.response.status,201,reportPdf.data.error);
  const pdf=await call(reportPdf.data.report.downloadUrl,{cookie:owner});assert.equal(pdf.response.status,200);assert.ok(pdf.data.toString('latin1').startsWith('%PDF-1.4'));
  const reportXlsx=await call(`/api/history/${id}/report`,{cookie:owner,method:'POST',body:{format:'xlsx',includeGraph:true}});
  assert.equal(reportXlsx.response.status,201,reportXlsx.data.error);
  const xlsx=await call(reportXlsx.data.report.downloadUrl,{cookie:owner});assert.equal(xlsx.response.status,200);assert.equal(xlsx.data.readUInt32LE(0),0x04034b50);
  const other=await register('Other User','other@example.test');
  assert.equal((await call(`/api/history/${id}`,{cookie:other})).response.status,404);
  assert.equal((await call(`/api/history/${id}`,{cookie:other,method:'DELETE'})).response.status,404);
  assert.equal((await call('/api/admin/users',{cookie:other})).response.status,403);
  const published=await call('/api/currency/convert',{cookie:other,method:'POST',body:{from:'INR',to:'USD',amount:1000}});
  if(published.response.status===200)assert.match(published.data.source,/Frankfurter/);
  else{assert.equal(published.response.status,404);assert.match(published.data.error,/unavailable/);}
  const adminLogin=await call('/api/login',{method:'POST',body:{email:'admin@example.test',password:'correct-horse-battery-staple'}});
  assert.equal(adminLogin.response.status,200,adminLogin.data.error);
  const adminCookie=`investly_session=${adminLogin.response.headers.get('set-cookie').match(/investly_session=([^;]+)/)[1]}`;
  const users=await call('/api/admin/users',{cookie:adminCookie});assert.equal(users.response.status,200);assert.ok(users.data.users.some(u=>u.email==='owner@example.test'));
  const added=await call('/api/admin/rates',{cookie:adminCookie,method:'POST',body:{baseCurrency:'USD',quoteCurrency:'INR',rate:83.2,source:'Test central bank daily bulletin',effectiveAt:new Date().toISOString()}});
  assert.equal(added.response.status,201,added.data.error);
  const converted=await call('/api/currency/convert',{cookie:other,method:'POST',body:{from:'INR',to:'USD',amount:1000}});
  assert.equal(converted.response.status,200,converted.data.error);assert.equal(converted.data.converted,12.02);assert.match(converted.data.source,/inverse rate/);
  const expired=await call(`/api/admin/rates/${added.data.rate.id}`,{cookie:adminCookie,method:'PATCH',body:{effectiveAt:new Date(Date.now()-2*86400000).toISOString(),validUntil:new Date(Date.now()-86400000).toISOString()}});
  assert.equal(expired.response.status,200);
  const afterExpiry=await call('/api/currency/convert',{cookie:other,method:'POST',body:{from:'INR',to:'USD',amount:1000}});
  if(afterExpiry.response.status===200)assert.match(afterExpiry.data.source,/Frankfurter/);
  else assert.equal(afterExpiry.response.status,404);
  const module=await call('/api/admin/modules/sip',{cookie:adminCookie,method:'PATCH',body:{name:'SIP Plan',description:'Updated module metadata',category:'Invest regularly',enabled:true}});
  assert.equal(module.response.status,200);
  assert.ok((await call('/api/calculators')).data.calculators.some(c=>c.type==='sip'&&c.name==='SIP Plan'));
  assert.ok((await call('/api/admin/reports',{cookie:adminCookie})).data.reports.length>=2);
  assert.ok((await call('/api/admin/activity',{cookie:adminCookie})).data.activity.length>0);
  const reports=await call('/api/history/reports',{cookie:owner});assert.equal(reports.data.reports.length,2);
  assert.equal((await call('/api/logout',{cookie:other,method:'POST',body:{}})).response.status,200);
  assert.equal((await call('/api/history',{cookie:other})).response.status,401);
});
