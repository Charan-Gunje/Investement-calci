import { formatCurrency, getFieldLabel } from './calculators.js';

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const pdfText = value => String(value).normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
const amount = (value,currency) => `${currency} ${Number(value).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
function inputText(key,value,currency){
  if(key==='annualRate'||key==='inflationRate')return `${value}% p.a.`;
  if(key==='years')return `${value} years`;
  if(key==='compoundingFrequency')return ({1:'Annually',2:'Half-yearly',4:'Quarterly',12:'Monthly',365:'Daily'})[value]||value;
  return amount(value,currency);
}
function metricText(key,value,currency){
  if(key==='roiPercent')return `${value}%`;
  if(key==='contributionMonths')return `${value} months`;
  if(key==='compoundingPeriodsPerYear')return `${value} periods per year`;
  return amount(value,currency);
}

function pieData(out){
  if(Array.isArray(out.pie)){
    const stored=out.pie.map(item=>({label:String(item.label),value:Number(item.value)})).filter(item=>Number.isFinite(item.value)&&item.value>=0);
    if(out.type==='goal')return [{...stored[0],label:'Contributions'},{...stored[1],label:'Growth'}].filter(Boolean);
    if(out.type==='inflation')return [{...stored[0],label:'Amount today'},{...stored[1],label:'Cost increase'}].filter(Boolean);
    return [{...stored[0],label:/current/i.test(stored[0]?.label||'')?'Current value':'Invested'},{...stored[1],label:/loss/i.test(stored[1]?.label||'')?'Loss':'Gain'}].filter(Boolean);
  }
  const metrics=out.metrics??{};
  if(out.type==='goal')return [{label:'Contributions',value:Number(metrics.totalContributions)||0},{label:'Growth',value:Number(metrics.estimatedGrowth)||0}];
  if(out.type==='inflation')return [{label:'Amount today',value:Number(metrics.amountToday)||0},{label:'Cost increase',value:Number(metrics.estimatedCostIncrease)||0}];
  if(out.type==='roi'){
    const gain=Number(metrics.gainOrLoss)||0;
    return gain>=0?[{label:'Invested',value:Number(metrics.investedAmount)||0},{label:'Gain',value:gain}]:[{label:'Current value',value:Number(metrics.currentOrFinalValue)||0},{label:'Loss',value:Math.abs(gain)}];
  }
  const principal=Number(out.principal)||0,change=Number(out.estimatedReturns)||0,total=Number(out.totalValue)||0;
  return change>=0?[{label:'Invested',value:principal},{label:'Gain',value:change}]:[{label:'Current value',value:Math.max(0,total)},{label:'Loss',value:Math.abs(change)}];
}

function comparisonData(out){
  const metrics=out.metrics??{};
  if(out.type==='goal')return [
    {label:'Contributions',value:Number(metrics.totalContributions)||0,color:'0.655 0.800 0.561 rg'},
    {label:'Growth',value:Math.max(0,Number(metrics.estimatedGrowth)||0),color:'0.875 0.710 0.373 rg'},
    {label:'Goal',value:Number(metrics.targetAmount??out.totalValue)||0,color:'0.027 0.361 0.302 rg'}
  ];
  if(out.type==='inflation')return [
    {label:'Today',value:Number(metrics.amountToday)||0,color:'0.655 0.800 0.561 rg'},
    {label:'Cost increase',value:Math.max(0,Number(metrics.estimatedCostIncrease)||0),color:'0.875 0.710 0.373 rg'},
    {label:'Future cost',value:Number(metrics.estimatedFutureCost??out.totalValue)||0,color:'0.027 0.361 0.302 rg'}
  ];
  if(out.type==='roi'){
    const gain=Number(metrics.gainOrLoss)||0;
    return [
      {label:'Invested',value:Number(metrics.investedAmount)||0,color:'0.655 0.800 0.561 rg'},
      {label:gain<0?'Loss':'Gain',value:Math.abs(gain),negative:gain<0,color:'0.875 0.710 0.373 rg'},
      {label:'Current value',value:Number(metrics.currentOrFinalValue??out.totalValue)||0,color:'0.027 0.361 0.302 rg'}
    ];
  }
  const change=Number(out.estimatedReturns??metrics.estimatedReturns)||0;
  return [
    {label:'Invested',value:Number(out.principal??metrics.investedAmount)||0,color:'0.655 0.800 0.561 rg'},
    {label:change<0?'Loss':'Gain',value:Math.abs(change),negative:change<0,color:'0.875 0.710 0.373 rg'},
    {label:'Projected',value:Number(out.totalValue??metrics.totalValue)||0,color:'0.027 0.361 0.302 rg'}
  ];
}

function pdfTextAt(commands,x,y,size,text,color='0.13 0.19 0.17 rg'){
  commands.push(color,`BT /F1 ${size} Tf ${x} ${y} Td (${pdfText(text)}) Tj ET`);
}

function pdfRect(commands,x,y,w,h,color){commands.push(color,`${x} ${y} ${w} ${h} re f`);}
function pdfCenterText(commands,cx,y,size,text,color){const clean=pdfText(text);pdfTextAt(commands,cx-clean.length*size*.25,y,size,clean,color);}
function wrapPdfText(text,max=94){
  const words=pdfText(text).split(/\s+/),lines=[];let line='';
  for(const word of words){const next=line?`${line} ${word}`:word;if(next.length>max&&line){lines.push(line);line=word;}else line=next;}
  if(line)lines.push(line);return lines;
}

function pdfCircle(commands,cx,cy,r,color){
  const k=.55228475;
  commands.push(color,`${(cx+r).toFixed(2)} ${cy} m`,`${(cx+r).toFixed(2)} ${(cy+k*r).toFixed(2)} ${(cx+k*r).toFixed(2)} ${(cy+r).toFixed(2)} ${cx} ${(cy+r).toFixed(2)} c`,`${(cx-k*r).toFixed(2)} ${(cy+r).toFixed(2)} ${(cx-r).toFixed(2)} ${(cy+k*r).toFixed(2)} ${(cx-r).toFixed(2)} ${cy} c`,`${(cx-r).toFixed(2)} ${(cy-k*r).toFixed(2)} ${(cx-k*r).toFixed(2)} ${(cy-r).toFixed(2)} ${cx} ${(cy-r).toFixed(2)} c`,`${(cx+k*r).toFixed(2)} ${(cy-r).toFixed(2)} ${(cx+r).toFixed(2)} ${(cy-k*r).toFixed(2)} ${(cx+r).toFixed(2)} ${cy} c h f`);
}

function addPdfComparison(commands,out,currency){
  const items=comparisonData(out),max=Math.max(1,...items.map(item=>item.value));
  pdfTextAt(commands,54,642,13,'Value comparison');
  items.forEach((item,index)=>{
    const y=555-index*90;
    pdfTextAt(commands,54,y+3,8,item.label,'0.40 0.47 0.43 rg');
    commands.push('0.914 0.937 0.922 rg',`119 ${y} 116 12 re f`,item.color,`119 ${y} ${Math.max(1,116*item.value/max).toFixed(2)} 12 re f`);
    pdfTextAt(commands,241,y+3,7,amount(item.negative?-item.value:item.value,currency));
  });
  pdfTextAt(commands,119,264,7,'0','0.56 0.61 0.58 rg');
  pdfTextAt(commands,190,264,7,amount(max,currency),'0.56 0.61 0.58 rg');
}

function addPdfDonut(commands,items,cx,cy,r,currency,totalValue,centerLabel,legendX=423,titleY=716,legendStartY=448){
  const positive=items.filter(item=>item.value>0),total=positive.reduce((sum,item)=>sum+item.value,0);
  if(!total)return;
  const colors=['0.655 0.800 0.561 rg','0.875 0.710 0.373 rg','0.027 0.361 0.302 rg','0.424 0.604 0.514 rg'];
  const inner=r*.58;
  let start=90;
  pdfCircle(commands,cx,cy,r,'0.914 0.937 0.922 rg');
  positive.forEach((item,index)=>{
    const sweep=item.value/total*360,steps=Math.max(6,Math.ceil(sweep/5)),end=start-sweep;
    commands.push(colors[index%colors.length]);
    for(let step=0;step<=steps;step++){
      const angle=(start-sweep*step/steps)*Math.PI/180;
      const x=(cx+r*Math.cos(angle)).toFixed(2),y=(cy+r*Math.sin(angle)).toFixed(2);
      commands.push(`${step===0?`${x} ${y} m`:`${x} ${y} l`}`);
    }
    for(let step=0;step<=steps;step++){
      const angle=(end+sweep*step/steps)*Math.PI/180;
      const x=(cx+inner*Math.cos(angle)).toFixed(2),y=(cy+inner*Math.sin(angle)).toFixed(2);
      commands.push(`${x} ${y} l`);
    }
    commands.push('h f*');
    start=end;
  });
  const centerRadius=inner*.99;
  pdfCircle(commands,cx,cy,centerRadius,'1 1 1 rg');
  pdfCenterText(commands,cx,cy+6,7,centerLabel,'0.56 0.61 0.58 rg');
  pdfCenterText(commands,cx,cy-8,8,amount(totalValue,currency));
  pdfTextAt(commands,legendX,titleY,11,'Investment composition');
  positive.forEach((item,index)=>{
    const y=legendStartY-index*39;
    commands.push(colors[index%colors.length],`${legendX} ${y-2} 7 7 re f`);
    pdfTextAt(commands,legendX+12,y,8,item.label,'0.40 0.47 0.43 rg');
    pdfTextAt(commands,legendX+12,y-12,7,amount(item.value,currency));
  });
}

function makePdfCharts(out,currency){
  const commands=['0.96 0.97 0.96 rg','0 0 612 842 re f'];
  pdfRect(commands,0,694,612,148,'0.08 0.31 0.24 rg');
  pdfTextAt(commands,42,803,9,'INVESTLY  /  PLAN WITH CLARITY','0.83 0.92 0.60 rg');
  pdfTextAt(commands,42,766,21,'Your projection, visualized','1 1 1 rg');
  pdfTextAt(commands,42,743,9,'A clear comparison of the amounts behind this estimate.','0.85 0.92 0.89 rg');
  pdfRect(commands,35,150,270,510,'1 1 1 rg');
  pdfRect(commands,317,150,260,510,'1 1 1 rg');
  addPdfComparison(commands,out,currency);
  const totalValue=pieData(out).reduce((sum,item)=>sum+item.value,0);
  const centerLabel=out.type==='inflation'?'FUTURE COST':out.type==='roi'&&Number(out.metrics?.gainOrLoss)<0?'INVESTED':out.type==='goal'?'TARGET':'PROJECTED';
  addPdfDonut(commands,pieData(out),388,432,66,currency,totalValue,centerLabel,464,642,485);
  pdfTextAt(commands,42,112,8,'ESTIMATE ONLY  |  Actual results can differ from these assumptions.','0.40 0.47 0.43 rg');
  pdfTextAt(commands,546,32,8,'02','0.40 0.47 0.43 rg');
  return commands.join('\n');
}

function makePdf(calculation, includeGraph) {
  const { outputs: out, inputs, name, currency, createdAt } = calculation;
  const metrics=out.metrics??{};
  const invested=Number(out.principal??metrics.investedAmount??metrics.totalContributions??metrics.amountToday)||0;
  const change=Number(out.estimatedReturns??metrics.estimatedReturns??metrics.estimatedGrowth??metrics.estimatedCostIncrease??metrics.gainOrLoss)||0;
  const projected=Number(out.totalValue??metrics.totalValue??metrics.targetAmount??metrics.estimatedFutureCost)||0;
  const commands=['0.96 0.97 0.96 rg','0 0 612 842 re f'];
  pdfRect(commands,0,684,612,158,'0.08 0.31 0.24 rg');
  pdfTextAt(commands,42,803,9,'INVESTLY  /  PLAN WITH CLARITY','0.83 0.92 0.60 rg');
  pdfTextAt(commands,42,769,22,'Investment projection report','1 1 1 rg');
  pdfTextAt(commands,42,745,11,name,'0.91 0.96 0.93 rg');
  pdfTextAt(commands,42,721,8,`Generated ${new Date(createdAt).toLocaleDateString('en-IN')}  |  ${currency}  |  Planning estimate`,'0.78 0.88 0.82 rg');
  const summary=[['AMOUNT INVESTED',amount(invested,currency)],['ESTIMATED CHANGE',`${change<0?'-':''}${amount(Math.abs(change),currency)}`],['PROJECTED VALUE',amount(projected,currency)]];
  summary.forEach(([label,value],index)=>{
    const x=42+index*178;
    pdfRect(commands,x,582,168,78,'1 1 1 rg');
    pdfTextAt(commands,x+12,636,7,label,'0.34 0.48 0.41 rg');
    pdfTextAt(commands,x+12,608,10,value,'0.08 0.31 0.24 rg');
  });
  pdfTextAt(commands,42,550,13,'Calculation details');
  pdfTextAt(commands,42,534,8,'Inputs and results at a glance','0.43 0.52 0.47 rg');
  const rows=[
    {section:'YOUR ASSUMPTIONS'},
    ...Object.entries(inputs).map(([key,value])=>({label:getFieldLabel(key),value:inputText(key,value,currency)})),
    {section:'PROJECTED RESULTS'},
    {label:'Amount invested / starting amount',value:amount(invested,currency)},
    {label:'Estimated returns / change',value:`${change<0?'-':''}${amount(Math.abs(change),currency)}`},
    {label:'Projected total value',value:amount(projected,currency)},
    ...Object.entries(metrics).filter(([key])=>!['investedAmount','estimatedReturns','totalValue','totalContributions','estimatedGrowth','estimatedCostIncrease','targetAmount','amountToday','estimatedFutureCost'].includes(key)).map(([key,value])=>({label:getFieldLabel(key),value:typeof value==='number'?metricText(key,value,currency):String(value)}))
  ];
  let y=514,dataIndex=0;
  for(const row of rows){
    if(row.section){pdfRect(commands,42,y-5,528,21,'0.89 0.93 0.90 rg');pdfTextAt(commands,52,y+2,7,row.section,'0.08 0.31 0.24 rg');}
    else{
      if(dataIndex%2===1)pdfRect(commands,42,y-5,528,21,'0.985 0.99 0.985 rg');
      pdfTextAt(commands,52,y+2,8,row.label,'0.30 0.39 0.34 rg');
      const value=pdfText(row.value),size=8,x=Math.max(330,558-value.length*size*.25);
      pdfTextAt(commands,x,y+2,size,value,'0.12 0.20 0.16 rg');dataIndex++;
    }
    y-=22;
  }
  const assumptionTop=Math.min(y-10,246),assumptionHeight=Math.max(64,assumptionTop-158);
  pdfRect(commands,42,assumptionTop-assumptionHeight,528,assumptionHeight,'1 1 1 rg');
  pdfTextAt(commands,54,assumptionTop-17,8,'ASSUMPTIONS & NOTES','0.08 0.31 0.24 rg');
  let noteY=assumptionTop-33;
  for(const note of [...(out.assumptions??[]),'Estimate only. Actual returns may differ; fees, taxes, and market conditions can affect outcomes.']){
    for(const line of wrapPdfText(note,105)){if(noteY<assumptionTop-assumptionHeight+10)break;pdfTextAt(commands,54,noteY,7,line,'0.40 0.48 0.43 rg');noteY-=11;}
  }
  pdfTextAt(commands,42,31,8,'Investly  |  For planning and educational use','0.44 0.52 0.47 rg');
  pdfTextAt(commands,548,31,8,'01','0.44 0.52 0.47 rg');
  const stream=commands.join('\n'),chartStream=includeGraph?makePdfCharts(out,currency):null;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [3 0 R${includeGraph?' 6 0 R':''}] /Count ${includeGraph?2:1} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  if(includeGraph)objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',`<< /Length ${Buffer.byteLength(chartStream)} >>\nstream\n${chartStream}\nendstream`);
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [filename, content] of Object.entries(entries)) {
    const name = Buffer.from(filename), data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += header.length + name.length + data.length;
  }
  const centralData = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralData, end]);
}

function column(index) {
  let name = '';
  while (index > 0) { const remainder = (index - 1) % 26; name = String.fromCharCode(65 + remainder) + name; index = Math.floor((index - 1) / 26); }
  return name;
}

function chartAnchor(objectId,name,fromColumn,toColumn,chartRelation){
  return `<xdr:twoCellAnchor><xdr:from><xdr:col>${fromColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${objectId}" name="${xml(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${chartRelation}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

function makeXlsx(calculation, includeGraph) {
  const { outputs: out, inputs, name, currency, createdAt } = calculation;
  const rows = [
    ['Investly Calculation Report'], ['Calculator', name], ['Generated', createdAt], ['Currency', currency], [], ['INPUTS'],
    ['Input', 'Value'], ...Object.entries(inputs).map(([key, value]) => [getFieldLabel(key), inputText(key,value,currency)]), [], ['RESULTS'],
    ['Measure', 'Value'], ['Invested / starting amount', amount(out.principal,currency)], ['Estimated returns / change', amount(out.estimatedReturns,currency)], ['Total / projected value', amount(out.totalValue,currency)],
    ...Object.entries(out.metrics ?? {}).filter(([key]) => !['investedAmount','estimatedReturns','totalValue'].includes(key)).map(([key, value]) => [getFieldLabel(key), typeof value==='number'?metricText(key,value,currency):value]),
    [], ['ASSUMPTIONS'], ...[...(out.assumptions ?? []), `Formula version: ${out.formulaVersion}`, 'Amounts rounded to 2 decimal places. Projections are estimates, not investment advice.'].map(x => [x])
  ];
  const graphItems=comparisonData(out),pieItems=pieData(out);
  const graphStartRow=rows.length+2,chartRowStart=graphStartRow+2;
  const pieTitleRow=graphStartRow+graphItems.length+3,pieRowStart=pieTitleRow+2;
  if(includeGraph)rows.push([],['VALUE COMPARISON DATA'],['Measure','Value'],...graphItems.map(item=>[item.label,item.value]),[],['INVESTMENT COMPOSITION DATA'],['Measure','Value'],...pieItems.map(item=>[item.label,item.value]));
  const sheetRows = rows.map((cells, ri) => {
    const rowNum = ri + 1;
    const data = cells.map((value, ci) => {
      if (value === undefined || value === null || value === '') return '';
      const ref = `${column(ci + 1)}${rowNum}`;
      if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowNum}">${data}</row>`;
  }).join('');
  const drawing = includeGraph ? '<drawing r:id="rId1"/>' : '';
  const entries = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${includeGraph ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' : ''}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Calculation" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${sheetRows}</sheetData>${drawing}</worksheet>`
  };
  if (includeGraph) {
    entries['xl/worksheets/_rels/sheet1.xml.rels'] = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>';
    const drawingRoot='<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">';
    entries['xl/drawings/drawing1.xml'] = `${drawingRoot}${chartAnchor(2,'Investly value comparison',3,10,'rId1')}${chartAnchor(3,'Investly investment composition',11,18,'rId2')}</xdr:wsDr>`;
    entries['xl/drawings/_rels/drawing1.xml.rels'] = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/></Relationships>';
    entries['xl/charts/chart1.xml'] = `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:lang val="en-US"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>Value comparison (${xml(currency)})</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="1"/><c:gapWidth val="55"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Amount</c:v></c:tx><c:cat><c:strRef><c:f>Calculation!$A$${chartRowStart}:$A$${chartRowStart + graphItems.length - 1}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Calculation!$B$${chartRowStart}:$B$${chartRowStart + graphItems.length - 1}</c:f></c:numRef></c:val></c:ser><c:axId val="10"/><c:axId val="20"/></c:barChart><c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="20"/><c:crosses val="autoZero"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:majorGridlines/><c:numFmt formatCode="#,##0.00" sourceLinked="0"/><c:crossAx val="10"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:layout/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
    const pieEndRow=pieRowStart+pieItems.length-1;
    entries['xl/charts/chart2.xml'] = `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:lang val="en-US"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>Investment composition (${xml(currency)})</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:doughnutChart><c:varyColors val="1"/><c:holeSize val="62"/><c:firstSliceAng val="270"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>Calculation!$A$${pieRowStart}:$A$${pieEndRow}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Calculation!$B$${pieRowStart}:$B$${pieEndRow}</c:f></c:numRef></c:val></c:ser><c:dLbls><c:showLegendKey val="0"/><c:showPercent val="1"/><c:showCategoryName val="1"/><c:showVal val="0"/></c:dLbls></c:doughnutChart></c:plotArea><c:legend><c:legendPos val="b"/><c:layout/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
  }
  return zip(entries);
}

export function buildReport(calculation, format, includeGraph = true) {
  if (format === 'pdf') return { data: makePdf(calculation, includeGraph), contentType: 'application/pdf', extension: 'pdf' };
  if (format === 'xlsx') return { data: makeXlsx(calculation, includeGraph), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
  throw new Error('Choose PDF or Excel format.');
}
