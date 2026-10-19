import { assertDeploymentConfiguration,deploymentConfiguration,type RuntimeService } from '@commerce/operations';

const service=(process.argv[2]??'web') as RuntimeService;
if(!['web','worker','monitor'].includes(service))throw new Error('Usage: check-release-configuration.ts <web|worker|monitor>');
const report=deploymentConfiguration(service);
console.log(JSON.stringify(report,null,2));
assertDeploymentConfiguration(service);
