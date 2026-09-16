export class RequestError extends Error{constructor(message:string,public code:string,public status:number){super(message);}}
export async function request<T>(url:string,body:unknown,method='POST'):Promise<T>{
 const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new RequestError(data.error??'ดำเนินการไม่สำเร็จ',data.code??'UNKNOWN',response.status);return data as T;
}
export function money(value:number){return new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',maximumFractionDigits:2,minimumFractionDigits:2}).format(value/100);}
export function toMinor(value:string){if(!/^\d+(\.\d{1,2})?$/.test(value))throw new Error('กรุณากรอกจำนวนเงินเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง');const [whole,fraction='']=value.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));}
