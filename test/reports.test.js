import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/reports.js';
import { calculate } from '../src/calculators.js';

const result=calculate('lump-sum',{principal:1000,annualRate:5,years:3},'INR');
const snapshot={outputs:result,inputs:result.inputs,name:'Test plan',currency:'INR',createdAt:new Date().toISOString()};

test('PDF reports contain report text and a graph when selected',()=>{
  const file=buildReport(snapshot,'pdf',true);
  assert.equal(file.contentType,'application/pdf');
  assert.equal(file.extension,'pdf');
  const text=file.data.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text,/INVESTLY/);
  assert.match(text,/Estimated returns/);
  assert.match(text,/ re f/);
});

test('Excel reports are valid stored ZIP packages and include an actual chart',()=>{
  const file=buildReport(snapshot,'xlsx',true);
  assert.equal(file.contentType,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(file.extension,'xlsx');
  assert.equal(file.data.readUInt32LE(0),0x04034b50);
  const contents=new Map();let offset=0;
  while(file.data.readUInt32LE(offset)===0x04034b50){
    const nameLength=file.data.readUInt16LE(offset+26),extraLength=file.data.readUInt16LE(offset+28),size=file.data.readUInt32LE(offset+18);
    const name=file.data.subarray(offset+30,offset+30+nameLength).toString();
    const start=offset+30+nameLength+extraLength;
    contents.set(name,file.data.subarray(start,start+size).toString('utf8'));
    offset=start+size;
  }
  assert.ok(contents.has('xl/worksheets/sheet1.xml'));
  assert.ok(contents.has('xl/charts/chart1.xml'));
  assert.match(contents.get('xl/charts/chart1.xml'),/Value comparison/);
  assert.match(contents.get('xl/worksheets/sheet1.xml'),/Estimated returns/);
});

test('reports reject unsupported formats and can omit graph content',()=>{
  assert.throws(()=>buildReport(snapshot,'csv'),/PDF or Excel/);
  const pdf=buildReport(snapshot,'pdf',false).data.toString('latin1');
  assert.doesNotMatch(pdf,/Investment composition/);
  assert.match(pdf,/\/Count 1 >>/);
});
