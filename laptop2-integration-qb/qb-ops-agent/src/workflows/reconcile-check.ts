import { CompanyFileRecord } from '../storage/local-db';
import { WorkflowResult } from '../quickbooks/workflows';

export async function runReconcileCheck(companyFile: CompanyFileRecord): Promise<WorkflowResult> {
  return {
    workflow: 'reconcile_check',
    company_file: companyFile.company_file_path,
    status: 'warning',
    actions: [
      {
        name: 'reconcile_check',
        status: 'needs_user',
        message: 'Reconcile status still needs manual accountant confirmation in Phase 1.',
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
