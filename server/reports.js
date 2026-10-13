export function dateRange(query) {
  const range={};
  for(const [field,operator] of [['from','$gte'],['to','$lt']]) {
    if(!query[field])continue;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(query[field]))throw Error('Use YYYY-MM-DD dates.');
    const date=new Date(`${query[field]}T00:00:00+05:00`);
    if(!Number.isFinite(date.getTime())||new Date(date.getTime()+5*3600000).toISOString().slice(0,10)!==query[field])throw Error('Invalid calendar date.');
    if(field==='to')date.setUTCDate(date.getUTCDate()+1);
    range[operator]=date;
  }
  if(range.$gte&&range.$lt&&range.$gte>=range.$lt)throw Error('End date must be on or after start date.');
  return Object.keys(range).length?{createdAt:range}:{};
}
export function reportPage(query) {const page=Number(query.page||1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw Error('Invalid page.');return page;}
