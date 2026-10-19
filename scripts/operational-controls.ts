import { Pool } from 'pg';
import { operationalControlNames,type OperationalControlName } from '@commerce/db';

const command=process.argv[2]??'status';
const value=(name:string)=>{const index=process.argv.indexOf(`--${name}`);return index>=0?process.argv[index+1]:undefined;};
const connection=process.env.ADMIN_DATABASE_URL;
if(!connection)throw new Error('ADMIN_DATABASE_URL is required for operational control administration.');
const client=new Pool({connectionString:connection,max:1,connectionTimeoutMillis:5000});
try{
  if(command==='status'){
    const rows=(await client.query('SELECT control_name AS "controlName",enabled,reason,changed_by AS "changedBy",changed_at AS "changedAt" FROM app.operational_controls ORDER BY control_name')).rows;
    console.log(JSON.stringify({controls:rows},null,2));
  }else if(command==='set'){
    const control=value('control') as OperationalControlName,enabled=value('enabled'),reason=value('reason')?.trim(),actor=value('actor')?.trim();
    if(!operationalControlNames.includes(control)||!['true','false'].includes(enabled??'')||!reason||reason.length>500||!actor||actor.length>120){
      throw new Error('Usage: ops:control -- set --control <web_mutations|import_commits> --enabled <true|false> --reason <ticket/reason> --actor <operator>');
    }
    const row=(await client.query('UPDATE app.operational_controls SET enabled=$2,reason=$3,changed_by=$4,changed_at=clock_timestamp() WHERE control_name=$1 RETURNING control_name AS "controlName",enabled,reason,changed_by AS "changedBy",changed_at AS "changedAt"',[control,enabled==='true',reason,actor])).rows[0];
    if(!row)throw new Error('Operational control was not found. Run migrations first.');
    console.log(JSON.stringify({updated:row},null,2));
  }else throw new Error('Usage: operational-controls.ts <status|set>');
}finally{await client.end();}
