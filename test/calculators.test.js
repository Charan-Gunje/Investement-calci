import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, compare } from '../src/calculators.js';

test('lump sum uses annual compounding',()=>{
  const result=calculate('lump-sum',{principal:1000,annualRate:10,years:2},'INR');
  assert.equal(result.totalValue,1210);
  assert.equal(result.estimatedReturns,210);
});

test('SIP uses monthly nominal rate and end-of-month contributions, including zero rate',()=>{
  const result=calculate('sip',{monthlyContribution:100,annualRate:12,years:1},'INR');
  assert.equal(result.totalValue,1268.25);
  assert.equal(result.principal,1200);
  assert.match(result.assumptions[1],/end of each month/);
  const zero=calculate('sip',{monthlyContribution:100,annualRate:0,years:1},'INR');
  assert.equal(zero.totalValue,1200);
});

test('simple and compound interest honor their stated conventions',()=>{
  assert.equal(calculate('simple-interest',{principal:1000,annualRate:12,years:1}).totalValue,1120);
  assert.equal(calculate('compound-interest',{principal:1000,annualRate:12,years:1,compoundingFrequency:4}).totalValue,1125.51);
  assert.equal(calculate('compound-interest',{principal:1000,annualRate:0,years:10,compoundingFrequency:12}).totalValue,1000);
});

test('ROI reports loss, goal planner handles zero rate, and inflation is separate',()=>{
  const roi=calculate('roi',{investment:500,finalValue:400});
  assert.equal(roi.metrics.roiPercent,-20);
  assert.equal(roi.metrics.gainOrLoss,-100);
  const goal=calculate('goal',{targetAmount:1200,annualRate:0,years:1});
  assert.equal(goal.metrics.requiredMonthlyContribution,100);
  const inflation=calculate('inflation',{currentAmount:1000,inflationRate:3,years:2});
  assert.equal(inflation.totalValue,1060.9);
  assert.match(inflation.assumptions[0],/not investment growth/);
});

test('input validation rejects impossible or unsafe values',()=>{
  assert.throws(()=>calculate('roi',{investment:0,finalValue:100}),/greater than zero/);
  assert.throws(()=>calculate('sip',{monthlyContribution:100,annualRate:-1,years:1}),/between 0 and 100/);
  assert.throws(()=>calculate('compound-interest',{principal:1000,annualRate:5,years:1,compoundingFrequency:3}),/frequency/);
  assert.throws(()=>calculate('lump-sum',{principal:1e12,annualRate:100,years:80}),/supported range/);
});

test('comparison returns a named option using highest projected value',()=>{
  const result=compare([
    {name:'Steady monthly',type:'sip',inputs:{monthlyContribution:100,annualRate:0,years:1}},
    {name:'One time',type:'lump-sum',inputs:{principal:1500,annualRate:0,years:1}}
  ]);
  assert.equal(result.bestPlan,'One time');
  assert.equal(result.metric,'Highest projected total value');
  assert.match(result.assumptions[1],/not investment advice/);
  assert.throws(()=>compare([{type:'sip',inputs:{}}]),/between 2 and 5/);
});
