export function validEmbedding(value){return Array.isArray(value)&&value.length===768&&value.every(Number.isFinite)&&Math.abs(Math.hypot(...value)-1)<.01;}
export function makeReferenceIndex(rows){
 return rows.filter(row=>validEmbedding(row.embedding)).map(row=>({productId:String(row.productId),referenceId:String(row._id),vector:Float32Array.from(row.embedding)}));
}
export function rankReferenceProducts(embedding,index){
 const scores=new Map();
 for(const row of index){let score=0;for(let i=0;i<embedding.length;i++)score+=row.vector[i]*embedding[i];
  const old=scores.get(row.productId);if(!old||score>old.similarity)scores.set(row.productId,{productId:row.productId,referenceId:row.referenceId,similarity:score});
 }
 return [...scores.values()].sort((a,b)=>b.similarity-a.similarity||a.productId.localeCompare(b.productId));
}
