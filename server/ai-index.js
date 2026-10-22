export function validEmbedding(value){return Array.isArray(value)&&value.length===768&&value.every(Number.isFinite)&&Math.abs(Math.hypot(...value)-1)<.01;}
export function makeReferenceIndex(rows){
 return rows.filter(row=>validEmbedding(row.embedding)).map(row=>({productId:String(row.productId),referenceId:String(row._id),vector:Float32Array.from(row.embedding)}));
}
export function rankReferenceProducts(embedding,index){
 const queries=Array.isArray(embedding?.[0])?embedding:[embedding];
 const scores=new Map();
 for(const row of index){
  const similarities=queries.map(query=>{let score=0;for(let i=0;i<query.length;i++)score+=row.vector[i]*query[i];return score;});
  const best=Math.max(...similarities),weightTotal=queries.reduce((sum,_,i)=>sum+1/(i+1),0);
  const weighted=similarities.reduce((sum,score,i)=>sum+score/(i+1),0)/weightTotal;
  // A focused crop is the first query. Keep the best view while requiring some
  // agreement from the full frame so background-only matches rank lower.
  const score=queries.length===1?best:best*.7+weighted*.3;
  const old=scores.get(row.productId);if(!old||score>old.similarity)scores.set(row.productId,{productId:row.productId,referenceId:row.referenceId,similarity:score});
 }
 return [...scores.values()].sort((a,b)=>b.similarity-a.similarity||a.productId.localeCompare(b.productId));
}
