import { afterAll,describe,expect,test } from 'vitest';
import { Pool } from 'pg';
import { AppError } from '@commerce/contracts';
import { assertOperationalControl,operationalControlEnabled } from '@commerce/db';
import { jsonInput,mutationInput } from '../apps/web/lib/server';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
async function setControl(control:'web_mutations'|'import_commits',enabled:boolean,reason:string){
  await admin.query(`UPDATE app.operational_controls SET enabled=$2,reason=$3,changed_by='automated-test',changed_at=clock_timestamp() WHERE control_name=$1`,[control,enabled,reason]);
}
afterAll(async()=>{
  await Promise.all([
    setControl('web_mutations',true,'Automated test cleanup'),
    setControl('import_commits',true,'Automated test cleanup'),
  ]);
  await admin.end();
});

describe('operational controls',()=>{
  test('defaults both controls to enabled',async()=>{
    expect(await operationalControlEnabled('web_mutations')).toBe(true);
    expect(await operationalControlEnabled('import_commits')).toBe(true);
  });

  test('fails closed with a stable service response and records the operator change',async()=>{
    await setControl('web_mutations',false,'INC-TEST freeze writes');
    try{
      await assertOperationalControl('web_mutations');
      throw new Error('Expected operational control to block');
    }catch(error){
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({status:503,code:'OPERATION_PAUSED'});
    }
    const event=(await admin.query(`SELECT previous_enabled AS "previousEnabled",enabled,reason,changed_by AS "changedBy" FROM app.operational_control_events WHERE control_name='web_mutations' ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(event).toMatchObject({previousEnabled:true,enabled:false,reason:'INC-TEST freeze writes',changedBy:'automated-test'});
    await setControl('web_mutations',true,'INC-TEST recovery');
    await expect(assertOperationalControl('web_mutations')).resolves.toBeUndefined();
  });

  test('keeps parsing read-only commands while rejecting mutation input during a freeze',async()=>{
    await setControl('web_mutations',false,'INC-TEST API freeze');
    const request=()=>new Request('http://127.0.0.1:3001/api/test',{method:'POST',headers:{origin:'http://127.0.0.1:3001','content-type':'application/json'},body:'{"action":"status"}'});
    await expect(jsonInput(request())).resolves.toEqual({action:'status'});
    await expect(mutationInput(request())).rejects.toMatchObject({status:503,code:'OPERATION_PAUSED'});
    await setControl('web_mutations',true,'INC-TEST API recovery');
  });
});
