// Strict accounting event timestamp normalization. Firestore REST adapters
// return ISO UTC strings; offline transaction tests use native Date objects.
// Reject ambiguous local times, missing timestamps and non-finite values.
export function storeAccountingTimestampMs(value){
  let ms=NaN;
  if(value instanceof Date) ms=value.getTime();
  else if(typeof value==="string"&&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value))
    ms=Date.parse(value);
  return Number.isSafeInteger(ms)&&ms>=0?ms:null;
}
