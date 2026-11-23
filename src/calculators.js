export const FORMULA_VERSION = '1.0.0';

export const calculatorCatalog = [
  { type: 'sip', name: 'SIP', description: 'Estimate the future value of regular monthly contributions.', category: 'Invest regularly', fields: ['monthlyContribution', 'annualRate', 'years'] },
  { type: 'lump-sum', name: 'Lump Sum', description: 'Project how a one-time investment may grow over time.', category: 'Invest once', fields: ['principal', 'annualRate', 'years'] },
  { type: 'simple-interest', name: 'Simple Interest', description: 'See growth calculated on your original principal.', category: 'Understand growth', fields: ['principal', 'annualRate', 'years'] },
  { type: 'compound-interest', name: 'Compound Interest', description: 'Project growth with a compounding schedule you choose.', category: 'Understand growth', fields: ['principal', 'annualRate', 'years', 'compoundingFrequency'] },
  { type: 'roi', name: 'ROI', description: 'Measure the percentage gain or loss on an investment.', category: 'Review a result', fields: ['investment', 'finalValue'] },
  { type: 'goal', name: 'Goal Planner', description: 'Find the monthly contribution needed to reach a target.', category: 'Plan a goal', fields: ['targetAmount', 'annualRate', 'years'] },
  { type: 'inflation', name: 'Inflation', description: 'Estimate how rising prices affect a future expense.', category: 'Plan for prices', fields: ['currentAmount', 'inflationRate', 'years'] },
];

const fieldLabels = {
  monthlyContribution: 'Monthly contribution', principal: 'Initial investment', annualRate: 'Expected annual return', years: 'Time horizon',
  compoundingFrequency: 'Compounding frequency', investment: 'Amount invested', finalValue: 'Current or final value',
  targetAmount: 'Target amount', currentAmount: 'Amount today', inflationRate: 'Assumed annual inflation',
};

export const fieldMeta = {
  monthlyContribution: { type: 'number', min: 0.01, max: 1e12, step: '0.01', suffix: 'per month' },
  principal: { type: 'number', min: 0.01, max: 1e12, step: '0.01' },
  annualRate: { type: 'number', min: 0, max: 100, step: '0.01', suffix: '% p.a.' },
  years: { type: 'number', min: 0.0833333333333, max: 80, step: 'any', suffix: 'years; SIP and goal terms must resolve to whole months' },
  compoundingFrequency: { type: 'select', options: [['1', 'Annually'], ['2', 'Half-yearly'], ['4', 'Quarterly'], ['12', 'Monthly'], ['365', 'Daily']] },
  investment: { type: 'number', min: 0, max: 1e12, step: '0.01' },
  finalValue: { type: 'number', min: 0, max: 1e12, step: '0.01' },
  targetAmount: { type: 'number', min: 0.01, max: 1e12, step: '0.01' },
  currentAmount: { type: 'number', min: 0.01, max: 1e12, step: '0.01' },
  inflationRate: { type: 'number', min: 0, max: 100, step: '0.01', suffix: '% p.a.' },
};

export const getCalculator = type => calculatorCatalog.find(item => item.type === type);
export const getFieldLabel = field => fieldLabels[field] ?? field;

function number(input, key, { min = 0, max = 1e12 } = {}) {
  const value = Number(input?.[key]);
  if (input?.[key] === undefined || input?.[key] === '' || !Number.isFinite(value)) throw new Error(`${fieldLabels[key] ?? key} must be a valid number.`);
  if (value < min || value > max) throw new Error(`${fieldLabels[key] ?? key} must be between ${min} and ${max}.`);
  return value;
}

const money = x => Math.round((x + Number.EPSILON) * 100) / 100;
const percent = x => Math.round((x + Number.EPSILON) * 100) / 100;
const safe = x => { if (!Number.isFinite(x) || Math.abs(x) > 1e15) throw new Error('These inputs produce a value outside the supported range.'); return x; };

function result({ type, principal, totalValue, interest, currency, assumptions, labels = {} }) {
  const invested = money(principal), total = money(safe(totalValue));
  const returns = money(total - invested);
  const pie = returns >= 0
    ? [{ label: 'Invested amount', value: invested }, { label: 'Estimated returns', value: returns }]
    : [{ label: 'Current value', value: total }, { label: 'Loss', value: money(-returns) }];
  return {
    type, currency, principal: invested, interest: money(interest), estimatedReturns: returns, totalValue: total,
    metrics: { investedAmount: invested, estimatedReturns: returns, totalValue: total, ...labels }, pie,
    formulaVersion: FORMULA_VERSION, assumptions,
    graph: [{ label: 'Invested amount', value: Math.max(0, invested) }, { label: 'Estimated returns', value: Math.max(0, returns) }],
    disclaimer: 'Projection only. Actual results depend on returns, costs, taxes, and timing.'
  };
}

export function calculate(type, raw, currency = 'INR') {
  const spec = getCalculator(type);
  if (!spec) throw new Error('Choose a supported calculator.');
  raw ??= {};
  const input = {};
  for (const key of spec.fields) {
    if (key === 'compoundingFrequency') continue;
    const meta = fieldMeta[key];
    input[key] = number(raw, key, { min: meta.min, max: meta.max });
  }
  const years = input.years;
  const annualRate = (input.annualRate ?? input.inflationRate) / 100;
  const assumptions = [];
  let output;
  switch (type) {
    case 'lump-sum': {
      const total = input.principal * (1 + annualRate) ** years;
      assumptions.push('Annual effective return; annual compounding; one initial investment.');
      output = result({ type, principal: input.principal, totalValue: total, interest: total - input.principal, currency, assumptions });
      break;
    }
    case 'sip': {
      const months = Math.round(years * 12);
      if (!months || Math.abs(months - years * 12) > 1e-7) throw new Error('Time horizon must resolve to a whole number of months.');
      const monthlyRate = annualRate / 12;
      const total = monthlyRate === 0 ? input.monthlyContribution * months : input.monthlyContribution * (((1 + monthlyRate) ** months - 1) / monthlyRate);
      const invested = input.monthlyContribution * months;
      assumptions.push('Monthly rate is the nominal annual rate divided by 12.', 'Contributions are made at the end of each month.');
      output = result({ type, principal: invested, totalValue: total, interest: total - invested, currency, assumptions, labels: { monthlyContribution: money(input.monthlyContribution), contributionMonths: months } });
      break;
    }
    case 'simple-interest': {
      const interest = input.principal * annualRate * years;
      assumptions.push('Simple interest on the original principal; no compounding.');
      output = result({ type, principal: input.principal, totalValue: input.principal + interest, interest, currency, assumptions });
      break;
    }
    case 'compound-interest': {
      const freq = Number(raw.compoundingFrequency ?? 12);
      if (![1, 2, 4, 12, 365].includes(freq)) throw new Error('Choose an available compounding frequency.');
      const total = input.principal * (1 + annualRate / freq) ** (freq * years);
      const label = ({ 1: 'annually', 2: 'half-yearly', 4: 'quarterly', 12: 'monthly', 365: 'daily' })[freq];
      assumptions.push(`Nominal annual rate compounded ${label} (${freq} periods per year).`);
      output = result({ type, principal: input.principal, totalValue: total, interest: total - input.principal, currency, assumptions, labels: { compoundingPeriodsPerYear: freq } });
      break;
    }
    case 'roi': {
      if (input.investment <= 0) throw new Error('Amount invested must be greater than zero.');
      const gain = input.finalValue - input.investment;
      assumptions.push('ROI is measured against the amount invested; no time adjustment is applied.');
      output = result({ type, principal: input.investment, totalValue: input.finalValue, interest: gain, currency, assumptions, labels: { roiPercent: percent(gain / input.investment * 100), finalValue: money(input.finalValue) } });
      output.pie = gain >= 0
        ? [{ label: 'Amount invested', value: money(input.investment) }, { label: 'Gain', value: money(gain) }]
        : [{ label: 'Current value', value: money(input.finalValue) }, { label: 'Loss', value: money(-gain) }];
      output.graph = [{ label: 'Amount invested', value: input.investment }, { label: 'Current or final value', value: input.finalValue }];
      output.metrics = { investedAmount: money(input.investment), gainOrLoss: money(gain), currentOrFinalValue: money(input.finalValue), roiPercent: percent(gain / input.investment * 100) };
      break;
    }
    case 'goal': {
      const months = Math.round(years * 12);
      if (!months || Math.abs(months - years * 12) > 1e-7) throw new Error('Time horizon must resolve to a whole number of months.');
      const monthlyRate = annualRate / 12;
      const contribution = monthlyRate === 0 ? input.targetAmount / months : input.targetAmount * monthlyRate / ((1 + monthlyRate) ** months - 1);
      const invested = contribution * months;
      assumptions.push('Target is funded by equal end-of-month deposits; monthly rate is annual nominal return divided by 12.', 'No starting lump sum, fees, or taxes are included.');
      output = result({ type, principal: invested, totalValue: input.targetAmount, interest: input.targetAmount - invested, currency, assumptions, labels: { requiredMonthlyContribution: money(contribution), contributionMonths: months, targetAmount: money(input.targetAmount) } });
      output.pie = [{ label: 'Planned contributions', value: money(invested) }, { label: 'Estimated growth', value: money(Math.max(0, input.targetAmount - invested)) }];
      output.graph = [{ label: 'Planned contributions', value: invested }, { label: 'Projected goal', value: input.targetAmount }];
      output.metrics = { requiredMonthlyContribution: money(contribution), totalContributions: money(invested), estimatedGrowth: money(input.targetAmount - invested), targetAmount: money(input.targetAmount) };
      break;
    }
    case 'inflation': {
      const future = input.currentAmount * (1 + annualRate) ** years;
      const impact = future - input.currentAmount;
      assumptions.push('Inflation is compounded annually; this is a purchasing-cost estimate, not investment growth.');
      output = result({ type, principal: input.currentAmount, totalValue: future, interest: impact, currency, assumptions, labels: { amountToday: money(input.currentAmount), estimatedFutureCost: money(future), estimatedCostIncrease: money(impact) } });
      output.pie = [{ label: 'Amount today', value: money(input.currentAmount) }, { label: 'Cost increase', value: money(impact) }];
      output.graph = [{ label: 'Amount today', value: input.currentAmount }, { label: 'Estimated future cost', value: future }];
      output.metrics = { amountToday: money(input.currentAmount), estimatedFutureCost: money(future), estimatedCostIncrease: money(impact) };
      break;
    }
  }
  output.inputs = Object.fromEntries(spec.fields.map(key => [key, raw[key] ?? (key === 'compoundingFrequency' ? 12 : undefined)]));
  output.calculatorName = spec.name;
  return output;
}

export function compare(plans, currency = 'INR') {
  if (!Array.isArray(plans) || plans.length < 2 || plans.length > 5) throw new Error('Compare between 2 and 5 plans.');
  const normalized = plans.map((plan, index) => {
    const calc = calculate(plan.type, plan.inputs, currency);
    return { name: String(plan.name || `${calc.calculatorName} ${index + 1}`).slice(0, 60), type: plan.type, inputs: calc.inputs, result: calc };
  });
  const best = [...normalized].sort((a, b) => b.result.totalValue - a.result.totalValue)[0];
  return { plans: normalized, metric: 'Highest projected total value', bestPlan: best.name, assumptions: ['Each plan uses its own calculator assumptions; confirm comparable time horizons and cash flows before interpreting.', 'The highest projected value is a mathematical comparison, not investment advice.'] };
}

export function formatCurrency(value, currency = 'INR') {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${Number(value).toFixed(2)}`; }
}
