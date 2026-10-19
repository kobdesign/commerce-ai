import { closePools } from '@commerce/db';
import { runtimeReadiness } from '../apps/web/lib/readiness';

try{
  const report=await runtimeReadiness();
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='ok')process.exitCode=1;
}finally{await closePools();}
